import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'

type RouteCtx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, ctx: RouteCtx) {
    try {
        const { id: broadcastId } = await ctx.params
        if (!broadcastId || !/^[0-9a-f-]{36}$/i.test(broadcastId)) {
            return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
        }

        const body = (await request.json().catch(() => null)) as {
            workspace_slug?: string
            action?: string
        } | null
        const workspace_slug = body?.workspace_slug?.trim()
        const action = body?.action?.trim().toLowerCase()

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }
        if (!action || !['start', 'pause', 'resume', 'cancel'].includes(action)) {
            return NextResponse.json({ error: 'action must be start, pause, resume or cancel' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceRole(supabase, workspace_slug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const { data: row, error: fetchErr } = await supabase
            .from('whatsapp_broadcasts')
            .select('id, workspace_slug, status, scheduled_at')
            .eq('id', broadcastId)
            .single()

        if (fetchErr || !row || row.workspace_slug !== workspace_slug) {
            return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
        }

        if (action === 'cancel') {
            if (!['draft', 'scheduled', 'running', 'paused'].includes(row.status)) {
                return NextResponse.json({ error: 'Não é possível cancelar neste estado' }, { status: 400 })
            }

            const { error: qErr } = await supabase
                .from('whatsapp_broadcast_queue')
                .update({ status: 'cancelled', claimed_at: null })
                .eq('broadcast_id', broadcastId)
                .in('status', ['pending', 'sending'])

            if (qErr) {
                console.error('broadcast cancel queue', qErr)
                return NextResponse.json({ error: qErr.message }, { status: 500 })
            }

            const { count: pendingLeft, error: cErr } = await supabase
                .from('whatsapp_broadcast_queue')
                .select('*', { count: 'exact', head: true })
                .eq('broadcast_id', broadcastId)
                .eq('status', 'pending')

            if (cErr) {
                return NextResponse.json({ error: cErr.message }, { status: 500 })
            }

            const { error: upErr } = await supabase
                .from('whatsapp_broadcasts')
                .update({
                    status: 'cancelled',
                    pending_count: pendingLeft ?? 0,
                    updated_at: new Date().toISOString()
                })
                .eq('id', broadcastId)

            if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
            return NextResponse.json({ success: true, status: 'cancelled' })
        }

        let nextStatus = row.status
        if (action === 'start' || action === 'resume') {
            if (row.status === 'cancelled' || row.status === 'completed' || row.status === 'failed') {
                return NextResponse.json({ error: 'Campanha já terminada ou cancelada' }, { status: 400 })
            }
            const sa = row.scheduled_at ? new Date(row.scheduled_at).getTime() : null
            if (sa != null && sa > Date.now()) {
                nextStatus = 'scheduled'
            } else {
                nextStatus = 'running'
            }
        } else if (action === 'pause') {
            if (row.status !== 'running') {
                return NextResponse.json({ error: 'Só é possível pausar uma campanha em execução' }, { status: 400 })
            }
            nextStatus = 'paused'
        }

        const { error: upErr } = await supabase
            .from('whatsapp_broadcasts')
            .update({ status: nextStatus, updated_at: new Date().toISOString() })
            .eq('id', broadcastId)

        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
        return NextResponse.json({ success: true, status: nextStatus })
    } catch (e) {
        console.error('broadcast PATCH', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
