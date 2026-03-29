/**
 * Converte markdown rico (output de LLMs) para formato WhatsApp.
 * WhatsApp suporta: *bold*, _italic_, ~strike~, ```code```
 * Mas NÃO suporta: headers (#), links markdown, fenced code blocks, etc.
 */
export function parseMessageForWhatsApp(text: string): string {
    if (!text) return ''

    let parsed = text

    // 1. Fenced code blocks (```lang\ncode\n```) → conteúdo sem backticks
    parsed = parsed.replace(/```[\w]*\n?([\s\S]*?)```/g, (_match, code: string) => {
        return code.trim()
    })

    // 2. Inline code (`text`) → texto sem backticks
    parsed = parsed.replace(/`([^`]+)`/g, '$1')

    // 3. Headers (### Header) → *Header* (negrito WhatsApp)
    parsed = parsed.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')

    // 4. Negrito markdown **texto** → *texto* (padrão WhatsApp)
    parsed = parsed.replace(/\*\*(.*?)\*\*/g, '*$1*')

    // 5. Links markdown [text](url) → text (url)
    parsed = parsed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')

    // 6. Imagens markdown ![alt](url) → alt: url
    parsed = parsed.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1: $2')

    // 7. Blockquotes (> text) → » text
    parsed = parsed.replace(/^>\s+(.+)$/gm, '» $1')

    // 8. Linhas horizontais (--- ou ***) → remover
    parsed = parsed.replace(/^[-*_]{3,}$/gm, '')

    // 9. Limpar linhas em branco consecutivas (máximo 2)
    parsed = parsed.replace(/\n{3,}/g, '\n\n')

    return parsed.trim()
}
