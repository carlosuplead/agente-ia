import type { SupabaseClient } from '@supabase/supabase-js'
import { getTenantSql } from '@/lib/db/tenant-sql'

/**
 * Resolve user id por email: primeiro SQL em auth.users (fiável), depois Admin API paginada.
 * A listagem paginada falha quando o utilizador não está na primeira página.
 */
export async function findAuthUserIdByEmail(
    admin: SupabaseClient,
    emailNorm: string,
    maxPages = 25
): Promise<string | null> {
    const want = emailNorm.toLowerCase().trim()
    if (!want) return null

    try {
        const sql = getTenantSql()
        const rows = await sql.unsafe(
            `SELECT id::text AS id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`,
            [want]
        )
        const id = (rows[0] as { id?: string } | undefined)?.id
        if (id) return id
    } catch (e) {
        console.warn('findAuthUserIdByEmail: auth.users SQL lookup failed', e)
    }

    for (let page = 1; page <= maxPages; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
        if (error || !data?.users?.length) return null
        const u = data.users.find(x => x.email?.toLowerCase() === want)
        if (u?.id) return u.id
        if (data.users.length < 200) break
    }
    return null
}
