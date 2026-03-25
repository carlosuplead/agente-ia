/**
 * Caminho relativo seguro após OAuth (mitiga open redirect).
 * O decode em vários passos aplica-se só ao segmento de path — a query/hash não é
 * re-decodificada, para não falhar em valores legítimos com % (ex.: ?x=100%25).
 */
export function safeAuthRedirectPath(raw: string | null | undefined): string {
    const fallback = '/'
    if (raw == null || typeof raw !== 'string') return fallback
    let p = raw.trim()
    if (!p) return fallback

    const m = p.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/)
    if (!m) return fallback
    let pathPart = m[1] ?? ''
    const rest = (m[2] ?? '') + (m[3] ?? '')

    try {
        for (let i = 0; i < 4; i++) {
            const next = decodeURIComponent(pathPart.replace(/\+/g, ' '))
            if (next === pathPart) break
            pathPart = next
        }
    } catch {
        return fallback
    }

    p = pathPart + rest

    if (/[\u0000-\u001F\u007F]/.test(p) || p.includes('\\')) return fallback
    if (!p.startsWith('/') || p.startsWith('//')) return fallback
    if (p.includes('://')) return fallback
    if (pathPart.split('/').some(seg => seg === '..')) return fallback
    const dummy = 'https://__auth_redirect.invalid'
    try {
        const resolved = new URL(p, dummy)
        if (resolved.origin !== new URL(dummy).origin) return fallback
    } catch {
        return fallback
    }
    return p
}
