import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import type { AiAgentConfig, LLMResponse, BuiltContext } from './types'

const TRANSFER_TOOL_DESCRIPTION = `Transfere o lead para a fila de atendentes humanos. IMPORTANTE: Quando for transferir, inclua SEMPRE na sua resposta uma mensagem curta de confirmação. Use apenas quando o usuário pedir pra falar com humano explícitamente.`

export async function callLLM(
    config: AiAgentConfig,
    context: BuiltContext
): Promise<LLMResponse> {
    const systemPrompt = `
${config.system_prompt || 'Você é um assistente virtual. Seja cordial e objetivo.'}

Você tem a ferramenta "transfer_to_human". Use apenas quando o lead pedir um humano ou atendimento pessoal.
FORMATAÇÃO PARA WHATSAPP:
- Evite blocos únicos de texto longos. Use quebras de linha.
- Use *negrito* para dar ênfase (ex: *R$ 100,00*).

CONTEXTO DA CONVERSA:
${context.transcript}
    `

    if (config.provider === 'openai') {
        return callOpenAI(config, systemPrompt)
    }

    return callGemini(config, systemPrompt)
}

async function callOpenAI(config: AiAgentConfig, fullPrompt: string): Promise<LLMResponse> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    
    const response = await openai.chat.completions.create({
        model: config.model || 'gpt-4o-mini',
        messages: [{ role: 'system', content: fullPrompt }],
        temperature: config.temperature,
        tools: [{
            type: 'function',
            function: {
                name: 'transfer_to_human',
                description: TRANSFER_TOOL_DESCRIPTION,
                parameters: {
                    type: 'object',
                    properties: { reason: { type: 'string' } },
                    required: ['reason']
                }
            }
        }],
        tool_choice: 'auto'
    })

    const msg = response.choices[0]?.message
    if (!msg) return { text: '', shouldHandoff: false }

    const toolCalls = msg.tool_calls
    if (toolCalls && toolCalls.length > 0) {
        const transferCall = toolCalls.find(tc => tc.function.name === 'transfer_to_human')
        if (transferCall) {
            return {
                text: msg.content || 'Vou te transferir para um especialista agora.',
                shouldHandoff: true,
                handoffReason: 'Usuário solicitou humano'
            }
        }
    }

    return { text: msg.content || '', shouldHandoff: false }
}

async function callGemini(config: AiAgentConfig, fullPrompt: string): Promise<LLMResponse> {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '')
    const model = genAI.getGenerativeModel({
        model: config.model || 'gemini-2.5-flash',
        generationConfig: { temperature: config.temperature }
    })

    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        tools: [{
            functionDeclarations: [{
                name: 'transfer_to_human',
                description: TRANSFER_TOOL_DESCRIPTION,
                parameters: {
                    type: "OBJECT" as any,
                    properties: { reason: { type: "STRING" as any } },
                    required: ['reason']
                }
            }]
        }]
    })

    const callFn = result.response.functionCalls()
    if (callFn && callFn.some(fn => fn.name === 'transfer_to_human')) {
        return {
            text: result.response.text() || 'Vou te transferir para um especialista.',
            shouldHandoff: true,
            handoffReason: 'Usuário solicitou humano'
        }
    }

    return { text: result.response.text(), shouldHandoff: false }
}
