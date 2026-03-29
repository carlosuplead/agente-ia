import { getTenantSql } from '@/lib/db/tenant-sql'

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

/**
 * Agenda processamento IA para um contato, com retry e fallback queue.
 * Se todas tentativas de chamar /api/ai/schedule falharem, insere na
 * tabela public.ai_process_fallback_queue para reprocessamento posterior.
 */
export async function addToBuffer(workspaceSlug: string, contactId: string, _messageId: string) {
    const secret = process.env.INTERNAL_AI_SECRET
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    if (!secret) {
        console.error('[buffer] INTERNAL_AI_SECRET missing; skip AI schedule')
        return
    }

    let lastError: string | null = null

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(`${base}/api/ai/schedule`, {
                method: 'POST',
                body: JSON.stringify({ workspace_slug: workspaceSlug, contact_id: contactId }),
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${secret}`
                }
            })
            if (res.ok || res.status === 200 || res.status === 202) {
                return // sucesso — sair
            }
            lastError = `HTTP ${res.status}`
            console.error(`[buffer] Tentativa ${attempt}/${MAX_RETRIES} falhou: ${lastError}`)
        } catch (e) {
            lastError = e instanceof Error ? e.message : String(e)
            console.error(`[buffer] Tentativa ${attempt}/${MAX_RETRIES} erro:`, lastError)
        }

        // Backoff exponencial (1s, 2s, 4s)
        if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)))
        }
    }

    // Todas as tentativas falharam — inserir na fila de fallback
    console.error(`[buffer] Todas ${MAX_RETRIES} tentativas falharam para ${workspaceSlug}/${contactId}. Inserindo na fallback queue.`)
    try {
        const sql = getTenantSql()
        await sql.unsafe(
            `INSERT INTO public.ai_process_fallback_queue (workspace_slug, contact_id, last_error)
             VALUES ($1, $2::uuid, $3)
             ON CONFLICT DO NOTHING`,
            [workspaceSlug, contactId, lastError ?? 'unknown']
        )
    } catch (fallbackErr) {
        console.error('[buffer] Falha ao inserir na fallback queue:', fallbackErr)
    }
}
