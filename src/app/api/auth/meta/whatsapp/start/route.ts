import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { signMetaOAuthState } from '@/lib/meta/oauth-state'
import { getMetaAppId, getMetaOAuthRedirectUri, META_WHATSAPP_OAUTH_SCOPES } from '@/lib/meta/oauth-config'

const META_OAUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth'

export async function GET(request: Request) {
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

        const state = signMetaOAuthState({ userId: user.id, workspaceSlug })
        const oauth = new URL(META_OAUTH_URL)
        oauth.searchParams.set('client_id', getMetaAppId())
        oauth.searchParams.set('redirect_uri', getMetaOAuthRedirectUri())
        oauth.searchParams.set('state', state)
        oauth.searchParams.set('scope', META_WHATSAPP_OAUTH_SCOPES)
        oauth.searchParams.set('response_type', 'code')
        return NextResponse.redirect(oauth.toString())
    } catch (e) {
        console.error('meta oauth start', e)
        return NextResponse.json({ error: 'Failed to start Meta OAuth' }, { status: 500 })
    }
}
