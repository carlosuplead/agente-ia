import { NextResponse } from 'next/server'

export function requireInternalAiSecret(request: Request): NextResponse | null {
    const secret = process.env.INTERNAL_AI_SECRET
    if (!secret) {
        console.error('INTERNAL_AI_SECRET is not set')
        return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    // 1. Check Bearer token (usado pelo addToBuffer e chamadas internas)
    const auth = request.headers.get('authorization')
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    if (token === secret) return null

    // 2. Check Vercel Cron secret (usado por Vercel Cron Jobs)
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret && token === cronSecret) return null

    // 3. Check x-vercel-cron header (Vercel sets this for cron invocations)
    const vercelCron = request.headers.get('x-vercel-cron')
    if (vercelCron === '1' || vercelCron === 'true') return null

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/**
 * Cron da fila de disparos Meta. Usa `INTERNAL_BROADCAST_SECRET` quando definido;
 * caso contrário o mesmo valor que `INTERNAL_AI_SECRET` (compatível com setups existentes).
 */
export function requireInternalBroadcastCronSecret(request: Request): NextResponse | null {
    const dedicated = process.env.INTERNAL_BROADCAST_SECRET?.trim()
    const fallback = process.env.INTERNAL_AI_SECRET?.trim()
    const secret = dedicated || fallback
    if (!secret) {
        console.error('INTERNAL_BROADCAST_SECRET or INTERNAL_AI_SECRET must be set for broadcast cron')
        return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }
    const auth = request.headers.get('authorization')
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    if (token !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return null
}
