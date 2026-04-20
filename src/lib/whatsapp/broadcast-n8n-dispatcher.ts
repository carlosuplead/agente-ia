import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'

/**
 * Dispatcher n8n-first: em vez de chamar Meta/UAZAPI directamente, empacota
 * a batch de contactos com TUDO que o n8n precisa (credenciais por workspace,
 * template, telefone, callback URL+HMAC) e faz UM POST para o webhook n8n.
 *
 * O n8n itera os `items`, envia cada um e faz POST ao `callback.url` por
 * cada resultado (sucesso ou erro). O `/api/n8n/broadcast-callback` trata
 * o update do estado da fila, contadores e memória da IA.
 *
 * Desenho preserva exactamente o mesmo state machine do `broadcast-worker.ts`
 * para poder correr lado-a-lado (opt-in via env).
 */

const DEFAULT_BATCH = 10
const MAX_BATCH = 50
const STUCK_SENDING_MINUTES = 5
const DISPATCH_TIMEOUT_MS = 20_000

type QueueRow = {
    id: string
    broadcast_id: string
    workspace_slug: string
    contact_id: string
    attempt_count: number
}

type InstanceRow = {
    provider: 'official' | 'uazapi' | null
    phone_number_id: string | null
    meta_access_token: string | null
    instance_token: string | null
    status: string | null
}

type BroadcastRow = {
    id: string
    template_name: string
    template_language: string
    template_components: unknown
    status: string
}

export type N8nDispatchItem = {
    queue_item_id: string
    broadcast_id: string
    workspace_slug: string
    contact_id: string
    phone_e164_digits: string
    provider: 'official' | 'uazapi'
    credentials: {
        meta_phone_number_id?: string
        meta_access_token?: string
        uazapi_instance_token?: string
    }
    message: {
        kind: 'template'
        template_name: string
        template_language: string
        template_components: unknown
    }
}

export type N8nDispatchPayload = {
    dispatch_id: string
    platform_version: string
    items: N8nDispatchItem[]
    callback: {
        url: string
        signature_header: string
    }
}

function resolveEnv(): {
    webhookUrl: string | null
    webhookSecret: string | null
    callbackBase: string | null
    platformVersion: string
} {
    const webhookUrl = process.env.N8N_WEBHOOK_URL?.trim() || null
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET?.trim() || null
    const callbackBase =
        process.env.N8N_CALLBACK_BASE_URL?.trim() ||
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        null
    const platformVersion = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev'
    return { webhookUrl, webhookSecret, callbackBase, platformVersion }
}

export function n8nDispatcherEnabled(): boolean {
    if (process.env.N8N_DISPATCH_ENABLED?.trim().toLowerCase() !== 'true') return false
    const { webhookUrl, webhookSecret, callbackBase } = resolveEnv()
    return Boolean(webhookUrl && webhookSecret && callbackBase)
}

async function promoteScheduledAndReconcile(sql: ReturnType<typeof getTenantSql>): Promise<void> {
    await sql.unsafe(
        `UPDATE public.whatsapp_broadcasts
         SET status = 'running', updated_at = NOW()
         WHERE status = 'scheduled'
           AND (scheduled_at IS NULL OR scheduled_at <= NOW())`
    )
    await sql.unsafe(
        `UPDATE public.whatsapp_broadcast_queue q
         SET status = 'pending', claimed_at = NULL
         FROM public.whatsapp_broadcasts b
         WHERE q.broadcast_id = b.id
           AND q.status = 'sending'
           AND q.claimed_at IS NOT NULL
           AND q.claimed_at < NOW() - ($1 * INTERVAL '1 minute')
           AND b.status IN ('running', 'scheduled', 'paused')`,
        [STUCK_SENDING_MINUTES]
    )
}

async function fetchPendingBatch(
    sql: ReturnType<typeof getTenantSql>,
    batchSize: number
): Promise<QueueRow[]> {
    const items = await sql.unsafe(
        `SELECT q.id, q.broadcast_id, q.workspace_slug, q.contact_id, q.attempt_count
         FROM public.whatsapp_broadcast_queue q
         INNER JOIN public.whatsapp_broadcasts b ON b.id = q.broadcast_id
         WHERE q.status = 'pending'
           AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= NOW())
           AND b.status IN ('running', 'scheduled')
           AND (b.scheduled_at IS NULL OR b.scheduled_at <= NOW())
           AND (
             b.max_sends_per_day IS NULL
             OR (
               SELECT COUNT(*)::int
               FROM public.whatsapp_broadcast_queue q2
               WHERE q2.broadcast_id = b.id
                 AND q2.status = 'sent'
                 AND q2.sent_at IS NOT NULL
                 AND (q2.sent_at AT TIME ZONE b.send_timezone)::date =
                     (NOW() AT TIME ZONE b.send_timezone)::date
             ) < b.max_sends_per_day
           )
         ORDER BY q.created_at ASC
         LIMIT $1`,
        [batchSize]
    )
    return items as unknown as QueueRow[]
}

async function claimItem(supabase: SupabaseClient, itemId: string): Promise<boolean> {
    const nowIso = new Date().toISOString()
    const { data } = await supabase
        .from('whatsapp_broadcast_queue')
        .update({ status: 'sending', claimed_at: nowIso })
        .eq('id', itemId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
    return Boolean(data)
}

async function releaseItem(supabase: SupabaseClient, itemId: string): Promise<void> {
    await supabase
        .from('whatsapp_broadcast_queue')
        .update({ status: 'pending', claimed_at: null })
        .eq('id', itemId)
}

async function failItem(
    supabase: SupabaseClient,
    item: QueueRow,
    reason: string
): Promise<void> {
    const attempts = item.attempt_count + 1
    await supabase
        .from('whatsapp_broadcast_queue')
        .update({
            status: 'failed',
            attempt_count: attempts,
            last_error: reason,
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
        console.error('[n8n-dispatcher] increment_broadcast_counters failed:', e)
    }
}

function normalizeComponents(raw: unknown): unknown {
    if (!raw || !Array.isArray(raw)) return []
    return raw
}

export async function dispatchBatchToN8n(
    supabase: SupabaseClient,
    opts?: { batchSize?: number }
): Promise<{
    processed: number
    errors: string[]
    dispatched: string[]
    dispatch_id?: string
}> {
    const { webhookUrl, webhookSecret, callbackBase, platformVersion } = resolveEnv()
    if (!webhookUrl || !webhookSecret) {
        return {
            processed: 0,
            errors: ['N8N_WEBHOOK_URL ou N8N_WEBHOOK_SECRET não configurados'],
            dispatched: []
        }
    }
    if (!callbackBase) {
        return {
            processed: 0,
            errors: ['N8N_CALLBACK_BASE_URL (ou NEXT_PUBLIC_APP_URL) não configurado'],
            dispatched: []
        }
    }

    const batchSize = Math.min(Math.max(opts?.batchSize ?? DEFAULT_BATCH, 1), MAX_BATCH)
    const errors: string[] = []
    const dispatched: string[] = []

    const sql = getTenantSql()
    await promoteScheduledAndReconcile(sql)
    const rows = await fetchPendingBatch(sql, batchSize)

    const payloadItems: N8nDispatchItem[] = []
    const claimedItems: QueueRow[] = []

    for (const item of rows) {
        if (!(await claimItem(supabase, item.id))) continue

        // Broadcast metadata
        const { data: bRaw } = await supabase
            .from('whatsapp_broadcasts')
            .select('id, template_name, template_language, template_components, status')
            .eq('id', item.broadcast_id)
            .maybeSingle()
        const broadcast = bRaw as BroadcastRow | null
        if (!broadcast || !['running', 'scheduled'].includes(broadcast.status)) {
            await releaseItem(supabase, item.id)
            continue
        }

        // Workspace instance
        const { data: instRaw } = await supabase
            .from('whatsapp_instances')
            .select('provider, phone_number_id, meta_access_token, instance_token, status')
            .eq('workspace_slug', item.workspace_slug)
            .maybeSingle()
        const instance = instRaw as InstanceRow | null

        if (!instance || instance.status !== 'connected') {
            await failItem(supabase, item, 'WhatsApp não ligado')
            errors.push(`${item.id}: WhatsApp não ligado`)
            continue
        }

        // Provider-specific credential check
        if (instance.provider === 'official') {
            if (!instance.phone_number_id || !instance.meta_access_token) {
                await failItem(supabase, item, 'Credenciais Meta Cloud em falta')
                errors.push(`${item.id}: Credenciais Meta Cloud em falta`)
                continue
            }
        }
        // NOTE: UAZAPI para disparos não está suportado nesta iteração; os
        // workspaces com provider=uazapi ainda usam o worker antigo. Quando
        // ampliarmos UAZAPI para templates, devolver aqui `uazapi_instance_token`.
        if (instance.provider !== 'official') {
            await failItem(supabase, item, 'Disparos só suportam provider=oficial nesta versão')
            errors.push(`${item.id}: provider ${instance.provider} não suportado para disparos`)
            continue
        }

        // Contact phone (per-tenant schema)
        const sch = quotedSchema(item.workspace_slug)
        const contacts = await sql.unsafe(
            `SELECT phone FROM ${sch}.contacts WHERE id = $1::uuid LIMIT 1`,
            [item.contact_id]
        )
        const rawPhone = (contacts[0] as { phone?: string } | undefined)?.phone?.trim()
        if (!rawPhone) {
            await failItem(supabase, item, 'Contacto sem telefone')
            errors.push(`${item.id}: Contacto sem telefone`)
            continue
        }
        const phoneDigits = rawPhone.replace(/\D/g, '')
        if (!phoneDigits) {
            await failItem(supabase, item, 'Telefone inválido')
            errors.push(`${item.id}: Telefone inválido`)
            continue
        }

        payloadItems.push({
            queue_item_id: item.id,
            broadcast_id: item.broadcast_id,
            workspace_slug: item.workspace_slug,
            contact_id: item.contact_id,
            phone_e164_digits: phoneDigits,
            provider: 'official',
            credentials: {
                meta_phone_number_id: instance.phone_number_id!,
                meta_access_token: instance.meta_access_token!
            },
            message: {
                kind: 'template',
                template_name: broadcast.template_name,
                template_language: broadcast.template_language,
                template_components: normalizeComponents(broadcast.template_components)
            }
        })
        claimedItems.push(item)
    }

    if (payloadItems.length === 0) {
        return { processed: 0, errors, dispatched: [] }
    }

    const dispatchId = crypto.randomUUID()
    const callbackUrl = `${callbackBase.replace(/\/+$/, '')}/api/n8n/broadcast-callback`
    const payload: N8nDispatchPayload = {
        dispatch_id: dispatchId,
        platform_version: platformVersion,
        items: payloadItems,
        callback: {
            url: callbackUrl,
            signature_header: 'X-Broadcast-Signature'
        }
    }
    const bodyStr = JSON.stringify(payload)
    const signature = crypto.createHmac('sha256', webhookSecret).update(bodyStr).digest('hex')

    try {
        const controller = new AbortController()
        const tid = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS)
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Platform-Signature': signature,
                'X-Dispatch-Id': dispatchId
            },
            body: bodyStr,
            signal: controller.signal
        })
        clearTimeout(tid)

        if (!res.ok) {
            const txt = await res.text().catch(() => '')
            for (const it of claimedItems) await releaseItem(supabase, it.id)
            errors.push(`n8n HTTP ${res.status}: ${txt.slice(0, 300)}`)
            return { processed: claimedItems.length, errors, dispatched: [], dispatch_id: dispatchId }
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        for (const it of claimedItems) await releaseItem(supabase, it.id)
        errors.push(`Dispatch para n8n falhou: ${msg}`)
        return { processed: claimedItems.length, errors, dispatched: [], dispatch_id: dispatchId }
    }

    for (const it of claimedItems) dispatched.push(it.id)

    return {
        processed: claimedItems.length,
        errors,
        dispatched,
        dispatch_id: dispatchId
    }
}
