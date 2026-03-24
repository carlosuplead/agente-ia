export function parseMessageForWhatsApp(text: string): string {
    if (!text) return ''

    // Substituir negrito **texto** por *texto* (padrão do WhatsApp)
    let parsed = text.replace(/\*\*(.*?)\*\*/g, '*$1*')

    return parsed.trim()
}
