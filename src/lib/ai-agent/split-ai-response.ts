export type AiChunkSplitMode = 'paragraph' | 'lines'

const MIN_MERGE_LEN = 24

function mergeShortParts(parts: string[]): string[] {
    const out: string[] = []
    for (const p of parts) {
        const t = p.trim()
        if (!t) continue
        if (out.length === 0) {
            out.push(t)
            continue
        }
        if (t.length < MIN_MERGE_LEN) {
            out[out.length - 1] = `${out[out.length - 1]}\n${t}`
        } else {
            out.push(t)
        }
    }
    return out
}

function capParts(parts: string[], maxParts: number): string[] {
    const cap = Math.max(1, Math.min(20, maxParts))
    if (parts.length <= cap) return parts
    const head = parts.slice(0, cap - 1)
    const tail = parts.slice(cap - 1).join('\n\n')
    return [...head, tail]
}

/**
 * Divide o texto bruto do LLM em segmentos para envio como várias mensagens WhatsApp.
 * Cada segmento deve ainda passar por `parseMessageForWhatsApp` antes do envio.
 */
export function splitAiResponseForChunks(
    raw: string,
    mode: AiChunkSplitMode,
    maxParts: number
): string[] {
    const text = raw.trim()
    if (!text) return []

    let parts: string[]
    if (mode === 'lines') {
        parts = text
            .split(/\n+/)
            .map(s => s.trim())
            .filter(Boolean)
    } else {
        parts = text
            .split(/\n\s*\n+/)
            .map(s => s.trim())
            .filter(Boolean)
    }

    if (parts.length === 0) return [text]
    if (parts.length === 1) return parts

    const merged = mergeShortParts(parts)
    return capParts(merged, maxParts)
}
