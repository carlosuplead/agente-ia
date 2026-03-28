import type { SupabaseClient } from '@supabase/supabase-js'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { sendTemplateMessage, type TemplateMessageComponent } from '@/lib/meta/templates'

const DEFAULT_BATCH = 5
const DEFAULT_DELAY_MS = 1500
const MAX_ATTEMPTS = 5

function delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
}

type QueueRow = {
    id: string
    broadcast_id: string
    workspace_slug: string
    contact_id: string
    attempt_count: number
}

type BroadcastRow = {
    id: string
    template_name: string
    template_language: string
    template_components: unknown
    status: string
}

export async function processBroadcastQueueBatch(
    supabase: SupabaseClient,
    opts?: { batchSize?: number; delayMs?: number }
): Promise<{ processed: number; errors: string[] }> {
    const batchSize = opts?.batchSize ?? DEFAULT_BATCH
    const delayMs = opts?.delayMs ?? DEFAULT_DELAY_MS
    const errors: string[] = []
    let processed = 0

    const sql = getTenantSql()
    const items = await sql.unsafe(
        `SELECT q.id, q.broadcast_id, q.workspace_slug, q.contact_id, q.attempt_count
         FROM public.whatsapp_broadcast_queue q
         INNER JOIN public.whatsapp_broadcasts b ON b.id = q.broadcast_id AND b.status = 'running'
         WHERE q.status = 'pending'
           AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= NOW())
         ORDER BY q.created_at ASC
         LIMIT $1`,
        [batchSize]
    )

    const rows = items as unknown as QueueRow[]

    for (const item of rows) {
        const { data: claimed, error: claimErr } = await supabase
            .from('whatsapp_broadcast_queue')
            .update({ status: 'sending' })
            .eq('id', item.id)
            .eq('status', 'pending')
            .select('id')
            .maybeSingle()

        if (claimErr || !claimed) continue

        const { data: broadcast, error: bErr } = await supabase
            .from('whatsapp_broadcasts')
            .select('id, template_name, template_language, template_components, status')
            .eq('id', item.broadcast_id)
            .single()

        if (bErr || !broadcast || (broadcast as BroadcastRow).status !== 'running') {
            await supabase.from('whatsapp_broadcast_queue').update({ status: 'pending' }).eq('id', item.id)
            continue
        }

        const b = broadcast as BroadcastRow

        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('phone_number_id, meta_access_token, provider, status')
            .eq('workspace_slug', item.workspace_slug)
            .maybeSingle()

        if (
            !instance ||
            instance.provider !== 'official' ||
            instance.status !== 'connected' ||
            !instance.phone_number_id ||
            !instance.meta_access_token
        ) {
            await failQueueItem(supabase, item, 'WhatsApp oficial não ligado')
            processed++
            await delay(delayMs)
            continue
        }

        const sch = quotedSchema(item.workspace_slug)
        const contacts = await sql.unsafe(`SELECT phone FROM ${sch}.contacts WHERE id = $1::uuid LIMIT 1`, [
            item.contact_id
        ])
        const phone = (contacts[0] as { phone?: string } | undefined)?.phone
        if (!phone) {
            await failQueueItem(supabase, item, 'Contacto sem telefone')
            processed++
            await delay(delayMs)
            continue
        }

        const components = normalizeComponents(b.template_components)

        try {
            const result = await sendTemplateMessage({
                phoneNumberId: instance.phone_number_id,
                accessToken: instance.meta_access_token,
                toE164Digits: phone,
                templateName: b.template_name,
                languageCode: b.template_language,
                components
            })

            await supabase
                .from('whatsapp_broadcast_queue')
                .update({
                    status: 'sent',
                    whatsapp_message_id: result.messageId,
                    last_error: null,
                    next_attempt_at: null
                })
                .eq('id', item.id)

            const { data: br } = await supabase
                .from('whatsapp_broadcasts')
                .select('sent_count, pending_count')
                .eq('id', item.broadcast_id)
                .single()
            if (br) {
                await supabase
                    .from('whatsapp_broadcasts')
                    .update({
                        sent_count: (br.sent_count || 0) + 1,
                        pending_count: Math.max(0, (br.pending_count || 0) - 1),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', item.broadcast_id)
            }

            const body = `[Template: ${b.template_name}]`
            await sql
                .unsafe(
                    `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, status, whatsapp_id)
                     VALUES ($1::uuid, NULL, 'user', $2, 'sent', $3)`,
                    [item.contact_id, body, result.messageId]
                )
                .catch(() => {})

            await finalizeBroadcastIfDone(supabase, item.broadcast_id)
            processed++
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            const attempts = item.attempt_count + 1
            if (attempts >= MAX_ATTEMPTS) {
                await supabase
                    .from('whatsapp_broadcast_queue')
                    .update({
                        status: 'failed',
                        attempt_count: attempts,
                        last_error: msg,
                        next_attempt_at: null
                    })
                    .eq('id', item.id)

                const { data: br } = await supabase
                    .from('whatsapp_broadcasts')
                    .select('failed_count, pending_count')
                    .eq('id', item.broadcast_id)
                    .single()
                if (br) {
                    await supabase
                        .from('whatsapp_broadcasts')
                        .update({
                            failed_count: (br.failed_count || 0) + 1,
                            pending_count: Math.max(0, (br.pending_count || 0) - 1),
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', item.broadcast_id)
                }
                await finalizeBroadcastIfDone(supabase, item.broadcast_id)
                errors.push(`${item.id}: ${msg}`)
            } else {
                const backoff = new Date(Date.now() + 60_000 * attempts).toISOString()
                await supabase
                    .from('whatsapp_broadcast_queue')
                    .update({
                        status: 'pending',
                        attempt_count: attempts,
                        last_error: msg,
                        next_attempt_at: backoff
                    })
                    .eq('id', item.id)
                errors.push(`${item.id}: retry ${attempts}: ${msg}`)
            }
            processed++
        }

        await delay(delayMs)
    }

    return { processed, errors }
}

function normalizeComponents(raw: unknown): TemplateMessageComponent[] {
    if (!raw) return []
    if (!Array.isArray(raw)) return []
    return raw.filter(
        (c): c is TemplateMessageComponent =>
            typeof c === 'object' && c !== null && typeof (c as TemplateMessageComponent).type === 'string'
    ) as TemplateMessageComponent[]
}

async function failQueueItem(supabase: SupabaseClient, item: QueueRow, reason: string): Promise<void> {
    const attempts = item.attempt_count + 1
    await supabase
        .from('whatsapp_broadcast_queue')
        .update({
            status: 'failed',
            attempt_count: attempts,
            last_error: reason,
            next_attempt_at: null
        })
        .eq('id', item.id)

    const { data: br } = await supabase
        .from('whatsapp_broadcasts')
        .select('failed_count, pending_count')
        .eq('id', item.broadcast_id)
        .single()
    if (br) {
        await supabase
            .from('whatsapp_broadcasts')
            .update({
                failed_count: (br.failed_count || 0) + 1,
                pending_count: Math.max(0, (br.pending_count || 0) - 1),
                updated_at: new Date().toISOString()
            })
            .eq('id', item.broadcast_id)
    }
    await finalizeBroadcastIfDone(supabase, item.broadcast_id)
}

async function finalizeBroadcastIfDone(supabase: SupabaseClient, broadcastId: string): Promise<void> {
    const { count, error } = await supabase
        .from('whatsapp_broadcast_queue')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .in('status', ['pending', 'sending'])

    if (error || count === null) return
    if (count > 0) return

    const { data: b } = await supabase
        .from('whatsapp_broadcasts')
        .select('status, sent_count, failed_count')
        .eq('id', broadcastId)
        .single()
    if (!b || b.status !== 'running') return

    const sent = b.sent_count || 0
    const failed = b.failed_count || 0
    const nextStatus = sent === 0 && failed > 0 ? 'failed' : 'completed'
    await supabase
        .from('whatsapp_broadcasts')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', broadcastId)
}
