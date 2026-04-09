import crypto from 'crypto'

/** Comparação em tempo aproximadamente constante para strings UTF-8 (segredos, tokens). */
export function timingSafeEqualUtf8(a: string, b: string): boolean {
    try {
        const ab = Buffer.from(a, 'utf8')
        const bb = Buffer.from(b, 'utf8')
        if (ab.length !== bb.length) return false
        return crypto.timingSafeEqual(ab, bb)
    } catch {
        return false
    }
}
