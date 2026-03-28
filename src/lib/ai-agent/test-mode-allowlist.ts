import { generateBrazilianPhoneVariants, normalizePhoneForBrazil } from '@/lib/phone'

/** Parte o texto da UI em tokens (linha, vírgula, ponto e vírgula). */
export function parseAllowlistEntries(raw: string | null | undefined): string[] {
    if (raw == null || !String(raw).trim()) return []
    return String(raw)
        .split(/[\n,;]+/)
        .map(s => s.trim())
        .filter(Boolean)
}

/** Normaliza cada entrada da allowlist para o mesmo formato que `contacts.phone`. */
export function normalizedAllowlistPhones(raw: string | null | undefined): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const token of parseAllowlistEntries(raw)) {
        const n = normalizePhoneForBrazil(token)
        if (!n) continue
        if (seen.has(n)) continue
        seen.add(n)
        out.push(n)
    }
    return out
}

/** True se existe pelo menos um token que normaliza para telefone não vazio. */
export function hasValidAllowlistEntry(raw: string | null | undefined): boolean {
    return normalizedAllowlistPhones(raw).length > 0
}

function variantSet(phone: string): Set<string> {
    return new Set(generateBrazilianPhoneVariants(phone))
}

/** Compara `contactPhone` (canónico na BD) com entradas já normalizadas da allowlist. */
export function contactPhoneMatchesAllowlist(contactPhone: string, allowlistNormalized: string[]): boolean {
    if (!contactPhone || allowlistNormalized.length === 0) return false
    const contactVars = variantSet(contactPhone)
    for (const entry of allowlistNormalized) {
        for (const v of generateBrazilianPhoneVariants(entry)) {
            if (contactVars.has(v)) return true
        }
    }
    return false
}

export type AiTestModeConfigSlice = {
    ai_test_mode?: boolean | null
    ai_test_allowlist_phones?: string | null
}

export function isAiTestModeRestricting(config: AiTestModeConfigSlice): boolean {
    if (config.ai_test_mode !== true) return false
    return normalizedAllowlistPhones(config.ai_test_allowlist_phones).length > 0
}

export function shouldAcceptInboundForTestMode(
    config: AiTestModeConfigSlice,
    normalizedContactPhone: string
): boolean {
    if (!isAiTestModeRestricting(config)) return true
    const list = normalizedAllowlistPhones(config.ai_test_allowlist_phones)
    return contactPhoneMatchesAllowlist(normalizedContactPhone, list)
}
