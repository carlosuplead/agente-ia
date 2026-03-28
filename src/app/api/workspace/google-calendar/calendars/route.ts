import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireWorkspaceInternal } from '@/lib/auth/workspace-access'
import { listWritableCalendars } from '@/lib/google/calendar-client'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const workspace_slug = searchParams.get('workspace_slug')?.trim()
    if (!workspace_slug) return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })

    const supabase = await createClient()
    const access = await requireWorkspaceInternal(supabase, workspace_slug)
    if (!access.ok) return access.response

    const admin = await createAdminClient()
    const { data: row, error } = await admin
        .from('workspace_google_calendar')
        .select('refresh_token')
        .eq('workspace_slug', workspace_slug)
        .maybeSingle()

    if (error) {
        console.error('workspace_google_calendar calendars select', error)
        return NextResponse.json({ error: 'Falha ao ler ligação' }, { status: 500 })
    }
    const rt = row?.refresh_token?.trim()
    if (!rt) {
        return NextResponse.json({ error: 'Google Agenda não ligada', calendars: [] }, { status: 400 })
    }

    try {
        const calendars = await listWritableCalendars(rt)
        return NextResponse.json({ calendars })
    } catch (e) {
        console.error('listWritableCalendars', e)
        return NextResponse.json({ error: 'Falha ao listar agendas Google' }, { status: 502 })
    }
}
