import postgres from 'postgres'

const globalForSql = globalThis as unknown as { tenantPostgres?: ReturnType<typeof postgres> }

/**
 * Ligação direta ao Postgres (schemas por tenant não são expostos no PostgREST por defeito).
 * Usa a mesma base que o Supabase: Settings → Database → Connection string (URI).
 * Com pooler em modo Transaction, usa `prepare: false`.
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
            max: 10,
            prepare: false,
            ssl: isLocal ? false : 'require'
        })
    }
    return globalForSql.tenantPostgres
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
