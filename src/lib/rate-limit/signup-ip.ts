/**
 * Limite simples por IP para POST /api/auth/signup.
 * Em serverless o Map não é partilhado entre instâncias — usa Vercel Firewall / WAF em produção para hardening.
 */

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 8
const MAX_KEYS = 5000

type Entry = { count: number; resetAt: number }

const g = globalThis as unknown as { __signupRateLimitStore?: Map<string, Entry> }
const store = g.__signupRateLimitStore ?? new Map<string, Entry>()
g.__signupRateLimitStore = store

function prune(now: number): void {
    if (store.size <= MAX_KEYS) return
    for (const [k, v] of store) {
        if (now > v.resetAt) store.delete(k)
        if (store.size <= MAX_KEYS * 0.5) break
    }
}

export function clientIpFromRequest(request: Request): string {
    const fwd = request.headers.get('x-forwarded-for')
    if (fwd) {
        const first = fwd.split(',')[0]?.trim()
        if (first) return first
    }
    const real = request.headers.get('x-real-ip')?.trim()
    if (real) return real
    return 'unknown'
}

/** true se o pedido pode prosseguir; false se excedeu o limite. */
export function allowSignupAttempt(ip: string): boolean {
    const now = Date.now()
    prune(now)
    const e = store.get(ip)
    if (!e || now > e.resetAt) {
        store.set(ip, { count: 1, resetAt: now + WINDOW_MS })
        return true
    }
    if (e.count >= MAX_ATTEMPTS) return false
    e.count += 1
    return true
}
