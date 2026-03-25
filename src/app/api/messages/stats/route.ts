import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import type { MessageStatsDaily, MessageStatsPayload } from '@/lib/dashboard/message-stats'

function fillDailyGaps(rows: MessageStatsDaily[], days: number): MessageStatsDaily[] {
    const byDate = new Map(rows.map(r => [r.date, r]))
    const out: MessageStatsDaily[] = []
    const end = new Date()
    end.setUTCHours(0, 0, 0, 0)
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(end)
        d.setUTCDate(d.getUTCDate() - i)
        const key = d.toISOString().slice(0, 10)
        const ex = byDate.get(key)
        out.push(ex ?? { date: key, ai: 0, contact: 0, team: 0 })
    }
    return out
}

export async function GET(request: Request) {
    try {
        const supabase = await createClient()
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')
        const rangeDays = Math.min(30, Math.max(7, Number(searchParams.get('days')) || 7))

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)

        const [aggRows, dailyRows, cfgRows] = await Promise.all([
            sql.unsafe(
                `SELECT
                    COUNT(*) FILTER (
                        WHERE sender_type = 'ai'
                        AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
                    )::int AS ai_cur,
                    COUNT(*) FILTER (
                        WHERE sender_type = 'contact'
                        AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
                    )::int AS contact_cur,
                    COUNT(*) FILTER (
                        WHERE sender_type = 'user'
                        AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
                    )::int AS team_cur,
                    COUNT(DISTINCT contact_id) FILTER (
                        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
                    )::int AS unique_contacts_cur,
                    COUNT(*) FILTER (
                        WHERE sender_type = 'ai'
                        AND created_at >= NOW() - (2 * $1::int * INTERVAL '1 day')
                        AND created_at < NOW() - ($1::int * INTERVAL '1 day')
                    )::int AS ai_prev,
                    COUNT(*) FILTER (
                        WHERE sender_type = 'contact'
                        AND created_at >= NOW() - (2 * $1::int * INTERVAL '1 day')
                        AND created_at < NOW() - ($1::int * INTERVAL '1 day')
                    )::int AS contact_prev
                 FROM ${sch}.messages`,
                [rangeDays]
            ),
            sql.unsafe(
                `SELECT
                    (created_at AT TIME ZONE 'UTC')::date::text AS stats_day,
                    COUNT(*) FILTER (WHERE sender_type = 'ai')::int AS ai,
                    COUNT(*) FILTER (WHERE sender_type = 'contact')::int AS contact,
                    COUNT(*) FILTER (WHERE sender_type = 'user')::int AS team
                 FROM ${sch}.messages
                 WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
                 GROUP BY 1
                 ORDER BY 1`,
                [rangeDays]
            ),
            sql.unsafe(`SELECT enabled FROM ${sch}.ai_agent_config LIMIT 1`, [])
        ])

        const agg = aggRows[0] as unknown as
            | {
                  ai_cur: number
                  contact_cur: number
                  team_cur: number
                  unique_contacts_cur: number
                  ai_prev: number
                  contact_prev: number
              }
            | undefined

        const agent_enabled =
            cfgRows[0] !== undefined
                ? Boolean((cfgRows[0] as unknown as { enabled?: boolean }).enabled)
                : null

        const dailyRaw: MessageStatsDaily[] = (
            dailyRows as unknown as { stats_day: string; ai: number; contact: number; team: number }[]
        ).map(r => ({
            date: r.stats_day,
            ai: r.ai ?? 0,
            contact: r.contact ?? 0,
            team: r.team ?? 0
        }))

        const payload: MessageStatsPayload = {
            range_days: rangeDays,
            agent_enabled,
            totals: {
                ai_messages: agg?.ai_cur ?? 0,
                contact_messages: agg?.contact_cur ?? 0,
                team_messages: agg?.team_cur ?? 0,
                unique_contacts: agg?.unique_contacts_cur ?? 0
            },
            previous_totals: {
                ai_messages: agg?.ai_prev ?? 0,
                contact_messages: agg?.contact_prev ?? 0
            },
            daily: fillDailyGaps(dailyRaw, rangeDays)
        }

        return NextResponse.json(payload)
    } catch (e) {
        console.error('messages stats', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
