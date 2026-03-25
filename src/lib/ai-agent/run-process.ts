import type { SupabaseClient } from '@supabase/supabase-js'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { buildContext } from '@/lib/ai-agent/context-builder'
import { callLLM } from '@/lib/ai-agent/llm-router'
import { parseMessageForWhatsApp } from '@/lib/ai-agent/format-for-whatsapp'
import { splitAiResponseForChunks, type AiChunkSplitMode } from '@/lib/ai-agent/split-ai-response'
import { setFollowupAnchorForConversation } from '@/lib/ai-agent/followup-anchor'
import * as uazapi from '@/lib/uazapi'
import type { AiAgentConfig } from './types'

const EMPTY_LLM_FALLBACK =
    'Desculpe, não consegui gerar uma resposta agora. Pode repetir a sua pergunta?'

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

function sendOptionsFromConfig(config: AiAgentConfig): { delayMs: number; presence: string | null } {
    const delayMs = config.send_delay_ms ?? 1200
    const p = config.send_presence
    if (p === undefined || p === null || String(p).trim() === '' || String(p).toLowerCase() === 'none') {
        return { delayMs, presence: null }
    }
    return { delayMs, presence: String(p) }
}

export type RunAiProcessResult =
    | { ok: true; reason?: string }
    | { ok: false; status: number; error: string }

export async function runAiProcess(
    supabase: SupabaseClient,
    workspace_slug: string,
    contact_id: string
): Promise<RunAiProcessResult> {
    const sql = getTenantSql()
    const sch = quotedSchema(workspace_slug)

    const configs = await sql.unsafe(`SELECT * FROM ${sch}.ai_agent_config LIMIT 1`, [])
    const config = configs[0] as unknown as AiAgentConfig | undefined

    if (!config || !config.enabled) {
        return { ok: true, reason: 'AI disabled' }
    }

    const convRows = await sql.unsafe(
        `SELECT id, status, messages_count, created_at FROM ${sch}.ai_conversations WHERE contact_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
        [contact_id]
    )
    let aiConv = convRows[0] as unknown as AiConvRow | undefined

    let conversationId = aiConv?.id
    let messageCount = aiConv?.messages_count ?? 0
    let priorAiConversationId: string | null = null
    let conversationCreatedAt: string | Date | undefined

    if (aiConv && aiConv.status === 'handed_off') {
        return { ok: true, reason: 'Already handed off' }
    }

    const inactivityHours = config.inactivity_timeout_hours ?? 24
    const inactivityMs = Math.max(1, inactivityHours) * 3600 * 1000

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

    const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_token')
        .eq('workspace_slug', workspace_slug)
        .eq('status', 'connected')
        .maybeSingle()

    if (!instance) {
        return { ok: false, status: 400, error: 'No instance connected' }
    }

    const handoffOn = config.human_handoff_enabled !== false
    if (handoffOn && config.handoff_keywords?.trim()) {
        const lastRows = await sql.unsafe(
            `SELECT body FROM ${sch}.messages WHERE contact_id = $1::uuid AND sender_type = 'contact' ORDER BY created_at DESC LIMIT 1`,
            [contact_id]
        )
        const lastBody = (lastRows[0] as unknown as { body: string | null } | undefined)?.body ?? ''
        if (matchesHandoffKeywords(lastBody, config.handoff_keywords)) {
            const reply =
                config.handoff_default_reply?.trim() ||
                'Vou direcionar você para um atendente humano. Um momento.'
            const sendOpts = sendOptionsFromConfig(config)
            const textToSend = parseMessageForWhatsApp(reply)
            const phoneRows = await sql.unsafe(
                `SELECT phone FROM ${sch}.contacts WHERE id = $1::uuid LIMIT 1`,
                [contact_id]
            )
            const contactPhone = (phoneRows[0] as unknown as { phone: string } | undefined)?.phone
            if (!contactPhone) {
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
                const sendRes = await uazapi.sendTextMessage(
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
            return { ok: true, reason: 'Keyword handoff' }
        }
    }

    const context = await buildContext(workspace_slug, contact_id, {
        maxMessages: config.context_max_messages ?? 20,
        labelTeam: config.label_team ?? 'Equipe',
        labelAssistant: config.label_assistant ?? 'Assistente',
        aiConversationId: conversationId,
        conversationCreatedAt,
        priorAiConversationId: priorAiConversationId ?? undefined
    })
    if (!context) {
        return { ok: false, status: 500, error: 'Failed to build context' }
    }

    const response = await callLLM(config, context, {
        conversationId,
        workspaceSlug: workspace_slug,
        whatsappInstanceToken: instance.instance_token
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
                const sendRes = await uazapi.sendTextMessage(
                    instance.instance_token,
                    context.contactPhone,
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

    return { ok: true }
}
