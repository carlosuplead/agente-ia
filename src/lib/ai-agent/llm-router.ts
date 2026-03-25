import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import type { FunctionDeclarationsTool } from '@google/generative-ai'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { callN8nWebhook, type N8nWebhookPayload } from '@/lib/ai-agent/n8n-webhook'
import { parseN8nToolsFromConfig, type N8nToolDef } from '@/lib/ai-agent/n8n-tools'
import type { AiAgentConfig, BuiltContext, LLMResponse, LlmUsageSnapshot, VoiceDeliveryRecord } from './types'
import {
    executeSendVoiceMessage,
    VOICE_MESSAGE_TOOL_NAME,
    voiceToolDescription
} from '@/lib/ai-agent/voice-tool'

const LLM_TIMEOUT_MS = 30_000
const TOOL_NAME_TRANSFER = 'transfer_to_human'

export type LlmContactMeta = {
    conversationId: string
    workspaceSlug: string
    /** Token da instância WhatsApp (envio de áudio /send/media). */
    whatsappInstanceToken?: string
}

function elevenLabsVoiceLayerOn(config: AiAgentConfig, meta?: LlmContactMeta): boolean {
    return (
        config.elevenlabs_voice_enabled === true &&
        Boolean(process.env.ELEVENLABS_API_KEY?.trim()) &&
        Boolean(meta?.whatsappInstanceToken?.trim())
    )
}

const DEFAULT_TRANSFER_TOOL_DESCRIPTION = `Transfere o lead para a fila de atendentes humanos. IMPORTANTE: Quando for transferir, inclua SEMPRE na sua resposta uma mensagem curta de confirmação. Use apenas quando o usuário pedir pra falar com humano explícitamente.`

function transferToolDescription(config: AiAgentConfig): string {
    const custom = config.transfer_tool_description?.trim()
    return custom || DEFAULT_TRANSFER_TOOL_DESCRIPTION
}

function handoffFallbackText(config: AiAgentConfig): string {
    return (
        config.handoff_default_reply?.trim() ||
        'Vou te transferir para um especialista agora.'
    )
}

function sumUsage(a: LlmUsageSnapshot | undefined, b: LlmUsageSnapshot | undefined): LlmUsageSnapshot | undefined {
    if (!a && !b) return undefined
    const p = (a?.prompt_tokens ?? 0) + (b?.prompt_tokens ?? 0)
    const c = (a?.completion_tokens ?? 0) + (b?.completion_tokens ?? 0)
    const t = (a?.total_tokens ?? 0) + (b?.total_tokens ?? 0)
    return { prompt_tokens: p, completion_tokens: c, total_tokens: t > 0 ? t : p + c }
}

function openAiUsageFromCompletion(completion: {
    usage?: { prompt_tokens?: number | null; completion_tokens?: number | null; total_tokens?: number | null } | null
}): LlmUsageSnapshot | undefined {
    const u = completion.usage
    if (!u) return undefined
    const pt = u.prompt_tokens ?? 0
    const ct = u.completion_tokens ?? 0
    const tt = u.total_tokens ?? pt + ct
    if (tt <= 0 && pt <= 0 && ct <= 0) return undefined
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt }
}

type GeminiUsageMeta = {
    usageMetadata?: {
        promptTokenCount?: number
        candidatesTokenCount?: number
        totalTokenCount?: number
    }
}

function geminiUsageFromResponse(response: GeminiUsageMeta): LlmUsageSnapshot | undefined {
    const m = response.usageMetadata
    if (!m) return undefined
    const pt = m.promptTokenCount ?? 0
    const ct = m.candidatesTokenCount ?? 0
    const tt = m.totalTokenCount ?? pt + ct
    if (tt <= 0 && pt <= 0 && ct <= 0) return undefined
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    })
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle)
    }) as Promise<T>
}

/** GPT-5 base / mini / nano: a doc da OpenAI indica erro se enviar temperature; gpt-5.2 e gpt-5.4 (default reasoning) aceitam. */
function openAiOmitsChatTemperature(model: string): boolean {
    const m = model.toLowerCase().trim()
    if (m.startsWith('gpt-5.2') || m.startsWith('gpt-5.4')) return false
    if (m === 'gpt-5') return true
    if (m.startsWith('gpt-5-mini')) return true
    if (m.startsWith('gpt-5-nano')) return true
    if (/^gpt-5-\d{4}-\d{2}-\d{2}/.test(m)) return true
    return false
}

function configRecord(config: AiAgentConfig): Record<string, unknown> {
    return config as unknown as Record<string, unknown>
}

function resolveOpenAiApiKey(config: AiAgentConfig): string {
    const w = typeof config.openai_api_key === 'string' ? config.openai_api_key.trim() : ''
    if (w) return w
    return process.env.OPENAI_API_KEY?.trim() || ''
}

function resolveGoogleApiKey(config: AiAgentConfig): string {
    const w = typeof config.google_api_key === 'string' ? config.google_api_key.trim() : ''
    if (w) return w
    return process.env.GOOGLE_API_KEY?.trim() || ''
}

function buildUserContent(
    config: AiAgentConfig,
    context: BuiltContext,
    n8nToolsInPrompt: N8nToolDef[],
    elevenlabsVoiceOn: boolean
): string {
    const handoffOn = config.human_handoff_enabled !== false
    const extraFmt = config.whatsapp_formatting_extra?.trim()

    const chunkOn = config.ai_chunk_messages_enabled === true
    const chunkLinesMode = config.ai_chunk_split_mode === 'lines'
    const parts = [
        config.system_prompt || 'Você é um assistente virtual. Seja cordial e objetivo.',
        handoffOn
            ? `Você tem a ferramenta "${TOOL_NAME_TRANSFER}". Use apenas quando o lead pedir um humano ou atendimento pessoal, conforme o prompt acima.`
            : '',
        n8nToolsInPrompt.length > 0
            ? `Ferramentas N8N (cada uma com argumento "payload" em texto): ${n8nToolsInPrompt.map(t => `"${t.tool_name}" — ${t.description}`).join(' | ')}`
            : '',
        elevenlabsVoiceOn
            ? `Você tem a ferramenta "${VOICE_MESSAGE_TOOL_NAME}": ${voiceToolDescription(config)}`
            : '',
        'FORMATAÇÃO PARA WHATSAPP:',
        '- Evite blocos únicos de texto longos. Use quebras de linha.',
        '- Use *negrito* para dar ênfase (ex: *R$ 100,00*).',
        chunkOn && chunkLinesMode
            ? '- Este workspace envia a tua resposta em várias mensagens: cada linha (cada \\n) vira uma mensagem WhatsApp. Usa uma ideia por linha; evita linhas muito curtas sem contexto.'
            : chunkOn
              ? '- Este workspace envia a tua resposta em várias mensagens separadas. Entre ideias distintas (ex.: confirmação, depois pergunta, depois opções), deixa uma linha em branco (parágrafo separado) para cada bloco que deve ser uma mensagem.'
              : '',
        extraFmt ? `Instruções adicionais de estilo:\n${extraFmt}` : '',
        'CONTEXTO DA CONVERSA:',
        context.transcript,
        '',
        'Responda como o assistente (uma única mensagem), salvo se precisar chamar uma ferramenta primeiro.'
    ]
    return parts.filter(Boolean).join('\n')
}

export async function callLLM(
    config: AiAgentConfig,
    context: BuiltContext,
    meta?: LlmContactMeta
): Promise<LLMResponse> {
    const handoffOn = config.human_handoff_enabled !== false
    const n8nList =
        config.n8n_webhook_enabled === true && meta
            ? parseN8nToolsFromConfig(configRecord(config))
            : []
    const n8nOn = n8nList.length > 0
    const voiceOn = elevenLabsVoiceLayerOn(config, meta)

    const userContent = buildUserContent(config, context, n8nOn ? n8nList : [], voiceOn)

    if (!handoffOn && !n8nOn && !voiceOn) {
        return plainCompletion(config, userContent)
    }

    if (config.provider === 'openai') {
        return callOpenAIWithTools(config, context, userContent, handoffOn, n8nList, voiceOn, meta)
    }
    return callGeminiWithTools(config, context, userContent, handoffOn, n8nList, voiceOn, meta)
}

async function plainCompletion(config: AiAgentConfig, userContent: string): Promise<LLMResponse> {
    if (config.provider === 'openai') {
        const apiKey = resolveOpenAiApiKey(config)
        if (!apiKey) throw new Error('Chave OpenAI em falta (workspace ou OPENAI_API_KEY no servidor)')
        const openai = new OpenAI({ apiKey })
        const modelName = config.model || 'gpt-4o-mini'
        const completion = await withTimeout(
            openai.chat.completions.create({
                model: modelName,
                messages: [{ role: 'user', content: userContent }],
                ...(openAiOmitsChatTemperature(modelName) ? {} : { temperature: config.temperature })
            }),
            LLM_TIMEOUT_MS,
            'Timeout OpenAI'
        )
        return {
            text: completion.choices[0]?.message?.content || '',
            shouldHandoff: false,
            voiceDeliveries: undefined,
            usage: openAiUsageFromCompletion(completion)
        }
    }

    const gKey = resolveGoogleApiKey(config)
    if (!gKey) throw new Error('Chave Google (Gemini) em falta (workspace ou GOOGLE_API_KEY no servidor)')
    const genAI = new GoogleGenerativeAI(gKey)
    const model = genAI.getGenerativeModel({
        model: config.model || 'gemini-2.5-flash',
        generationConfig: { temperature: config.temperature }
    })
    const result = await withTimeout(
        model.generateContent(userContent),
        LLM_TIMEOUT_MS,
        'Timeout Gemini'
    )
    return {
        text: result.response.text(),
        shouldHandoff: false,
        voiceDeliveries: undefined,
        usage: geminiUsageFromResponse(result.response as GeminiUsageMeta)
    }
}

async function callGeminiWithTools(
    config: AiAgentConfig,
    context: BuiltContext,
    userContent: string,
    handoffOn: boolean,
    n8nList: N8nToolDef[],
    elevenlabsVoiceOn: boolean,
    meta?: LlmContactMeta
): Promise<LLMResponse> {
    const apiKey = resolveGoogleApiKey(config)
    if (!apiKey) throw new Error('Chave Google (Gemini) em falta (workspace ou GOOGLE_API_KEY no servidor)')

    const declarations: Array<Record<string, unknown>> = []
    if (handoffOn) {
        declarations.push({
            name: TOOL_NAME_TRANSFER,
            description: transferToolDescription(config),
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    reason: { type: SchemaType.STRING, description: 'Motivo da transferência' }
                },
                required: ['reason']
            }
        })
    }
    for (const t of n8nList) {
        declarations.push({
            name: t.tool_name,
            description: t.description,
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    payload: {
                        type: SchemaType.STRING,
                        description: 'Dados a enviar ao workflow'
                    }
                },
                required: ['payload']
            }
        })
    }
    if (elevenlabsVoiceOn) {
        declarations.push({
            name: VOICE_MESSAGE_TOOL_NAME,
            description: voiceToolDescription(config),
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    text: {
                        type: SchemaType.STRING,
                        description: 'Texto que será falado no áudio enviado ao WhatsApp'
                    },
                    voice_id: {
                        type: SchemaType.STRING,
                        description: 'Opcional: ID de voz ElevenLabs (override)'
                    }
                },
                required: ['text']
            }
        })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
        model: config.model || 'gemini-2.5-flash',
        generationConfig: { temperature: config.temperature, maxOutputTokens: 2048 },
        tools: [{ functionDeclarations: declarations }] as unknown as FunctionDeclarationsTool[]
    })

    const chat = model.startChat({ history: [] })
    let response = await withTimeout(
        chat.sendMessage(userContent),
        LLM_TIMEOUT_MS,
        'Timeout Gemini'
    ).then(r => r.response)

    const voiceDeliveries: VoiceDeliveryRecord[] = []
    let usageAcc: LlmUsageSnapshot | undefined
    const MAX_ROUNDS = 4
    for (let round = 0; round < MAX_ROUNDS; round++) {
        usageAcc = sumUsage(usageAcc, geminiUsageFromResponse(response as GeminiUsageMeta))
        const calls = response.functionCalls?.() || []

        const transferCall = calls.find(c => c.name === TOOL_NAME_TRANSFER)
        if (transferCall && handoffOn) {
            const reason =
                typeof (transferCall.args as { reason?: string })?.reason === 'string'
                    ? (transferCall.args as { reason: string }).reason
                    : 'Transferência solicitada'
            let text = ''
            try {
                text = response.text()?.trim() || ''
            } catch {
                text = ''
            }
            return {
                text: text || handoffFallbackText(config),
                shouldHandoff: true,
                handoffReason: reason,
                voiceDeliveries: voiceDeliveries.length ? voiceDeliveries : undefined,
                usage: usageAcc
            }
        }

        const otherCalls = calls.filter(c => c.name !== TOOL_NAME_TRANSFER)
        if (otherCalls.length && meta) {
            const functionResponseParts: Array<{
                functionResponse: { name: string; response: { result: string } }
            }> = []
            const instanceTok = meta.whatsappInstanceToken?.trim() || ''
            const delayMs = config.send_delay_ms ?? 1200

            for (const call of otherCalls) {
                if (call.name === VOICE_MESSAGE_TOOL_NAME) {
                    if (!elevenlabsVoiceOn || !instanceTok) {
                        functionResponseParts.push({
                            functionResponse: {
                                name: VOICE_MESSAGE_TOOL_NAME,
                                response: { result: 'Função de áudio não disponível neste contexto.' }
                            }
                        })
                        continue
                    }
                    const va = call.args as { text?: string; voice_id?: string }
                    const exec = await executeSendVoiceMessage({
                        config,
                        context,
                        instanceToken: instanceTok,
                        text: String(va?.text || ''),
                        voiceIdOverride: typeof va?.voice_id === 'string' ? va.voice_id : null,
                        delayMs
                    })
                    if (exec.delivery) voiceDeliveries.push(exec.delivery)
                    functionResponseParts.push({
                        functionResponse: {
                            name: VOICE_MESSAGE_TOOL_NAME,
                            response: { result: exec.toolResult }
                        }
                    })
                    continue
                }

                const def = n8nList.find(t => t.tool_name === call.name)
                if (def) {
                    const payload = String((call.args as { payload?: string })?.payload || '')
                    const webhookBody: N8nWebhookPayload = {
                        payload,
                        contact: {
                            id: context.contactId,
                            name: context.contactName,
                            phone: context.contactPhone
                        },
                        conversation_id: meta.conversationId,
                        workspace_slug: meta.workspaceSlug,
                        organization_id: meta.workspaceSlug,
                        n8n_tool: def.tool_name
                    }
                    const webhookResult = await callN8nWebhook(def.url, webhookBody, def.timeout_seconds)
                    const toolResultText = webhookResult.ok
                        ? webhookResult.data || 'OK'
                        : `Erro: ${webhookResult.error || 'Falha no webhook'}`
                    functionResponseParts.push({
                        functionResponse: {
                            name: def.tool_name,
                            response: { result: toolResultText }
                        }
                    })
                } else {
                    functionResponseParts.push({
                        functionResponse: {
                            name: call.name,
                            response: { result: 'Função não disponível neste contexto.' }
                        }
                    })
                }
            }

            if (functionResponseParts.length === 0) break
            const followUp = await withTimeout(
                chat.sendMessage(functionResponseParts),
                LLM_TIMEOUT_MS,
                'Timeout Gemini (tools follow-up)'
            )
            response = followUp.response
            continue
        }

        break
    }

    let text = ''
    try {
        text = response.text()?.trim() || ''
    } catch {
        text = ''
    }
    return {
        text,
        shouldHandoff: false,
        voiceDeliveries: voiceDeliveries.length ? voiceDeliveries : undefined,
        usage: usageAcc
    }
}

async function callOpenAIWithTools(
    config: AiAgentConfig,
    context: BuiltContext,
    userContent: string,
    handoffOn: boolean,
    n8nList: N8nToolDef[],
    elevenlabsVoiceOn: boolean,
    meta?: LlmContactMeta
): Promise<LLMResponse> {
    const apiKey = resolveOpenAiApiKey(config)
    if (!apiKey) throw new Error('Chave OpenAI em falta (workspace ou OPENAI_API_KEY no servidor)')

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = []
    if (handoffOn) {
        tools.push({
            type: 'function',
            function: {
                name: TOOL_NAME_TRANSFER,
                description: transferToolDescription(config),
                parameters: {
                    type: 'object',
                    properties: { reason: { type: 'string' } },
                    required: ['reason']
                }
            }
        })
    }
    for (const t of n8nList) {
        tools.push({
            type: 'function',
            function: {
                name: t.tool_name,
                description: t.description,
                parameters: {
                    type: 'object',
                    properties: { payload: { type: 'string' } },
                    required: ['payload']
                }
            }
        })
    }
    if (elevenlabsVoiceOn) {
        tools.push({
            type: 'function',
            function: {
                name: VOICE_MESSAGE_TOOL_NAME,
                description: voiceToolDescription(config),
                parameters: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: 'Texto falado no áudio' },
                        voice_id: { type: 'string', description: 'Opcional: ID voz ElevenLabs' }
                    },
                    required: ['text']
                }
            }
        })
    }

    const openai = new OpenAI({ apiKey })
    const modelName = config.model || 'gpt-4o-mini'
    const messages: ChatCompletionMessageParam[] = [{ role: 'user', content: userContent }]
    const voiceDeliveries: VoiceDeliveryRecord[] = []
    const delayMs = config.send_delay_ms ?? 1200
    let usageAcc: LlmUsageSnapshot | undefined

    const MAX_ROUNDS = 4
    for (let round = 0; round < MAX_ROUNDS; round++) {
        const completion = await withTimeout(
            openai.chat.completions.create({
                model: modelName,
                messages,
                ...(openAiOmitsChatTemperature(modelName) ? {} : { temperature: config.temperature }),
                max_tokens: 2048,
                tools,
                tool_choice: 'auto'
            }),
            LLM_TIMEOUT_MS,
            'Timeout OpenAI'
        )

        usageAcc = sumUsage(usageAcc, openAiUsageFromCompletion(completion))

        const msg = completion.choices[0]?.message
        if (!msg) break

        const toolCalls = msg.tool_calls
        if (!toolCalls?.length) {
            return {
                text: msg.content?.trim() || '',
                shouldHandoff: false,
                voiceDeliveries: voiceDeliveries.length ? voiceDeliveries : undefined,
                usage: usageAcc
            }
        }

        const transferCall = toolCalls.find(
            tc => tc.type === 'function' && tc.function?.name === TOOL_NAME_TRANSFER
        )
        if (transferCall && transferCall.type === 'function' && handoffOn) {
            let reason = 'Transferência solicitada'
            try {
                const args = JSON.parse(transferCall.function.arguments || '{}') as { reason?: string }
                if (typeof args.reason === 'string') reason = args.reason
            } catch {
                /* ignore */
            }
            return {
                text: msg.content?.trim() || handoffFallbackText(config),
                shouldHandoff: true,
                handoffReason: reason,
                voiceDeliveries: voiceDeliveries.length ? voiceDeliveries : undefined,
                usage: usageAcc
            }
        }

        const hasFunctionTools = toolCalls.some(tc => tc.type === 'function')
        if (hasFunctionTools) {
            messages.push(msg as ChatCompletionMessageParam)
            const instanceTok = meta?.whatsappInstanceToken?.trim() || ''
            for (const tc of toolCalls) {
                if (tc.type !== 'function' || !tc.id || !tc.function?.name) continue
                const fnName = tc.function.name
                if (fnName === TOOL_NAME_TRANSFER) continue

                let toolContent: string
                if (fnName === VOICE_MESSAGE_TOOL_NAME && meta) {
                    if (!elevenlabsVoiceOn || !instanceTok) {
                        toolContent = 'Função de áudio não disponível neste contexto.'
                    } else {
                        let text = ''
                        let voiceId: string | null = null
                        try {
                            const args = JSON.parse(tc.function.arguments || '{}') as {
                                text?: string
                                voice_id?: string
                            }
                            text = args.text || ''
                            voiceId = typeof args.voice_id === 'string' ? args.voice_id : null
                        } catch {
                            /* empty */
                        }
                        const exec = await executeSendVoiceMessage({
                            config,
                            context,
                            instanceToken: instanceTok,
                            text,
                            voiceIdOverride: voiceId,
                            delayMs
                        })
                        if (exec.delivery) voiceDeliveries.push(exec.delivery)
                        toolContent = exec.toolResult
                    }
                } else {
                    const def = n8nList.find(t => t.tool_name === fnName)
                    if (def && meta) {
                        let payload = ''
                        try {
                            const args = JSON.parse(tc.function.arguments || '{}') as { payload?: string }
                            payload = args.payload || ''
                        } catch {
                            /* empty */
                        }
                        const webhookBody: N8nWebhookPayload = {
                            payload,
                            contact: {
                                id: context.contactId,
                                name: context.contactName,
                                phone: context.contactPhone
                            },
                            conversation_id: meta.conversationId,
                            workspace_slug: meta.workspaceSlug,
                            organization_id: meta.workspaceSlug,
                            n8n_tool: def.tool_name
                        }
                        const webhookResult = await callN8nWebhook(def.url, webhookBody, def.timeout_seconds)
                        toolContent = webhookResult.ok
                            ? webhookResult.data || 'OK'
                            : `Erro: ${webhookResult.error || 'Falha no webhook'}`
                    } else {
                        toolContent = 'Função não disponível neste contexto.'
                    }
                }
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: toolContent
                })
            }
            continue
        }

        return {
            text: msg.content?.trim() || '',
            shouldHandoff: false,
            voiceDeliveries: voiceDeliveries.length ? voiceDeliveries : undefined,
            usage: usageAcc
        }
    }

    return {
        text: '',
        shouldHandoff: false,
        voiceDeliveries: voiceDeliveries.length ? voiceDeliveries : undefined,
        usage: usageAcc
    }
}
