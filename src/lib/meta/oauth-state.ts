import crypto from 'crypto'

type StatePayload = {
    userId: string
    workspaceSlug: string
}

const TTL_MS = 10 * 60 * 1000

function secret(): string {
    const s = process.env.META_OAUTH_STATE_SECRET?.trim() || process.env.META_APP_SECRET?.trim()
    if (!s) throw new Error('META_OAUTH_STATE_SECRET or META_APP_SECRET is required')
    return s
}

export function signMetaOAuthState(payload: StatePayload): string {
    const body = Buffer.from(
        JSON.stringify({
            sub: payload.userId,
            ws: payload.workspaceSlug,
            n: crypto.randomBytes(16).toString('hex'),
            exp: Date.now() + TTL_MS
        }),
        'utf8'
    ).toString('base64url')
    const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url')
    return `${body}.${sig}`
}

export function verifyMetaOAuthState(state: string): StatePayload | null {
    try {
        const i = state.lastIndexOf('.')
        if (i < 1) return null
        const body = state.slice(0, i)
        const sig = state.slice(i + 1)
        const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url')
        const sb = Buffer.from(sig)
        const eb = Buffer.from(expected)
        if (sb.length !== eb.length || !crypto.timingSafeEqual(sb, eb)) return null
        const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
            sub?: string
            ws?: string
            exp?: number
        }
        if (!parsed.sub || !parsed.ws || typeof parsed.exp !== 'number') return null
        if (Date.now() > parsed.exp) return null
        return { userId: parsed.sub, workspaceSlug: parsed.ws }
    } catch {
        return null
    }
}
