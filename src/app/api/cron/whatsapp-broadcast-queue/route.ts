import { NextResponse } from 'next/server'
import { requireInternalBroadcastCronSecret } from '@/lib/auth/internal'
import { createAdminClient } from '@/lib/supabase/server'
import { processBroadcastQueueBatch } from '@/lib/whatsapp/broadcast-worker'

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
        const r = await processBroadcastQueueBatch(supabase, { batchSize: batch, delayMs })
        return NextResponse.json(r)
    } catch (e) {
        console.error('whatsapp-broadcast-queue cron', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

export async function POST(request: Request) {
    return GET(request)
}
