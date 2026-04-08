import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceInternal } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import type {
    TokenUsageByConversationRow,
    TokenUsageByDayRow,
    TokenUsageByModelRow,
    TokenUsageByMonthRow,
    TokenUsagePayload
} from '@/lib/dashboard/token-usage'

function monthKeysInRange(rangeDays: number): string[] {
    const keys = new Set<string>()
    const end = new Date()
    end.setUTCHours(0, 0, 0, 0)
    for (let i = rangeDays - 1; i >= 0; i--) {
        const d = new Date(end)
        d.setUTCDate(d.getUTCDate() - i)
        keys.add(d.toISOString().slice(0, 7))
    }
    return Array.from(keys).sort()
}

function buildDailyFromRows(
    rows: { d: string; model: string; t: string | number | bigint }[],
    rangeDays: number
): TokenUsageByDayRow[] {
    const byDate = new Map<string, { total_tokens: number; by_model: Record<string, number> }>()
    const end = new Date()
    end.setUTCHours(0, 0, 0, 0)
    for (let i = rangeDays - 1; i >= 0; i--) {
        const d = new Date(end)
        d.setUTCDate(d.getUTCDate() - i)
        const key = d.toISOString().slice(0, 10)
        byDate.set(key, { total_tokens: 0, by_model: {} })
    }
    for (const r of rows) {
        const day = r.d
        const tok = Number(r.t)
        if (!Number.isFinite(tok) || tok <= 0) continue
        const entry = byDate.get(day)
        if (!entry) continue
        entry.total_tokens += tok
        const m = r.model || '—'
        entry.by_model[m] = (entry.by_model[m] || 0) + tok
    }
    return Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }))
}

function pgErrorCode(e: unknown): string {
    if (typeof e !== 'object' || e === null || !('code' in e)) return ''
    return String((e as { code: unknown }).code)
}

function isMissingTenantRelation(e: unknown): boolean {
    const c = pgErrorCode(e)
    return c === '42P01' || c === '3F000'
}

function isStatementTimeout(e: unknown): boolean {
    return pgErrorCode(e) === '57014'
}

function emptyTokenPayload(rangeDays: number): TokenUsagePayload {
    return {
        range_days: rangeDays,
        grand_total_tokens: 0,
        by_model: [],
        by_day: buildDailyFromRows([], rangeDays),
        by_month: buildMonthlyFromRows([], rangeDays),
        by_conversation: []
    }
}

function buildMonthlyFromRows(
    rows: { ym: string; model: string; t: string | number | bigint }[],
    rangeDays: number
): TokenUsageByMonthRow[] {
    const monthKeys = monthKeysInRange(rangeDays)
    const byMonth = new Map<string, { total_tokens: number; by_model: Record<string, number> }>()
    for (const m of monthKeys) {
        byMonth.set(m, { total_tokens: 0, by_model: {} })
    }
    for (const r of rows) {
        const ym = r.ym
        const tok = Number(r.t)
        if (!Number.isFinite(tok) || tok <= 0) continue
        const entry = byMonth.get(ym)
        if (!entry) continue
        entry.total_tokens += tok
        const mod = r.model || '—'
        entry.by_model[mod] = (entry.by_model[mod] || 0) + tok
    }
    return monthKeys.map(month => {
        const v = byMonth.get(month) ?? { total_tokens: 0, by_model: {} }
        return { month, total_tokens: v.total_tokens, by_model: v.by_model }
    })
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const workspace_slug = searchParams.get('workspace_slug')?.trim()
    const rangeDays = Math.min(90, Math.max(7, Number(searchParams.get('days')) || 7))

    if (!workspace_slug) {
        return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
    }

    try {
        const supabase = await createClient()

        const access = await requireWorkspaceInternal(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)

        /* Em série: evita 5 queries em paralelo a competirem pelo pool e rejeições órfãs no Promise.all. */
        const totalRow = await sql.unsafe(
            `SELECT COALESCE(SUM(total_tokens), 0)::bigint AS g
             FROM ${sch}.llm_usage
             WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
            [rangeDays]
        )
        const modelRows = await sql.unsafe(
            `SELECT provider, model,
                    SUM(prompt_tokens)::bigint AS prompt_tokens,
                    SUM(completion_tokens)::bigint AS completion_tokens,
                    SUM(total_tokens)::bigint AS total_tokens
             FROM ${sch}.llm_usage
             WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
             GROUP BY provider, model
             ORDER BY SUM(total_tokens) DESC`,
            [rangeDays]
        )
        const dayRows = await sql.unsafe(
            `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS d,
                    model,
                    SUM(total_tokens)::bigint AS t
             FROM ${sch}.llm_usage
             WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
             GROUP BY 1, 2
             ORDER BY 1, 2`,
            [rangeDays]
        )
        const monthRows = await sql.unsafe(
            `SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS ym,
                    model,
                    SUM(total_tokens)::bigint AS t
             FROM ${sch}.llm_usage
             WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
             GROUP BY 1, 2
             ORDER BY 1, 2`,
            [rangeDays]
        )
        const convRows = await sql.unsafe(
            `SELECT u.ai_conversation_id::text AS ai_conversation_id,
                    COALESCE(c.name, '') AS contact_name,
                    COALESCE(c.phone, '') AS contact_phone,
                    SUM(u.total_tokens)::bigint AS total_tokens,
                    MAX(u.created_at)::text AS last_activity_at
             FROM ${sch}.llm_usage u
             JOIN ${sch}.contacts c ON c.id = u.contact_id
             WHERE u.created_at >= NOW() - ($1::int * INTERVAL '1 day')
             GROUP BY u.ai_conversation_id, c.name, c.phone
             ORDER BY SUM(u.total_tokens) DESC NULLS LAST
             LIMIT 50`,
            [rangeDays]
        )

        const grand = Number((totalRow[0] as unknown as { g: string | number | bigint } | undefined)?.g ?? 0)

        const by_model: TokenUsageByModelRow[] = (modelRows as unknown as TokenUsageByModelRow[]).map(r => ({
            provider: String(r.provider ?? ''),
            model: String(r.model ?? ''),
            prompt_tokens: Number(r.prompt_tokens ?? 0),
            completion_tokens: Number(r.completion_tokens ?? 0),
            total_tokens: Number(r.total_tokens ?? 0)
        }))

        const by_day = buildDailyFromRows(
            dayRows as unknown as { d: string; model: string; t: string | number | bigint }[],
            rangeDays
        )

        const by_month = buildMonthlyFromRows(
            monthRows as unknown as { ym: string; model: string; t: string | number | bigint }[],
            rangeDays
        )

        const by_conversation: TokenUsageByConversationRow[] = (
            convRows as unknown as TokenUsageByConversationRow[]
        ).map(r => ({
            ai_conversation_id: String(r.ai_conversation_id ?? ''),
            contact_name: String(r.contact_name ?? ''),
            contact_phone: String(r.contact_phone ?? ''),
            total_tokens: Number(r.total_tokens ?? 0),
            last_activity_at: String(r.last_activity_at ?? '')
        }))

        const payload: TokenUsagePayload = {
            range_days: rangeDays,
            grand_total_tokens: grand,
            by_model,
            by_day,
            by_month,
            by_conversation
        }

        return NextResponse.json(payload)
    } catch (e) {
        if (isMissingTenantRelation(e) || isStatementTimeout(e)) {
            return NextResponse.json(emptyTokenPayload(rangeDays))
        }
        console.error('messages token-stats', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
