/**
 * Rate limiter em memória baseado em sliding window.
 *
 * ⚠️ Para produção séria com múltiplas instâncias Vercel, migre para Upstash Redis ou similar.
 * Este é um baseline defensivo que protege contra brute-force dentro de uma única instância.
 *
 * Uso:
 *   const limit = checkRateLimit(`password:${userId}`, { max: 5, windowMs: 60_000 })
 *   if (!limit.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
 */

type Bucket = {
    timestamps: number[]
}

// Map global que persiste enquanto a instância viver (serverless pode reciclar a cada N req)
const buckets = new Map<string, Bucket>()

// Limpeza periódica pra não vazar memória em keys abandonadas
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 min
let lastCleanup = Date.now()

function cleanupIfNeeded() {
    const now = Date.now()
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
    lastCleanup = now
    // Remove buckets vazios / antigos
    for (const [key, b] of buckets.entries()) {
        if (b.timestamps.length === 0 || now - (b.timestamps[b.timestamps.length - 1] ?? 0) > CLEANUP_INTERVAL_MS) {
            buckets.delete(key)
        }
    }
}

export type RateLimitOptions = {
    max: number
    windowMs: number
}

export type RateLimitResult = {
    ok: boolean
    remaining: number
    retryAfterMs: number
}

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
    cleanupIfNeeded()
    const now = Date.now()
    const windowStart = now - opts.windowMs

    let bucket = buckets.get(key)
    if (!bucket) {
        bucket = { timestamps: [] }
        buckets.set(key, bucket)
    }

    // Remove timestamps fora da janela
    bucket.timestamps = bucket.timestamps.filter(t => t > windowStart)

    if (bucket.timestamps.length >= opts.max) {
        const oldest = bucket.timestamps[0] ?? now
        const retryAfterMs = Math.max(0, opts.windowMs - (now - oldest))
        return { ok: false, remaining: 0, retryAfterMs }
    }

    bucket.timestamps.push(now)
    return {
        ok: true,
        remaining: opts.max - bucket.timestamps.length,
        retryAfterMs: 0
    }
}

/** Extrai IP do request (Vercel) para usar como chave quando userId não tá disponível. */
export function getClientIp(request: Request): string {
    const xff = request.headers.get('x-forwarded-for')
    if (xff) return xff.split(',')[0].trim()
    const real = request.headers.get('x-real-ip')
    if (real) return real.trim()
    return 'unknown'
}
