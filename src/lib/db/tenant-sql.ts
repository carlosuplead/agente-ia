import postgres from 'postgres'

const globalForSql = globalThis as unknown as {
    tenantPostgres?: ReturnType<typeof postgres>
    tenantPostgresFailed?: boolean
}

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

/* ─── Interface mínima que as API routes usam: sql.unsafe(query, params) ─── */

type Row = Record<string, unknown>
type SqlResult = Row[] & { count: number }

interface TenantSqlLike {
    unsafe(query: string, params?: unknown[]): Promise<SqlResult>
}

/**
 * Fallback via Supabase REST API (RPC public.tenant_exec).
 * Usado quando DATABASE_URL falha (ex: Supabase pooler "Tenant or user not found"
 * ou DNS ENOTFOUND para conexão direta IPv6).
 */
function createRpcFallback(): TenantSqlLike {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessários para fallback RPC')
    }

    return {
        async unsafe(query: string, params: unknown[] = []): Promise<SqlResult> {
            const res = await fetch(`${supabaseUrl}/rest/v1/rpc/tenant_exec`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': serviceKey,
                    'Authorization': `Bearer ${serviceKey}`
                },
                body: JSON.stringify({
                    p_query: query,
                    p_params: params.map(p => p === null || p === undefined ? null : String(p))
                })
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({ message: `RPC failed: ${res.status}` }))
                const e = new Error(typeof err.message === 'string' ? err.message : JSON.stringify(err))
                // Preserve Postgres error code if present
                if (typeof err.code === 'string') (e as unknown as { code: string }).code = err.code
                throw e
            }

            const data = await res.json()
            const rows = Array.isArray(data) ? data : []
            const result = rows as SqlResult
            result.count = rows.length
            return result
        }
    }
}

/**
 * Ligação ao Postgres para queries em schemas de tenant.
 * Tenta conexão direta via DATABASE_URL primeiro.
 * Se falhar (DNS, pooler), usa fallback via Supabase REST API + RPC.
 */
export function getTenantSql(): TenantSqlLike {
    // Se já sabemos que a conexão direta falha, vai direto pro fallback
    if (globalForSql.tenantPostgresFailed) {
        return createRpcFallback()
    }

    const url = process.env.DATABASE_URL
    if (!url) {
        // Sem DATABASE_URL, tenta RPC fallback
        console.warn('[tenant-sql] DATABASE_URL em falta, usando RPC fallback')
        globalForSql.tenantPostgresFailed = true
        return createRpcFallback()
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

    const directSql = globalForSql.tenantPostgres

    // Wrapper que tenta direto, e se falhar com ENOTFOUND/Tenant, usa fallback
    return {
        async unsafe(query: string, params: unknown[] = []): Promise<SqlResult> {
            try {
                const result = await directSql.unsafe(query, params as (string | number | boolean | null)[])
                return result as unknown as SqlResult
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                const isFatal =
                    msg.includes('ENOTFOUND') ||
                    msg.includes('Tenant or user not found') ||
                    msg.includes('ECONNREFUSED') ||
                    msg.includes('connection terminated unexpectedly') ||
                    msg.includes('Connection terminated')

                if (isFatal) {
                    console.warn(`[tenant-sql] Conexão direta falhou (${msg.substring(0, 80)}), usando RPC fallback`)
                    globalForSql.tenantPostgresFailed = true
                    const fallback = createRpcFallback()
                    return fallback.unsafe(query, params)
                }
                throw e
            }
        }
    }
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
    if (code === '42P01' || code === '3F000') return true
    // RPC fallback returns the message directly
    const msg = e instanceof Error ? e.message : ''
    return msg.includes('does not exist') && (msg.includes('relation') || msg.includes('schema'))
}

/** Verifica se o erro é um statement_timeout (57014). */
export function isStatementTimeout(e: unknown): boolean {
    if (pgErrorCode(e) === '57014') return true
    const msg = e instanceof Error ? e.message : ''
    return msg.includes('statement timeout') || msg.includes('canceling statement')
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
