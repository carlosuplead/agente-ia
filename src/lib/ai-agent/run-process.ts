import type { SupabaseClient } from '@supabase/supabase-js'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { buildContext } from '@/lib/ai-agent/context-builder'
import { callLLM } from '@/lib/ai-agent/llm-router'
import type { LLMResponse } from '@/lib/ai-agent/types'
import { parseMessageForWhatsApp } from '@/lib/ai-agent/format-for-whatsapp'
import { splitAiResponseForChunks, type AiChunkSplitMode } from '@/lib/ai-agent/split-ai-response'
import { setFollowupAnchorForConversation } from '@/lib/ai-agent/followup-anchor'
import { getProviderForWorkspace } from '@/lib/whatsapp/factory'
import type { AiAgentConfig } from './types'
import { shouldAcceptInboundForTestMode } from '@/lib/ai-agent/test-mode-allowlist'
import { processUnprocessedMedia, type MediaProviderInfo } from '@/lib/ai-agent/media-processing'

// ─── Cache de configuração do agente IA ───────────────────────────
// A config raramente muda, mas é buscada a cada mensagem recebida.
// Cache em memória com TTL de 60s elimina ~95% das queries ao banco.
type CachedConfig = { config: AiAgentConfig; fetchedAt: number }
const configCache = new Map<string, CachedConfig>()
const CONFIG_CACHE_TTL_MS = 60_000

async function getAgentConfig(workspaceSlug: string): Promise<AiAgentConfig | undefined> {
    const cached = configCache.get(workspaceSlug)
    if (cached && Date.now() - cached.fetchedAt < CONFIG_CACHE_TTL_MS) {
        return cached.config
    }
    const sql = getTenantSql()
    const sch = quotedSchema(workspaceSlug)
    const rows = await sql.unsafe(`SELECT * FROM ${sch}.ai_agent_config LIMIT 1`, [])
    const config = rows[0] as unknown as AiAgentConfig | undefined
    if (config) {
        configCache.set(workspaceSlug, { config, fetchedAt: Date.now() })
    }
    return config
}

/** Invalida cache quando config é alterada (chamar do PATCH da config route). */
export function invalidateAgentConfigCache(workspaceSlug: string): void {
    configCache.delete(workspaceSlug)
}

const EMPTY_LLM_FALLBACK =
    'Desculpe, não consegui gerar uma resposta agora. Pode repetir a sua pergunta?'

/** Resposta curta após `/reset` (sem chamar LLM). */
const RESET_COMMAND_REPLY =
    'Pronto — reiniciei a nossa conversa. Em que posso ajudar?'

function isUserResetCommand(body: string | null | undefined): boolean {
    return (body ?? '').trim().toLowerCase() === '/reset'
}

type AiConvRow = {
    id: string
    status: string
    messages_count: number
    created_at: string | Date
}

function matchesHandoffKeywords(text: string, raw: string | null | undefined): boolean {
    if (!raw?.trim()) return false
    const t = text.toLowerCase()
    for (const k of raw.split(/[\n,]+/)) {
        const w = k.trim().toLowerCase()
        if (w && t.includes(w)) return true
    }
    return false
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function aiReplyChunks(text: string, config: AiAgentConfig): string[] {
    const t = text.trim()
    if (!t) return []
    if (!config.ai_chunk_messages_enabled) return [t]
    const mode: AiChunkSplitMode = config.ai_chunk_split_mode === 'lines' ? 'lines' : 'paragraph'
    const rawMax = Number(config.ai_chunk_max_parts)
    const maxParts = Number.isFinite(rawMax) ? rawMax : 8
    return splitAiResponseForChunks(t, mode, maxParts)
}

import { sendOptionsFromConfig } from '@/lib/ai-agent/send-options'

async function handleUserResetCommand(
    supabase: SupabaseClient,
    workspace_slug: string,
    contact_id: string,
    contactPhone: string,
    config: AiAgentConfig
): Promise<RunAiProcessResult> {
    const sql = getTenantSql()
    const sch = quotedSchema(workspace_slug)

    const convRows = await sql.unsafe(
        `SELECT id, status FROM ${sch}.ai_conversations WHERE contact_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
        [contact_id]
    )
    const latest = convRows[0] as unknown as { id: string; status: string } | undefined

    // Fechar todas as conversas anteriores
    await sql.unsafe(
        `UPDATE ${sch}.ai_conversations SET status = 'expired', ended_at = now(), handoff_reason = 'Comando /reset'
         WHERE contact_id = $1::uuid AND status IN ('active', 'handed_off')`,
        [contact_id]
    )

    // Apagar todo o histórico de mensagens do contato (reset total)
    await sql.unsafe(
        `UPDATE ${sch}.messages SET is_deleted = true WHERE contact_id = $1::uuid`,
        [contact_id]
    )

    const inserted = await sql.unsafe(
        `INSERT INTO ${sch}.ai_conversations (contact_id, status) VALUES ($1::uuid, 'active') RETURNING id, messages_count, created_at`,
        [contact_id]
    )
    const row = inserted[0] as unknown as { id: string; messages_count: number; created_at: string | Date } | undefined
    if (!row) {
        return { ok: false, status: 500, error: 'Failed to create conversation after reset' }
    }
    const conversationId = row.id

    const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_token')
        .eq('workspace_slug', workspace_slug)
        .eq('status', 'connected')
        .maybeSingle()

    if (!instance?.instance_token) {
        return { ok: false, status: 400, error: 'No instance connected' }
    }

    const sendOpts = sendOptionsFromConfig(config)
    const textToSend = parseMessageForWhatsApp(RESET_COMMAND_REPLY)
    const savedRows = await sql.unsafe(
        `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, status)
         VALUES ($1::uuid, $2::uuid, 'ai', $3, 'sending')
         RETURNING id`,
        [contact_id, conversationId, RESET_COMMAND_REPLY]
    )
    const savedMsg = savedRows[0] as unknown as { id: string } | undefined
    try {
        const { provider } = await getProviderForWorkspace(supabase, workspace_slug)
        const sendRes = await provider.sendText(
            instance.instance_token,
            contactPhone,
            textToSend,
            sendOpts
        )
        if (savedMsg) {
            await sql.unsafe(
                `UPDATE ${sch}.messages SET status = 'sent', whatsapp_id = $2 WHERE id = $1::uuid`,
                [savedMsg.id, sendRes.messageId]
            )
        }
    } catch {
        if (savedMsg) {
            await sql.unsafe(`UPDATE ${sch}.messages SET status = 'failed' WHERE id = $1::uuid`, [savedMsg.id])
        }
        return { ok: false, status: 502, error: 'Failed to send reset confirmation' }
    }

    await setFollowupAnchorForConversation(workspace_slug, conversationId).catch(() => {})

    const { data: incRows, error: incErr } = await supabase.rpc('increment_ai_conversation_if_under_cap', {
        p_tenant: workspace_slug,
        p_conv_id: conversationId,
        p_cap: config.max_messages_per_conversation
    })
    if (!incErr && Array.isArray(incRows) && incRows.length > 0) {
        const ir = incRows[0] as { updated_ok?: boolean }
        if (ir.updated_ok === false) {
            await sql.unsafe(
                `UPDATE ${sch}.ai_conversations SET status = 'handed_off', handoff_reason = $2 WHERE id = $1::uuid`,
                [conversationId, 'Limite de mensagens atingido']
            )
        }
    } else {
        await sql.unsafe(
            `UPDATE ${sch}.ai_conversations SET messages_count = messages_count + 1 WHERE id = $1::uuid`,
            [conversationId]
        )
    }

    return { ok: true, reason: 'User /reset' }
}

export type RunAiProcessResult =
    | { ok: true; reason?: string }
    | { ok: false; status: number; error: string }

/** Origem da execução (dashboard Execuções IA). */
export type AiRunSource = 'buffer' | 'http_process' | 'schedule' | 'unknown'

export type RunAiProcessOptions = {
    runSource?: AiRunSource
}

export async function runAiProcess(
    supabase: SupabaseClient,
    workspace_slug: string,
    contact_id: string,
    opts?: RunAiProcessOptions
): Promise<RunAiProcessResult> {
    const sql = getTenantSql()
    const sch = quotedSchema(workspace_slug)

    const config = await getAgentConfig(workspace_slug)

    if (!config || !config.enabled) {
        return { ok: true, reason: 'AI disabled' }
    }

    // ── Query consolidada: phone + last inbound + conversation ativa (1 roundtrip) ──
    const initRows = await sql.unsafe(
        `SELECT
            (SELECT phone FROM ${sch}.contacts WHERE id = $1::uuid LIMIT 1) AS contact_phone,
            (SELECT body FROM ${sch}.messages WHERE contact_id = $1::uuid AND sender_type = 'contact' ORDER BY created_at DESC LIMIT 1) AS last_inbound_body,
            (SELECT row_to_json(sub) FROM (
                SELECT id, status, messages_count, created_at
                FROM ${sch}.ai_conversations WHERE contact_id = $1::uuid
                ORDER BY created_at DESC LIMIT 1
            ) sub) AS latest_conv`,
        [contact_id]
    )
    const initData = initRows[0] as unknown as {
        contact_phone: string | null
        last_inbound_body: string | null
        latest_conv: { id: string; status: string; messages_count: number; created_at: string | Date } | null
    } | undefined

    const contactPhone = initData?.contact_phone ?? ''
    if (!shouldAcceptInboundForTestMode(config, contactPhone)) {
        return { ok: true, reason: 'Test mode allowlist' }
    }

    const lastInboundBody = initData?.last_inbound_body ?? null
    if (isUserResetCommand(lastInboundBody)) {
        return handleUserResetCommand(supabase, workspace_slug, contact_id, contactPhone, config)
    }

    let aiConv = initData?.latest_conv as AiConvRow | undefined

    let conversationId = aiConv?.id
    let messageCount = aiConv?.messages_count ?? 0
    let priorAiConversationId: string | null = null
    let conversationCreatedAt: string | Date | undefined

    if (aiConv && aiConv.status === 'handed_off') {
        return { ok: true, reason: 'Already handed off' }
    }

    const rawInactivityHours = config.inactivity_timeout_hours
    const inactivityHours = typeof rawInactivityHours === 'number' && Number.isFinite(rawInactivityHours) && rawInactivityHours > 0
        ? rawInactivityHours
        : 24
    const inactivityMs = inactivityHours * 3600 * 1000

    const lastActivityRows = await sql.unsafe(
        `SELECT MAX(created_at) as last_at FROM ${sch}.messages WHERE contact_id = $1::uuid`,
        [contact_id]
    )
    const lastAtRaw = (lastActivityRows[0] as unknown as { last_at: string | Date | null } | undefined)?.last_at
    const lastAtMs = lastAtRaw ? new Date(lastAtRaw).getTime() : 0
    const inactiveTooLong = lastAtMs > 0 && Date.now() - lastAtMs > inactivityMs

    if (aiConv?.status === 'expired' || (aiConv?.status === 'active' && inactiveTooLong)) {
        priorAiConversationId = aiConv.id
        if (aiConv.status === 'active' && inactiveTooLong) {
            await sql.unsafe(
                `UPDATE ${sch}.ai_conversations SET status = 'expired', ended_at = now(), handoff_reason = $2 WHERE id = $1::uuid`,
                [aiConv.id, 'Inatividade']
            )
        }
        const inserted = await sql.unsafe(
            `INSERT INTO ${sch}.ai_conversations (contact_id, status) VALUES ($1::uuid, 'active') RETURNING id, messages_count, created_at`,
            [contact_id]
        )
        const row = inserted[0] as unknown as { id: string; messages_count: number; created_at: string | Date } | undefined
        if (row) {
            conversationId = row.id
            messageCount = row.messages_count ?? 0
            conversationCreatedAt = row.created_at
            aiConv = {
                id: row.id,
                status: 'active',
                messages_count: messageCount,
                created_at: row.created_at
            }
        }
    }

    if (!conversationId) {
        const inserted = await sql.unsafe(
            `INSERT INTO ${sch}.ai_conversations (contact_id, status) VALUES ($1::uuid, 'active') RETURNING id, messages_count, created_at`,
            [contact_id]
        )
        const row = inserted[0] as unknown as { id: string; messages_count: number; created_at: string | Date } | undefined
        if (row) {
            conversationId = row.id
            messageCount = row.messages_count ?? 0
            conversationCreatedAt = row.created_at
            aiConv = {
                id: row.id,
                status: 'active',
                messages_count: messageCount,
                created_at: row.created_at
            }
        }
    } else if (!priorAiConversationId && aiConv) {
        conversationCreatedAt = aiConv.created_at
    }

    if (!conversationId) {
        return { ok: false, status: 500, error: 'No conversation' }
    }

    // ── Guard: se já respondemos e não tem mensagem nova do contato, pula ──
    // Evita processamento duplo quando múltiplos buffers disparam pro mesmo contato
    try {
        const lastAiRows = await sql.unsafe(
            `SELECT created_at FROM ${sch}.messages
             WHERE contact_id = $1::uuid AND conversation_id = $2::uuid AND sender_type = 'ai'
             ORDER BY created_at DESC LIMIT 1`,
            [contact_id, conversationId]
        )
        const lastAiAt = (lastAiRows[0] as unknown as { created_at: string | Date } | undefined)?.created_at
        if (lastAiAt) {
            const newContactRows = await sql.unsafe(
                `SELECT COUNT(*)::int as cnt FROM ${sch}.messages
                 WHERE contact_id = $1::uuid AND sender_type = 'contact'
                 AND created_at > $2::timestamptz`,
                [contact_id, lastAiAt]
            )
            const cnt = Number((newContactRows[0] as unknown as { cnt: number } | undefined)?.cnt) || 0
            if (cnt === 0) {
                return { ok: true, reason: 'No new contact messages since last AI reply (dedup)' }
            }
        }
    } catch (dedupErr) {
        // Non-fatal — proceed with processing
        console.warn('runAiProcess: dedup check error', dedupErr)
    }

    if (conversationCreatedAt === undefined) {
        const cr = await sql.unsafe(
            `SELECT created_at FROM ${sch}.ai_conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId]
        )
        const rowAt = cr[0] as unknown as { created_at: string | Date } | undefined
        if (!rowAt) {
            return { ok: false, status: 500, error: 'Conversation row missing' }
        }
        conversationCreatedAt = rowAt.created_at
    }

    if (messageCount >= config.max_messages_per_conversation) {
        await sql.unsafe(
            `UPDATE ${sch}.ai_conversations SET status = 'handed_off', handoff_reason = $2 WHERE id = $1::uuid`,
            [conversationId, 'Limite de mensagens atingido']
        )
        return { ok: true, reason: 'Limit reached' }
    }

    // ── Instance + Calendar em paralelo (elimina 1 roundtrip) ──
    const [instanceResult, calResult] = await Promise.all([
        supabase
            .from('whatsapp_instances')
            .select('instance_token, provider, meta_access_token')
            .eq('workspace_slug', workspace_slug)
            .eq('status', 'connected')
            .maybeSingle(),
        supabase
            .from('workspace_google_calendar')
            .select('refresh_token, calendar_id, default_timezone')
            .eq('workspace_slug', workspace_slug)
            .maybeSingle()
    ])

    const instance = instanceResult.data
    if (!instance) {
        return { ok: false, status: 400, error: 'No instance connected' }
    }

    let runId: string | null = null
    let runFinished = false
    const runSourceVal = opts?.runSource ?? 'unknown'
    const runStartMs = Date.now()
    const runSteps: Array<{ step: string; ts: number; detail?: unknown }> = []
    function addRunStep(step: string, detail?: unknown) {
        runSteps.push({ step, ts: Date.now() - runStartMs, detail })
    }
    addRunStep('start', { contact_id, conversation_id: conversationId, source: runSourceVal })

    try {
        const ins = await sql.unsafe(
            `INSERT INTO ${sch}.ai_agent_runs (contact_id, conversation_id, status, source)
             VALUES ($1::uuid, $2::uuid, 'running', $3)
             RETURNING id`,
            [contact_id, conversationId, runSourceVal]
        )
        runId = (ins[0] as unknown as { id?: string } | undefined)?.id ?? null
    } catch (e) {
        console.error('runAiProcess: ai_agent_runs insert', e)
    }

    const finishAgentRun = async (p: {
        status: 'success' | 'error' | 'skipped'
        reason?: string | null
        errorMessage?: string | null
    }) => {
        if (!runId || runFinished) return
        runFinished = true
        const id = runId
        addRunStep('finish', { status: p.status, reason: p.reason })
        try {
            await sql.unsafe(
                `UPDATE ${sch}.ai_agent_runs SET status = $2::text, finished_at = now(), reason = $3, error_message = $4, meta = $5::jsonb
                 WHERE id = $1::uuid`,
                [id, p.status, p.reason ?? null, p.errorMessage ?? null, JSON.stringify({ steps: runSteps })]
            )
        } catch (e) {
            console.error('runAiProcess: ai_agent_runs finish', e)
        }
    }

    type CalConn = {
        refresh_token: string | null
        calendar_id: string | null
        default_timezone: string | null
    }
    const cal = calResult.data as CalConn | null
    const rt = cal?.refresh_token?.trim()
    const googleCalendar = rt
        ? {
              refreshToken: rt,
              calendarId: (cal?.calendar_id || 'primary').trim() || 'primary',
              defaultTimezone: (cal?.default_timezone || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo'
          }
        : undefined

    try {
    const handoffOn = config.human_handoff_enabled !== false
    if (handoffOn && config.handoff_keywords?.trim()) {
        const lastRows = await sql.unsafe(
            `SELECT body FROM ${sch}.messages WHERE contact_id = $1::uuid AND sender_type = 'contact' ORDER BY created_at DESC LIMIT 1`,
            [contact_id]
        )
        const lastBody = (lastRows[0] as unknown as { body: string | null } | undefined)?.body ?? ''
        addRunStep('handoff_keywords_check', { lastBody: lastBody.slice(0, 80), keywords: config.handoff_keywords?.slice(0, 80) })
        if (matchesHandoffKeywords(lastBody, config.handoff_keywords)) {
            addRunStep('handoff_keyword_matched')
            const reply =
                config.handoff_default_reply?.trim() ||
                'Vou direcionar você para um atendente humano. Um momento.'
            const sendOpts = sendOptionsFromConfig(config)
            const textToSend = parseMessageForWhatsApp(reply)
            // Usa contactPhone já obtido no início — sem query duplicada
            if (!contactPhone) {
                await finishAgentRun({ status: 'error', errorMessage: 'Contact phone missing' })
                return { ok: false, status: 500, error: 'Contact phone missing' }
            }
            const savedRows = await sql.unsafe(
                `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, status)
                 VALUES ($1::uuid, $2::uuid, 'ai', $3, 'sending')
                 RETURNING id`,
                [contact_id, conversationId, reply]
            )
            const savedMsg = savedRows[0] as unknown as { id: string } | undefined
            try {
                const { provider } = await getProviderForWorkspace(supabase, workspace_slug)
                const sendRes = await provider.sendText(
                    instance.instance_token,
                    contactPhone,
                    textToSend,
                    sendOpts
                )
                if (savedMsg) {
                    await sql.unsafe(
                        `UPDATE ${sch}.messages SET status = 'sent', whatsapp_id = $2 WHERE id = $1::uuid`,
                        [savedMsg.id, sendRes.messageId]
                    )
                }
            } catch {
                if (savedMsg) {
                    await sql.unsafe(`UPDATE ${sch}.messages SET status = 'failed' WHERE id = $1::uuid`, [savedMsg.id])
                }
                await finishAgentRun({ status: 'error', errorMessage: 'Failed to send handoff reply' })
                return { ok: false, status: 502, error: 'Failed to send handoff reply' }
            }
            const { data: kwInc, error: kwIncErr } = await supabase.rpc('increment_ai_conversation_if_under_cap', {
                p_tenant: workspace_slug,
                p_conv_id: conversationId,
                p_cap: config.max_messages_per_conversation
            })
            if (!kwIncErr && Array.isArray(kwInc) && kwInc.length > 0) {
                const ir = kwInc[0] as { updated_ok?: boolean }
                if (ir.updated_ok === false) {
                    await sql.unsafe(
                        `UPDATE ${sch}.ai_conversations SET status = 'handed_off', handoff_reason = $2 WHERE id = $1::uuid`,
                        [conversationId, 'Limite de mensagens atingido']
                    )
                    await finishAgentRun({ status: 'success', reason: 'Limit reached at keyword handoff' })
                    return { ok: true, reason: 'Limit reached at keyword handoff' }
                }
            } else {
                await sql.unsafe(
                    `UPDATE ${sch}.ai_conversations SET messages_count = messages_count + 1 WHERE id = $1::uuid`,
                    [conversationId]
                )
            }
            await sql.unsafe(
                `UPDATE ${sch}.ai_conversations SET status = 'handed_off', handoff_reason = $2 WHERE id = $1::uuid`,
                [conversationId, 'Palavra-chave de transferência']
            )
            await finishAgentRun({ status: 'success', reason: 'Keyword handoff' })
            return { ok: true, reason: 'Keyword handoff' }
        }
    }

    // ── Processar mídias pendentes (áudio/imagem) antes de montar contexto ──
    try {
        const providerType = ((instance as { provider?: string }).provider || 'uazapi') as 'uazapi' | 'official'
        const mediaProvider: MediaProviderInfo = {
            providerType,
            instanceToken: instance.instance_token,
            accessToken: providerType === 'official'
                ? ((instance as { meta_access_token?: string }).meta_access_token || '')
                : undefined
        }
        await processUnprocessedMedia(workspace_slug, contact_id, config, mediaProvider)
        addRunStep('media_processed')
    } catch (e) {
        // Falha no processamento de mídia não deve bloquear a resposta da IA
        console.error('runAiProcess: media processing error (non-fatal):', e)
        addRunStep('media_processing_error', { error: (e as Error).message?.slice(0, 200) })
    }

    const context = await buildContext(workspace_slug, contact_id, {
        maxMessages: config.context_max_messages ?? 20,
        labelTeam: config.label_team ?? 'Equipe',
        labelAssistant: config.label_assistant ?? 'Assistente',
        aiConversationId: conversationId,
        conversationCreatedAt,
        priorAiConversationId: priorAiConversationId ?? undefined
    })
    addRunStep('context_built', {
        transcriptLength: context?.transcript?.length ?? 0,
        contactPhone: context?.contactPhone?.slice(-4)
    })
    if (!context) {
        await finishAgentRun({ status: 'error', errorMessage: 'Failed to build context' })
        return { ok: false, status: 500, error: 'Failed to build context' }
    }

    let response: LLMResponse
    addRunStep('llm_calling', { provider: config.provider, model: config.model })
    try {
        response = await callLLM(config, context, {
            conversationId,
            workspaceSlug: workspace_slug,
            whatsappInstanceToken: instance.instance_token,
            googleCalendar
        })
    } catch (llmErr) {
        console.error('runAiProcess: callLLM threw', llmErr)
        addRunStep('llm_error', { error: (llmErr as Error).message?.slice(0, 200) })
        response = { text: EMPTY_LLM_FALLBACK, shouldHandoff: false }
    }

    addRunStep('llm_responded', {
        textLength: (response.text ?? '').length,
        textPreview: (response.text ?? '').slice(0, 120),
        shouldHandoff: response.shouldHandoff,
        voiceCount: response.voiceDeliveries?.length ?? 0,
        tokens: response.usage?.total_tokens ?? 0
    })

    if (response.usage && response.usage.total_tokens > 0) {
        try {
            const modelLabel = (config.model || 'unknown').trim() || 'unknown'
            await sql.unsafe(
                `INSERT INTO ${sch}.llm_usage (ai_conversation_id, contact_id, provider, model, prompt_tokens, completion_tokens, total_tokens)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
                [
                    conversationId,
                    contact_id,
                    config.provider,
                    modelLabel,
                    response.usage.prompt_tokens,
                    response.usage.completion_tokens,
                    response.usage.total_tokens
                ]
            )
        } catch (e) {
            console.error('runAiProcess: persist llm_usage', e)
        }
    }

    const voiceList = response.voiceDeliveries ?? []
    for (const v of voiceList) {
        const waId = v.whatsappId
        try {
            await sql.unsafe(
                `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, media_type, status, whatsapp_id)
                 VALUES ($1::uuid, $2::uuid, 'ai', $3, $4, $5, $6)`,
                [
                    contact_id,
                    conversationId,
                    `[Áudio] ${v.transcript}`,
                    'audio/mpeg',
                    'sent',
                    waId
                ]
            )
        } catch (e) {
            console.error('runAiProcess: persist voice message', e)
        }
    }
    if (voiceList.length > 0) {
        await setFollowupAnchorForConversation(workspace_slug, conversationId).catch(() => {})
    }

    const hadVoiceOnly = voiceList.length > 0
    let textToSave = (response.text ?? '').trim()
    if (!textToSave && response.shouldHandoff) {
        textToSave =
            config.handoff_default_reply?.trim() || 'Vou te transferir para um especialista agora.'
    }
    if (!textToSave && !response.shouldHandoff && !hadVoiceOnly) {
        console.warn('runAiProcess: LLM returned empty text', {
            workspace_slug,
            contact_id,
            conversationId
        })
        textToSave = EMPTY_LLM_FALLBACK
    }

    const chunks = aiReplyChunks(textToSave, config)
    addRunStep('response_chunked', { totalChunks: chunks.length, chunkSizes: chunks.map(c => c.length) })
    let sendFailed = false
    const gapMs = config.send_delay_ms ?? 1200
    const sendOpts = sendOptionsFromConfig(config)

    if (chunks.length > 0) {
        for (let i = 0; i < chunks.length; i++) {
            if (i > 0) await sleep(gapMs)
            const chunk = chunks[i]
            const textToSend = parseMessageForWhatsApp(chunk)
            const savedRows = await sql.unsafe(
                `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, status)
                 VALUES ($1::uuid, $2::uuid, 'ai', $3, 'sending')
                 RETURNING id`,
                [contact_id, conversationId, chunk]
            )
            const savedMsg = savedRows[0] as unknown as { id: string } | undefined
            try {
                const { provider } = await getProviderForWorkspace(supabase, workspace_slug)
                const sendRes = await provider.sendText(
                    instance.instance_token,
                    context.contactPhone,
                    textToSend,
                    sendOpts
                )
                addRunStep('message_sent', { chunk: i + 1, total: chunks.length, textPreview: chunk.slice(0, 60) })
                if (savedMsg) {
                    await sql.unsafe(
                        `UPDATE ${sch}.messages SET status = 'sent', whatsapp_id = $2 WHERE id = $1::uuid`,
                        [savedMsg.id, sendRes.messageId]
                    )
                }
            } catch (sendErr) {
                const errDetail = sendErr instanceof Error ? sendErr.message : String(sendErr)
                addRunStep('message_send_failed', { chunk: i + 1, error: errDetail.slice(0, 200) })
                console.error(`[runAiProcess] SEND FAILED chunk ${i + 1}/${chunks.length}:`, errDetail, {
                    workspace: workspace_slug,
                    contact: contact_id,
                    conversation: conversationId
                })
                sendFailed = true
                if (savedMsg) {
                    await sql.unsafe(`UPDATE ${sch}.messages SET status = 'failed' WHERE id = $1::uuid`, [
                        savedMsg.id
                    ])
                }
                break
            }
        }
        if (!sendFailed) {
            await setFollowupAnchorForConversation(workspace_slug, conversationId).catch(() => {})
        }
    }

    if (sendFailed) {
        await finishAgentRun({ status: 'error', errorMessage: 'Failed to send AI reply' })
        return { ok: false, status: 502, error: 'Failed to send AI reply' }
    }

    if (response.shouldHandoff) {
        await sql.unsafe(
            `UPDATE ${sch}.ai_conversations SET status = 'handed_off', handoff_reason = $2 WHERE id = $1::uuid`,
            [conversationId, response.handoffReason ?? null]
        )
    } else {
        const { data: incRows, error: incErr } = await supabase.rpc('increment_ai_conversation_if_under_cap', {
            p_tenant: workspace_slug,
            p_conv_id: conversationId,
            p_cap: config.max_messages_per_conversation
        })

        if (!incErr && Array.isArray(incRows) && incRows.length > 0) {
            const row = incRows[0] as { new_count: number | null; updated_ok: boolean }
            if (!row.updated_ok) {
                await sql.unsafe(
                    `UPDATE ${sch}.ai_conversations SET status = 'handed_off', handoff_reason = $2 WHERE id = $1::uuid`,
                    [conversationId, 'Limite de mensagens atingido']
                )
            }
        } else {
            await sql.unsafe(
                `UPDATE ${sch}.ai_conversations SET messages_count = messages_count + 1 WHERE id = $1::uuid`,
                [conversationId]
            )
        }
    }

    await finishAgentRun({ status: 'success', reason: null })
    return { ok: true }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!runFinished) {
            await finishAgentRun({
                status: 'error',
                errorMessage: msg.length > 2000 ? `${msg.slice(0, 2000)}…` : msg
            }).catch(() => {})
        }
        console.error('runAiProcess: unexpected', e)
        return { ok: false, status: 500, error: 'Internal processing error' }
    }
}
