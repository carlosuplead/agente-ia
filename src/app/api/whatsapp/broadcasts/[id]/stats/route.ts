import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceInternal } from '@/lib/auth/workspace-access'
import { getTenantSql } from '@/lib/db/tenant-sql'

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(request: Request, ctx: RouteCtx) {
    try {
        const { id: broadcastId } = await ctx.params
        if (!broadcastId || !/^[0-9a-f-]{36}$/i.test(broadcastId)) {
            return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
        }

        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')?.trim()
        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceInternal(supabase, workspace_slug)
        if (!access.ok) return access.response

        const { data: b, error: bErr } = await supabase
            .from('whatsapp_broadcasts')
            .select('id, workspace_slug, max_sends_per_day, send_timezone')
            .eq('id', broadcastId)
            .single()

        if (bErr || !b || b.workspace_slug !== workspace_slug) {
            return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
        }

        const sql = getTenantSql()
        const rows = await sql.unsafe(
            `SELECT COUNT(*)::int AS c
             FROM public.whatsapp_broadcast_queue q
             INNER JOIN public.whatsapp_broadcasts b ON b.id = q.broadcast_id
             WHERE q.broadcast_id = $1::uuid
               AND q.status = 'sent'
               AND q.sent_at IS NOT NULL
               AND (q.sent_at AT TIME ZONE b.send_timezone)::date =
                   (NOW() AT TIME ZONE b.send_timezone)::date`,
            [broadcastId]
        )
        const sent_today = (rows[0] as { c?: number } | undefined)?.c ?? 0

        return NextResponse.json({
            sent_today,
            max_sends_per_day: b.max_sends_per_day,
            send_timezone: b.send_timezone
        })
    } catch (e) {
        console.error('broadcast stats GET', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
