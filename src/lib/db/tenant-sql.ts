import postgres from 'postgres'

const globalForSql = globalThis as unknown as { tenantPostgres?: ReturnType<typeof postgres> }

/**
 * Pool pequeno: em Vercel/serverless o modo Session do Supabase (5432) esgota rápido
 * ("MaxClientsInSessionMode"). Usa Transaction pooler (6543) em DATABASE_URL e, em prod, max 1.
 */
function resolvePoolMax(): number {
    const raw = process.env.POSTGRES_POOL_MAX?.trim()
    if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n) && n >= 1 && n <= 20) return Math.floor(n)
    }
    return process.env.VERCEL ? 1 : 8
}

/** Startup GUC: pedido ao Postgres no handshake (útil com tabelas grandes / Supabase). */
function resolvePgConnectionParams(): Record<string, string> {
    const raw = process.env.POSTGRES_STATEMENT_TIMEOUT_SEC?.trim()
    if (!raw) return {}
    const sec = Number(raw)
    if (!Number.isFinite(sec) || sec < 1 || sec > 3600) return {}
    return {
        options: `-c statement_timeout=${Math.floor(sec)}s`
    }
}

/**
 * Ligação direta ao Postgres (schemas por tenant não são expostos no PostgREST por defeito).
 * Usa a mesma base que o Supabase: Settings → Database → Connection string (URI).
 * Com PgBouncer (Transaction pooler), `prepare: false` é obrigatório.
 */
export function getTenantSql() {
    const url = process.env.DATABASE_URL
    if (!url) {
        throw new Error(
            'DATABASE_URL em falta. Adiciona a URI Postgres do Supabase ao .env.local (ver .env.example).'
        )
    }
    if (!globalForSql.tenantPostgres) {
        const isLocal = url.includes('127.0.0.1') || url.includes('localhost')
        globalForSql.tenantPostgres = postgres(url, {
            max: resolvePoolMax(),
            prepare: false,
            ssl: isLocal ? false : 'require',
            connection: {
                application_name: 'agente-central-tenant',
                ...resolvePgConnectionParams()
            }
        })
    }
    return globalForSql.tenantPostgres
}

/**
 * Extrai o código de erro Postgres (e.g. '42P01', '3F000') de um objecto de erro.
 */
export function pgErrorCode(e: unknown): string {
    if (typeof e !== 'object' || e === null || !('code' in e)) return ''
    return String((e as { code: unknown }).code)
}

/**
 * Verifica se o erro indica schema ou tabela inexistente no tenant.
 * 42P01 = undefined_table, 3F000 = invalid_schema_name
 */
export function isMissingTenantSchema(e: unknown): boolean {
    const code = pgErrorCode(e)
    return code === '42P01' || code === '3F000'
}

/** Verifica se o erro é um statement_timeout (57014). */
export function isStatementTimeout(e: unknown): boolean {
    return pgErrorCode(e) === '57014'
}

export function assertTenantSlug(slug: string): string {
    const s = slug.toLowerCase()
    if (!/^[a-z0-9_]+$/.test(s)) {
        throw new Error('Invalid workspace slug')
    }
    return s
}

/** Identificador de schema já validado e citado. */
export function quotedSchema(slug: string): string {
    return `"${assertTenantSlug(slug)}"`
}
