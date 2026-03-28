import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { signGoogleCalendarOAuthState } from '@/lib/google/calendar-oauth-state'
import {
    getGoogleCalendarClientId,
    getGoogleCalendarOAuthRedirectUri,
    GOOGLE_CALENDAR_OAUTH_SCOPES
} from '@/lib/google/calendar-oauth-config'

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'

export async function GET(request: Request) {
    try {
        getGoogleCalendarClientId()
    } catch {
        return NextResponse.json(
            { error: 'Google Calendar OAuth não está configurado no servidor (GOOGLE_CALENDAR_CLIENT_ID).' },
            { status: 503 }
        )
    }

    try {
        const url = new URL(request.url)
        const workspaceSlug = url.searchParams.get('workspace_slug')
        if (!workspaceSlug) return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })

        const supabase = await createClient()
        const access = await requireWorkspaceRole(supabase, workspaceSlug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const {
            data: { user }
        } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const state = signGoogleCalendarOAuthState({ userId: user.id, workspaceSlug })
        const oauth = new URL(GOOGLE_AUTH)
        oauth.searchParams.set('client_id', getGoogleCalendarClientId())
        oauth.searchParams.set('redirect_uri', getGoogleCalendarOAuthRedirectUri())
        oauth.searchParams.set('response_type', 'code')
        oauth.searchParams.set('scope', GOOGLE_CALENDAR_OAUTH_SCOPES)
        oauth.searchParams.set('state', state)
        oauth.searchParams.set('access_type', 'offline')
        oauth.searchParams.set('prompt', 'consent')
        return NextResponse.redirect(oauth.toString())
    } catch (e) {
        console.error('google calendar oauth start', e)
        return NextResponse.json({ error: 'Failed to start Google OAuth' }, { status: 500 })
    }
}
