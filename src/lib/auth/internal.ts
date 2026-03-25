import { NextResponse } from 'next/server'

export function requireInternalAiSecret(request: Request): NextResponse | null {
    const secret = process.env.INTERNAL_AI_SECRET
    if (!secret) {
        console.error('INTERNAL_AI_SECRET is not set')
        return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }
    const auth = request.headers.get('authorization')
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    if (token !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return null
}
