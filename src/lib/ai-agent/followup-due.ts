import type { SupabaseClient } from '@supabase/supabase-js'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { parseMessageForWhatsApp } from '@/lib/ai-agent/format-for-whatsapp'
import { parseFollowupStepsFromConfig } from '@/lib/ai-agent/followup-steps'
import { getProviderForWorkspace } from '@/lib/whatsapp/factory'
import type { AiAgentConfig } from '@/lib/ai-agent/types'
import { shouldAcceptInboundForTestMode } from '@/lib/ai-agent/test-mode-allowlist'

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function sendOptionsFromConfig(config: AiAgentConfig): { delayMs: number; presence: string | null } {
    const delayMs = config.send_delay_ms ?? 1200
    const p = config.send_presence
    if (p === undefined || p === null || String(p).trim() === '' || String(p).toLowerCase() === 'none') {
        return { delayMs, presence: null }
    }
    return { delayMs, presence: String(p) }
}

type CandidateRow = {
    conversation_id: string
    contact_id: string
    phone: string
    messages_count: number
    ai_followup_anchor_at: string | Date
    ai_followup_progress: number
}

export async function processFollowupsForWorkspace(
    supabase: SupabaseClient,
    workspaceSlug: string
): Promise<{ scanned: number; sent: number; errors: string[] }> {
    const errors: string[] = []
    const sql = getTenantSql()
    const sch = quotedSchema(workspaceSlug)

    const cfgRows = await sql.unsafe(`SELECT * FROM ${sch}.ai_agent_config LIMIT 1`, [])
    const config = cfgRows[0] as unknown as AiAgentConfig | undefined
    if (!config?.enabled) {
        return { scanned: 0, sent: 0, errors }
    }
    if (config.ai_followup_enabled !== true) {
        return { scanned: 0, sent: 0, errors }
    }

    const steps = parseFollowupStepsFromConfig(config as unknown as Record<string, unknown>)
    if (!steps.length) {
        errors.push(`${workspaceSlug}: configure pelo menos um passo de follow-up (mensagem + tempo)`)
        return { scanned: 0, sent: 0, errors }
    }

    const cap = config.max_messages_per_conversation ?? 50
    const stepsLen = steps.length

    const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_token')
        .eq('workspace_slug', workspaceSlug)
        .eq('status', 'connected')
        .maybeSingle()

    if (!instance?.instance_token) {
        errors.push(`${workspaceSlug}: sem instância WhatsApp ligada`)
        return { scanned: 0, sent: 0, errors }
    }

    const rows = (await sql.unsafe(
        `SELECT c.id AS conversation_id, c.contact_id, c.messages_count,
                c.ai_followup_anchor_at, c.ai_followup_progress, ct.phone
         FROM ${sch}.ai_conversations c
         INNER JOIN ${sch}.contacts ct ON ct.id = c.contact_id
         WHERE c.status = 'active'
           AND c.id = (
             SELECT c2.id FROM ${sch}.ai_conversations c2
             WHERE c2.contact_id = c.contact_id AND c2.status = 'active'
             ORDER BY c2.created_at DESC
             LIMIT 1
           )
           AND c.ai_followup_anchor_at IS NOT NULL
           AND c.ai_followup_progress < $1
           AND COALESCE(c.messages_count, 0) < $2`,
        [stepsLen, cap]
    )) as unknown as CandidateRow[]

    const now = Date.now()
    const candidates = rows.filter(r => {
        const p = Number(r.ai_followup_progress)
        const step = steps[p]
        if (!step) return false
        const anchorMs = new Date(r.ai_followup_anchor_at).getTime()
        if (!Number.isFinite(anchorMs)) return false
        return now >= anchorMs + step.delay_minutes * 60 * 1000
    })

    let sent = 0
    for (const row of candidates) {
        const p = Number(row.ai_followup_progress)
        const step = steps[p]
        if (!step) continue
        if (!shouldAcceptInboundForTestMode(config, row.phone)) {
            continue
        }

        let lockAcquired = false
        for (let attempt = 0; attempt < 8 && !lockAcquired; attempt++) {
            const { data: lockOk, error: lockErr } = await supabase.rpc('try_ai_process_lock', {
                p_slug: workspaceSlug,
                p_contact: row.contact_id,
                p_ttl_seconds: 90
            })
            if (lockErr) {
                errors.push(`${workspaceSlug}: try_ai_process_lock ${lockErr.message}`)
                await sleep(400)
                continue
            }
            if (lockOk === true) {
                lockAcquired = true
                break
            }
            await sleep(400)
        }
        if (!lockAcquired) {
            continue
        }

        try {
            const textToSend = parseMessageForWhatsApp(step.message)
            const savedRows = await sql.unsafe(
                `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, status)
                 VALUES ($1::uuid, $2::uuid, 'ai', $3, 'sending')
                 RETURNING id`,
                [row.contact_id, row.conversation_id, step.message]
            )
            const savedMsg = savedRows[0] as unknown as { id: string } | undefined
            try {
                const { provider } = await getProviderForWorkspace(supabase, workspaceSlug)
                const sendRes = (await provider.sendText(
                    instance.instance_token,
                    row.phone,
                    textToSend,
                    sendOptionsFromConfig(config)
                )) as { messageId?: string }
                const waId = sendRes.messageId != null ? String(sendRes.messageId) : null
                if (savedMsg) {
                    await sql.unsafe(
                        `UPDATE ${sch}.messages SET status = 'sent', whatsapp_id = $2 WHERE id = $1::uuid`,
                        [savedMsg.id, waId]
                    )
                }
            } catch {
                if (savedMsg) {
                    await sql.unsafe(`UPDATE ${sch}.messages SET status = 'failed' WHERE id = $1::uuid`, [
                        savedMsg.id
                    ])
                }
                errors.push(`${workspaceSlug}: falha ao enviar follow-up para ${row.contact_id}`)
                continue
            }

            const { data: incRows, error: incErr } = await supabase.rpc('increment_ai_conversation_if_under_cap', {
                p_tenant: workspaceSlug,
                p_conv_id: row.conversation_id,
                p_cap: cap
            })
            if (!incErr && Array.isArray(incRows) && incRows.length > 0) {
                const ir = incRows[0] as { updated_ok?: boolean }
                if (ir.updated_ok === false) {
                    await sql.unsafe(
                        `UPDATE ${sch}.ai_conversations SET status = 'handed_off', handoff_reason = $2 WHERE id = $1::uuid`,
                        [row.conversation_id, 'Limite de mensagens atingido']
                    )
                }
            } else {
                await sql.unsafe(
                    `UPDATE ${sch}.ai_conversations SET messages_count = messages_count + 1 WHERE id = $1::uuid`,
                    [row.conversation_id]
                )
            }

            await sql.unsafe(
                `UPDATE ${sch}.ai_conversations SET ai_followup_progress = ai_followup_progress + 1 WHERE id = $1::uuid`,
                [row.conversation_id]
            )
            sent += 1
        } catch (e) {
            errors.push(
                `${workspaceSlug}: ${row.conversation_id} — ${e instanceof Error ? e.message : String(e)}`
            )
        } finally {
            await supabase.rpc('release_ai_process_lock', {
                p_slug: workspaceSlug,
                p_contact: row.contact_id
            })
        }
    }

    return { scanned: candidates.length, sent, errors }
}
