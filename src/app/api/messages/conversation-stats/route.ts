import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema, isMissingTenantSchema, isStatementTimeout } from '@/lib/db/tenant-sql'

export type ConversationStatsPayload = {
    range_days: number
    total_conversations: number
    active_conversations: number
    handed_off_conversations: number
    avg_messages_per_conversation: number
    total_contacts: number
    new_contacts_period: number
    followups_sent: number
    ai_resolved_conversations: number
    daily: ConversationStatsDaily[]
}

export type ConversationStatsDaily = {
    date: string
    conversations: number
    handoffs: number
    new_contacts: number
}

function fillDailyGaps(rows: ConversationStatsDaily[], days: number): ConversationStatsDaily[] {
    const byDate = new Map(rows.map(r => [r.date, r]))
    const out: ConversationStatsDaily[] = []
    const end = new Date()
    end.setUTCHours(0, 0, 0, 0)
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(end)
        d.setUTCDate(d.getUTCDate() - i)
        const key = d.toISOString().slice(0, 10)
        const ex = byDate.get(key)
        out.push(ex ?? { date: key, conversations: 0, handoffs: 0, new_contacts: 0 })
    }
    return out
}

function emptyPayload(days: number): ConversationStatsPayload {
    return {
        range_days: days,
        total_conversations: 0,
        active_conversations: 0,
        handed_off_conversations: 0,
        avg_messages_per_conversation: 0,
        total_contacts: 0,
        new_contacts_period: 0,
        followups_sent: 0,
        ai_resolved_conversations: 0,
        daily: fillDailyGaps([], days)
    }
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const workspace_slug = searchParams.get('workspace_slug')?.trim()
    const rangeDays = Math.min(90, Math.max(7, Number(searchParams.get('days')) || 30))

    if (!workspace_slug) {
        return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
    }

    try {
        const supabase = await createClient()
        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)

        // Conversation aggregates
        const convAgg = await sql.unsafe(
            `SELECT
                COUNT(*)::int AS total_conversations,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active_conversations,
                COUNT(*) FILTER (WHERE status = 'handed_off')::int AS handed_off_conversations,
                COALESCE(ROUND(AVG(messages_count)), 0)::int AS avg_messages_per_conversation,
                COUNT(*) FILTER (WHERE status != 'handed_off' AND status != 'active' AND messages_count > 0)::int AS ai_resolved
             FROM ${sch}.ai_conversations
             WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
            [rangeDays]
        )

        // Contact totals
        const contactAgg = await sql.unsafe(
            `SELECT
                COUNT(*)::int AS total_contacts,
                COUNT(*) FILTER (WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day'))::int AS new_contacts_period
             FROM ${sch}.contacts`,
            [rangeDays]
        )

        // Follow-ups sent in period
        const followupAgg = await sql.unsafe(
            `SELECT COUNT(*)::int AS followups_sent
             FROM ${sch}.messages
             WHERE sender_type = 'ai'
               AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
               AND conversation_id IN (
                   SELECT id FROM ${sch}.ai_conversations WHERE ai_followup_progress > 0
               )`,
            [rangeDays]
        )

        // Daily breakdown
        const dailyRows = await sql.unsafe(
            `SELECT
                (c.created_at AT TIME ZONE 'UTC')::date::text AS stats_day,
                COUNT(*)::int AS conversations,
                COUNT(*) FILTER (WHERE c.status = 'handed_off')::int AS handoffs
             FROM ${sch}.ai_conversations c
             WHERE c.created_at >= NOW() - ($1::int * INTERVAL '1 day')
             GROUP BY 1
             ORDER BY 1`,
            [rangeDays]
        )

        const dailyContacts = await sql.unsafe(
            `SELECT
                (created_at AT TIME ZONE 'UTC')::date::text AS stats_day,
                COUNT(*)::int AS new_contacts
             FROM ${sch}.contacts
             WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
             GROUP BY 1
             ORDER BY 1`,
            [rangeDays]
        )

        const convRow = convAgg[0] as Record<string, number> | undefined
        const contRow = contactAgg[0] as Record<string, number> | undefined
        const fuRow = followupAgg[0] as Record<string, number> | undefined

        const contactByDate = new Map(
            (dailyContacts as unknown as { stats_day: string; new_contacts: number }[]).map(r => [r.stats_day, r.new_contacts])
        )

        const dailyRaw: ConversationStatsDaily[] = (
            dailyRows as unknown as { stats_day: string; conversations: number; handoffs: number }[]
        ).map(r => ({
            date: r.stats_day,
            conversations: r.conversations ?? 0,
            handoffs: r.handoffs ?? 0,
            new_contacts: contactByDate.get(r.stats_day) ?? 0
        }))

        const payload: ConversationStatsPayload = {
            range_days: rangeDays,
            total_conversations: convRow?.total_conversations ?? 0,
            active_conversations: convRow?.active_conversations ?? 0,
            handed_off_conversations: convRow?.handed_off_conversations ?? 0,
            avg_messages_per_conversation: convRow?.avg_messages_per_conversation ?? 0,
            total_contacts: contRow?.total_contacts ?? 0,
            new_contacts_period: contRow?.new_contacts_period ?? 0,
            followups_sent: fuRow?.followups_sent ?? 0,
            ai_resolved_conversations: convRow?.ai_resolved ?? 0,
            daily: fillDailyGaps(dailyRaw, rangeDays)
        }

        return NextResponse.json(payload)
    } catch (e) {
        if (isMissingTenantSchema(e) || isStatementTimeout(e)) {
            return NextResponse.json(emptyPayload(rangeDays))
        }
        console.error('conversation-stats', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
