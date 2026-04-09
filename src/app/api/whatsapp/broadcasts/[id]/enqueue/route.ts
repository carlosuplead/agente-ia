import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type RouteCtx = { params: Promise<{ id: string }> }

function parseUuidList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x))
}

export async function POST(request: Request, ctx: RouteCtx) {
    try {
        const { id: broadcastId } = await ctx.params
        if (!broadcastId || !/^[0-9a-f-]{36}$/i.test(broadcastId)) {
            return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
        }

        const body = (await request.json().catch(() => null)) as {
            workspace_slug?: string
            contact_ids?: unknown
        } | null

        const workspace_slug = body?.workspace_slug?.trim()
        const contact_ids = parseUuidList(body?.contact_ids)

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }
        if (contact_ids.length === 0) {
            return NextResponse.json({ error: 'contact_ids deve ter pelo menos um UUID' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceRole(supabase, workspace_slug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const { data: row, error: fetchErr } = await supabase
            .from('whatsapp_broadcasts')
            .select('id, workspace_slug, status, pending_count')
            .eq('id', broadcastId)
            .maybeSingle()

        if (fetchErr || !row || row.workspace_slug !== workspace_slug) {
            return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
        }

        if (!['draft', 'paused', 'running'].includes(row.status)) {
            return NextResponse.json({ error: 'Não é possível adicionar contactos neste estado' }, { status: 400 })
        }

        const queueRows = contact_ids.map(contact_id => ({
            broadcast_id: broadcastId,
            workspace_slug,
            contact_id,
            status: 'pending' as const
        }))

        const { error: qErr } = await supabase.from('whatsapp_broadcast_queue').insert(queueRows)
        if (qErr) {
            console.error('enqueue', qErr)
            return NextResponse.json({ error: 'Falha ao enfileirar' }, { status: 500 })
        }

        const newPending = (row.pending_count || 0) + contact_ids.length
        const { error: upErr } = await supabase
            .from('whatsapp_broadcasts')
            .update({ pending_count: newPending, updated_at: new Date().toISOString() })
            .eq('id', broadcastId)

        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
        return NextResponse.json({ success: true, enqueued: contact_ids.length, pending_count: newPending })
    } catch (e) {
        console.error('broadcast enqueue', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
