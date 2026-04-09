/**
 * Validação partilhada para rotas internas do agente (schedule, process, followup-cron).
 * Alinhado com identificadores PostgreSQL citados (schema por tenant): até 63 chars.
 */

export const PG_SCHEMA_IDENT_MAX_LEN = 63

const WORKSPACE_SLUG_RE = /^[a-z0-9_-]+$/

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Slug normalizado (lowercase) ou null se inválido. */
export function parseWorkspaceSlugForTenantSql(input: unknown): string | null {
    if (typeof input !== 'string') return null
    const s = input.trim().toLowerCase()
    if (!s || s.length > PG_SCHEMA_IDENT_MAX_LEN) return null
    if (!WORKSPACE_SLUG_RE.test(s)) return null
    return s
}

/** UUID de contacto ou null se inválido. */
export function parseContactUuidParam(input: unknown): string | null {
    if (typeof input !== 'string') return null
    const t = input.trim()
    return UUID_RE.test(t) ? t : null
}
