import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { verifyGoogleCalendarOAuthState } from '@/lib/google/calendar-oauth-state'
import {
    getGoogleCalendarClientId,
    getGoogleCalendarClientSecret,
    getGoogleCalendarOAuthRedirectUri
} from '@/lib/google/calendar-oauth-config'
import { fetchGoogleAccountEmail } from '@/lib/google/calendar-client'

function homeRedirect(status: 'success' | 'error', workspaceSlug: string, extra?: string): NextResponse {
    const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
    const u = new URL('/', base)
    u.searchParams.set('tab', 'config')
    u.searchParams.set('workspace', workspaceSlug)
    u.searchParams.set('google_calendar_oauth', status)
    if (extra) u.searchParams.set('google_calendar_oauth_error', extra)
    return NextResponse.redirect(u.toString())
}

export async function GET(request: Request) {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const oauthErr = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (oauthErr) return homeRedirect('error', 'unknown', oauthErr)
    if (!code || !state) return NextResponse.json({ error: 'Invalid callback' }, { status: 400 })

    const verified = verifyGoogleCalendarOAuthState(state)
    if (!verified) return NextResponse.json({ error: 'Invalid state' }, { status: 400 })

    try {
        const supabaseUser = await createClient()
        const {
            data: { user }
        } = await supabaseUser.auth.getUser()
        if (!user || user.id !== verified.userId) {
            return homeRedirect('error', verified.workspaceSlug, 'Sessão inválida')
        }

        const oauth2 = new google.auth.OAuth2(
            getGoogleCalendarClientId(),
            getGoogleCalendarClientSecret(),
            getGoogleCalendarOAuthRedirectUri()
        )
        const { tokens } = await oauth2.getToken(code)
        const refresh = tokens.refresh_token?.trim()
        if (!refresh) {
            return homeRedirect(
                'error',
                verified.workspaceSlug,
                'Sem refresh token: remove o acesso da app em myaccount.google.com/permissions e volta a ligar.'
            )
        }

        const access = tokens.access_token?.trim()
        const email = access ? await fetchGoogleAccountEmail(access) : null

        const admin = await createAdminClient()
        const { error } = await admin.from('workspace_google_calendar').upsert(
            {
                workspace_slug: verified.workspaceSlug,
                refresh_token: refresh,
                access_token: access || null,
                token_expires_at: tokens.expiry_date
                    ? new Date(tokens.expiry_date).toISOString()
                    : null,
                calendar_id: 'primary',
                account_email: email,
                updated_at: new Date().toISOString()
            },
            { onConflict: 'workspace_slug' }
        )
        if (error) {
            console.error('workspace_google_calendar upsert', error)
            return homeRedirect('error', verified.workspaceSlug, 'Falha ao guardar ligação')
        }
        return homeRedirect('success', verified.workspaceSlug)
    } catch (e) {
        console.error('google calendar oauth callback', e)
        return homeRedirect('error', verified.workspaceSlug, 'Falha no callback OAuth')
    }
}
