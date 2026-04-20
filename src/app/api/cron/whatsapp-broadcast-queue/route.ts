import { NextResponse } from 'next/server'
import { requireInternalBroadcastCronSecret } from '@/lib/auth/internal'
import { createAdminClient } from '@/lib/supabase/server'
import { processBroadcastQueueBatch } from '@/lib/whatsapp/broadcast-worker'
import {
    dispatchBatchToN8n,
    n8nDispatcherEnabled
} from '@/lib/whatsapp/broadcast-n8n-dispatcher'

function parsePositiveInt(v: string | null, fallback: number): number {
    const n = v ? parseInt(v, 10) : NaN
    return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : fallback
}

export async function GET(request: Request) {
    const denied = requireInternalBroadcastCronSecret(request)
    if (denied) return denied

    try {
        const url = new URL(request.url)
        const batch = parsePositiveInt(url.searchParams.get('batch'), 5)
        const delayMs = parsePositiveInt(url.searchParams.get('delay_ms'), 1500)

        const supabase = await createAdminClient()

        // Modo n8n: quando N8N_DISPATCH_ENABLED=true e URL/secret/callback_base
        // estão configurados, delega o envio ao fluxo n8n (o worker directo via
        // Meta Cloud fica reservado para workspaces em que isto não esteja ligado).
        if (n8nDispatcherEnabled()) {
            const r = await dispatchBatchToN8n(supabase, { batchSize: batch })
            return NextResponse.json({ mode: 'n8n', ...r })
        }

        const r = await processBroadcastQueueBatch(supabase, { batchSize: batch, delayMs })
        return NextResponse.json({ mode: 'direct', ...r })
    } catch (e) {
        console.error('whatsapp-broadcast-queue cron', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

export async function POST(request: Request) {
    return GET(request)
}
