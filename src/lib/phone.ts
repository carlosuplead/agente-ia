export function getLast8Digits(phone: string): string {
    const digits = phone.replace(/\D/g, '')
    return digits.slice(-8)
}

export function isWhatsAppGroup(phone: string): boolean {
    const digits = phone.replace(/\D/g, '')
    // Tipycally groups in Evolution/Z-API have 15+ numbers or end with @g.us
    if (digits.length >= 15 || phone.includes('@g.us')) return true
    return false
}

export function normalizePhoneForBrazil(phone: string): string {
    if (!phone) return ''
    let digits = phone.replace(/\D/g, '')
    
    // Auto-prepend 55 for short brazilian numbers (not perfect but handles 90% of cases locally)
    if (digits.length === 10 || digits.length === 11) {
        digits = '55' + digits
    }
    
    if (!digits.startsWith('55')) {
        // Not a brazilian number or already has full code
        return '+' + digits
    }

    // Is Brazilian number
    const ddd = digits.substring(2, 4)
    const rest = digits.substring(4)

    // Ensure 9th digit
    if (rest.length === 8) {
        return `+55${ddd}9${rest}`
    } else if (rest.length === 9) {
        return `+55${ddd}${rest}`
    }

    return '+' + digits
}

export function generateBrazilianPhoneVariants(canonicalPhone: string): string[] {
    const digits = canonicalPhone.replace(/\D/g, '')
    if (!digits.startsWith('55')) return [canonicalPhone]

    const ddd = digits.substring(2, 4)
    const rest = digits.substring(4)
    
    const variants = new Set<string>()
    variants.add(canonicalPhone)
    
    // Add without country code
    variants.add(`+${ddd}${rest}`)

    if (rest.length === 9 && rest.startsWith('9')) {
        // Variant without the 9th digit
        variants.add(`+55${ddd}${rest.substring(1)}`)
        variants.add(`+${ddd}${rest.substring(1)}`)
    } else if (rest.length === 8) {
        // Variant with the 9th digit
        variants.add(`+55${ddd}9${rest}`)
        variants.add(`+${ddd}9${rest}`)
    }

    return Array.from(variants)
}
