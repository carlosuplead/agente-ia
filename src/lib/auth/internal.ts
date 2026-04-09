import { NextResponse } from 'next/server'
import { timingSafeEqualUtf8 } from '@/lib/crypto/timing-safe-utf8'

export function requireInternalAiSecret(request: Request): NextResponse | null {
    const secret = process.env.INTERNAL_AI_SECRET?.trim()
    if (!secret) {
        console.error('INTERNAL_AI_SECRET is not set')
        return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    const auth = request.headers.get('authorization')
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (timingSafeEqualUtf8(token, secret)) return null

    const cronSecret = process.env.CRON_SECRET?.trim()
    if (cronSecret && timingSafeEqualUtf8(token, cronSecret)) return null

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
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token || !timingSafeEqualUtf8(token, secret)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return null
}
