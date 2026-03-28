import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireWorkspaceInternal, requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { getGoogleCalendarClientId } from '@/lib/google/calendar-oauth-config'

function oauthConfigured(): boolean {
    try {
        getGoogleCalendarClientId()
        return true
    } catch {
        return false
    }
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const workspace_slug = searchParams.get('workspace_slug')?.trim()
    if (!workspace_slug) return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })

    const supabase = await createClient()
    const access = await requireWorkspaceInternal(supabase, workspace_slug)
    if (!access.ok) return access.response

    const admin = await createAdminClient()
    const { data: row } = await admin
        .from('workspace_google_calendar')
        .select('account_email, calendar_id, default_timezone, updated_at')
        .eq('workspace_slug', workspace_slug)
        .maybeSingle()

    return NextResponse.json({
        oauth_configured: oauthConfigured(),
        connected: !!row,
        account_email: row?.account_email ?? null,
        calendar_id: row?.calendar_id ?? null,
        default_timezone: row?.default_timezone ?? null,
        updated_at: row?.updated_at ?? null
    })
}

export async function DELETE(request: Request) {
    let body: { workspace_slug?: string } = {}
    try {
        body = (await request.json()) as { workspace_slug?: string }
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const workspace_slug = typeof body.workspace_slug === 'string' ? body.workspace_slug.trim() : ''
    if (!workspace_slug) return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })

    const supabase = await createClient()
    const access = await requireWorkspaceRole(supabase, workspace_slug, ['owner', 'admin'])
    if (!access.ok) return access.response

    const admin = await createAdminClient()
    const { error } = await admin.from('workspace_google_calendar').delete().eq('workspace_slug', workspace_slug)
    if (error) {
        console.error('workspace_google_calendar delete', error)
        return NextResponse.json({ error: 'Falha ao remover' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
}

export async function PATCH(request: Request) {
    let body: { workspace_slug?: string; calendar_id?: string } = {}
    try {
        body = (await request.json()) as { workspace_slug?: string; calendar_id?: string }
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const workspace_slug = typeof body.workspace_slug === 'string' ? body.workspace_slug.trim() : ''
    const calendar_id = typeof body.calendar_id === 'string' ? body.calendar_id.trim() : ''
    if (!workspace_slug) return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
    if (!calendar_id) return NextResponse.json({ error: 'calendar_id is required' }, { status: 400 })

    const supabase = await createClient()
    const access = await requireWorkspaceRole(supabase, workspace_slug, ['owner', 'admin'])
    if (!access.ok) return access.response

    const admin = await createAdminClient()
    const { data: existing, error: selErr } = await admin
        .from('workspace_google_calendar')
        .select('workspace_slug')
        .eq('workspace_slug', workspace_slug)
        .maybeSingle()
    if (selErr) {
        console.error('workspace_google_calendar patch select', selErr)
        return NextResponse.json({ error: 'Falha ao verificar ligação' }, { status: 500 })
    }
    if (!existing) {
        return NextResponse.json({ error: 'Google Agenda não ligada' }, { status: 400 })
    }

    const { error } = await admin
        .from('workspace_google_calendar')
        .update({ calendar_id, updated_at: new Date().toISOString() })
        .eq('workspace_slug', workspace_slug)
    if (error) {
        console.error('workspace_google_calendar patch', error)
        return NextResponse.json({ error: 'Falha ao guardar agenda' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, calendar_id })
}
