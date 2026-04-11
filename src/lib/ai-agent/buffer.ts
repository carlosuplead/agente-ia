import { getTenantSql } from '@/lib/db/tenant-sql'

/**
 * Resolve a base URL do site para chamadas internas.
 */
function getBaseUrl(): string {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
    if (siteUrl && siteUrl !== 'http://localhost:3000') {
        return siteUrl
    }
    const vercelUrl = process.env.VERCEL_URL?.trim()
    if (vercelUrl) {
        return `https://${vercelUrl}`
    }
    return 'http://localhost:3000'
}

/**
 * Agenda processamento IA para um contato.
 *
 * MUDANÇA: Removido o loop de retry com sleep (1s, 2s, 4s) que bloqueava
 * a serverless function do webhook por até 7 segundos. Agora faz uma
 * única tentativa fire-and-forget. Se falhar, insere na fallback queue.
 *
 * O processamento real acontece no after() do /api/ai/schedule.
 */
export async function addToBuffer(workspaceSlug: string, contactId: string, _messageId: string) {
    const secret = process.env.INTERNAL_AI_SECRET
    const base = getBaseUrl()
    if (!secret) {
        console.error('[buffer] INTERNAL_AI_SECRET missing; skip AI schedule. Set INTERNAL_AI_SECRET env var.')
        return
    }

    try {
        // Uma única tentativa — sem retry bloqueante
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 5000) // 5s timeout
        const res = await fetch(`${base}/api/ai/schedule`, {
            method: 'POST',
            body: JSON.stringify({ workspace_slug: workspaceSlug, contact_id: contactId }),
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${secret}`
            },
            signal: controller.signal
        })
        clearTimeout(timer)
        if (res.ok || res.status === 200 || res.status === 202) {
            return // sucesso
        }
        console.error(`[buffer] Schedule falhou: HTTP ${res.status}`)
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[buffer] Schedule erro:', msg)
    }

    // Falhou — inserir na fila de fallback
    try {
        const sql = getTenantSql()
        await sql.unsafe(
            `INSERT INTO public.ai_process_fallback_queue (workspace_slug, contact_id, last_error)
             VALUES ($1, $2::uuid, $3)
             ON CONFLICT DO NOTHING`,
            [workspaceSlug, contactId, 'schedule failed']
        )
    } catch (fallbackErr) {
        console.error('[buffer] Falha ao inserir na fallback queue:', fallbackErr)
    }
}

/**
 * Processamento direto — chama runAiProcess sem HTTP intermediário.
 * Pode ser usado pelo webhook via after() para eliminar o hop HTTP.
 *
 * Uso no webhook:
 *   import { after } from 'next/server'
 *   import { processBufferDirect } from '@/lib/ai-agent/buffer'
 *   after(() => processBufferDirect(ws, contactId))
 */
export async function processBufferDirect(
    workspaceSlug: string,
    contactId: string
): Promise<void> {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { runAiProcess } = await import('@/lib/ai-agent/run-process')
    const { quotedSchema } = await import('@/lib/db/tenant-sql')

    const sql = getTenantSql()

    // Ler buffer_delay_seconds da config
    let delaySec = 30
    try {
        const sch = quotedSchema(workspaceSlug)
        const rows = await sql.unsafe(
            `SELECT buffer_delay_seconds FROM ${sch}.ai_agent_config LIMIT 1`,
            []
        )
        const raw = (rows[0] as unknown as { buffer_delay_seconds?: number } | undefined)?.buffer_delay_seconds
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            delaySec = Math.min(120, Math.max(5, Math.floor(raw)))
        }
    } catch { /* usa default */ }

    await new Promise(r => setTimeout(r, delaySec * 1000))

    const supabase = await createAdminClient()
    let acquired = false
    for (let attempt = 0; attempt < 8 && !acquired; attempt++) {
        const { data: lockOk, error: lockErr } = await supabase.rpc('try_ai_process_lock', {
            p_slug: workspaceSlug,
            p_contact: contactId,
            p_ttl_seconds: 90
        })
        if (lockErr) {
            await new Promise(r => setTimeout(r, 500))
            continue
        }
        if (lockOk === true) {
            acquired = true
            break
        }
        await new Promise(r => setTimeout(r, 500))
    }
    if (!acquired) return

    try {
        const result = await runAiProcess(supabase, workspaceSlug, contactId, { runSource: 'buffer' })
        if (!result.ok && result.status >= 500) {
            console.error('[buffer-direct] runAiProcess:', result.error)
        }
    } catch (e) {
        console.error('[buffer-direct] runAiProcess threw:', e)
    } finally {
        await supabase.rpc('release_ai_process_lock', {
            p_slug: workspaceSlug,
            p_contact: contactId
        })
    }
}
