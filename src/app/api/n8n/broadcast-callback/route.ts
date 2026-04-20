import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { timingSafeEqualUtf8 } from '@/lib/crypto/timing-safe-utf8'

/**
 * Callback recebido do n8n após cada tentativa de envio de uma mensagem do
 * disparo. Valida HMAC (partilhada entre plataforma e n8n via
 * N8N_WEBHOOK_SECRET), actualiza o estado da fila e, em caso de sucesso,
 * escreve a mensagem na memória da IA do tenant.
 *
 * Espelha a lógica pós-envio do `broadcast-worker.ts` (contadores atómicos,
 * retries com backoff linear, finalização da campanha).
 */

const MAX_ATTEMPTS = 5
const BACKOFF_BASE_MS = 60_000

type CallbackBody = {
    queue_item_id: string
    dispatch_id?: string
    status: 'sent' | 'failed'
    whatsapp_message_id?: string | null
    error?: string | null
}

type QueueItemRow = {
    id: string
    broadcast_id: string
    workspace_slug: string
    contact_id: string
    attempt_count: number
    status: string
}

export async function POST(request: Request): Promise<Response> {
    const secret = process.env.N8N_WEBHOOK_SECRET?.trim()
    if (!secret) {
        console.error('[n8n-callback] N8N_WEBHOOK_SECRET não configurado')
        return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    const rawBody = await request.text()
    const providedSig = request.headers.get('x-broadcast-signature')?.trim() || ''
    if (!providedSig) {
        return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    if (!timingSafeEqualUtf8(providedSig, expected)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let body: CallbackBody
    try {
        body = JSON.parse(rawBody) as CallbackBody
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    if (!body.queue_item_id || (body.status !== 'sent' && body.status !== 'failed')) {
        return NextResponse.json({ error: 'Missing/invalid fields' }, { status: 400 })
    }

    const supabase = await createAdminClient()
    const { data: itemRaw } = await supabase
        .from('whatsapp_broadcast_queue')
        .select('id, broadcast_id, workspace_slug, contact_id, attempt_count, status')
        .eq('id', body.queue_item_id)
        .maybeSingle()

    const item = itemRaw as QueueItemRow | null
    if (!item) {
        return NextResponse.json({ error: 'Queue item not found' }, { status: 404 })
    }

    // Idempotência: se já foi marcado como `sent` ou `failed` definitivamente,
    // devolve 200 sem refazer as operações (evita contadores duplicados).
    if (item.status === 'sent' || item.status === 'failed') {
        return NextResponse.json({ ok: true, idempotent: true })
    }

    if (body.status === 'sent') {
        await handleSent(supabase, item, body)
        return NextResponse.json({ ok: true })
    }

    await handleFailed(supabase, item, body)
    return NextResponse.json({ ok: true })
}

async function handleSent(
    supabase: Awaited<ReturnType<typeof createAdminClient>>,
    item: QueueItemRow,
    body: CallbackBody
): Promise<void> {
    const sentAt = new Date().toISOString()
    await supabase
        .from('whatsapp_broadcast_queue')
        .update({
            status: 'sent',
            whatsapp_message_id: body.whatsapp_message_id ?? null,
            last_error: null,
            next_attempt_at: null,
            sent_at: sentAt,
            claimed_at: null
        })
        .eq('id', item.id)

    try {
        const sql = getTenantSql()
        await sql.unsafe(`SELECT public.increment_broadcast_counters($1::uuid, 1, 0)`, [
            item.broadcast_id
        ])
    } catch (e) {
        console.error('[n8n-callback] increment_broadcast_counters (sent) failed:', e)
    }

    // Memória IA — mesmo padrão do worker directo
    try {
        const { data: broadcastRaw } = await supabase
            .from('whatsapp_broadcasts')
            .select('template_name')
            .eq('id', item.broadcast_id)
            .maybeSingle()
        const broadcast = broadcastRaw as { template_name?: string } | null
        const templateName = broadcast?.template_name ?? 'unknown'

        const sql = getTenantSql()
        const sch = quotedSchema(item.workspace_slug)
        const bodyText = `[Template: ${templateName}]`

        let convId: string | null = null
        try {
            const convRows = await sql.unsafe(
                `SELECT id FROM ${sch}.ai_conversations
                 WHERE contact_id = $1::uuid AND status = 'active'
                 ORDER BY created_at DESC LIMIT 1`,
                [item.contact_id]
            )
            convId = (convRows[0] as unknown as { id: string } | undefined)?.id ?? null
        } catch {
            /* conversa activa opcional */
        }

        try {
            await sql.unsafe(
                `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, status, whatsapp_id)
                 VALUES ($1::uuid, $2::uuid, 'ai', $3, 'sent', $4)`,
                [item.contact_id, convId, bodyText, body.whatsapp_message_id ?? null]
            )
        } catch (e) {
            console.error(`[n8n-callback] falha ao guardar mensagem broadcast ${item.broadcast_id}:`, e)
        }
    } catch (e) {
        console.error('[n8n-callback] memory-write outer error:', e)
    }

    await finalizeBroadcastIfDone(supabase, item.broadcast_id)
}

async function handleFailed(
    supabase: Awaited<ReturnType<typeof createAdminClient>>,
    item: QueueItemRow,
    body: CallbackBody
): Promise<void> {
    const attempts = item.attempt_count + 1
    const errorMsg = (body.error ?? 'n8n failed').slice(0, 500)

    if (attempts >= MAX_ATTEMPTS) {
        await supabase
            .from('whatsapp_broadcast_queue')
            .update({
                status: 'failed',
                attempt_count: attempts,
                last_error: errorMsg,
                next_attempt_at: null,
                claimed_at: null
            })
            .eq('id', item.id)

        try {
            const sql = getTenantSql()
            await sql.unsafe(`SELECT public.increment_broadcast_counters($1::uuid, 0, 1)`, [
                item.broadcast_id
            ])
        } catch (e) {
            console.error('[n8n-callback] increment_broadcast_counters (failed) error:', e)
        }
        await finalizeBroadcastIfDone(supabase, item.broadcast_id)
        return
    }

    const backoffMs = BACKOFF_BASE_MS * attempts
    const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString()
    await supabase
        .from('whatsapp_broadcast_queue')
        .update({
            status: 'pending',
            attempt_count: attempts,
            last_error: errorMsg,
            next_attempt_at: nextAttemptAt,
            claimed_at: null
        })
        .eq('id', item.id)
}

async function finalizeBroadcastIfDone(
    supabase: Awaited<ReturnType<typeof createAdminClient>>,
    broadcastId: string
): Promise<void> {
    const { count, error } = await supabase
        .from('whatsapp_broadcast_queue')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .in('status', ['pending', 'sending'])

    if (error || count === null || count > 0) return

    const { data: bRaw } = await supabase
        .from('whatsapp_broadcasts')
        .select('status, sent_count, failed_count')
        .eq('id', broadcastId)
        .maybeSingle()
    const b = bRaw as { status: string; sent_count: number | null; failed_count: number | null } | null
    if (!b) return
    if (!['running', 'scheduled'].includes(b.status)) return

    const sent = b.sent_count || 0
    const failed = b.failed_count || 0
    const nextStatus = sent === 0 && failed > 0 ? 'failed' : 'completed'
    await supabase
        .from('whatsapp_broadcasts')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', broadcastId)
}
