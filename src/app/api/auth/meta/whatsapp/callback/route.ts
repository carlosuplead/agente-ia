import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyMetaOAuthState } from '@/lib/meta/oauth-state'
import {
    exchangeCodeForShortLivedToken,
    exchangeForLongLivedToken,
    getMetaAppId,
    getMetaAppSecret,
    getMetaOAuthRedirectUri
} from '@/lib/meta/oauth-config'
import { discoverWhatsAppPhones } from '@/lib/meta/graph-discovery'
import { setMetaPendingPickCookie } from '@/lib/meta/pending-pick-cookie'

function dashboardRedirect(status: string, workspaceSlug: string, extra?: string): NextResponse {
    const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
    const u = new URL('/dashboard', base)
    u.searchParams.set('tab', 'connection')
    u.searchParams.set('workspace', workspaceSlug)
    u.searchParams.set('meta_oauth', status)
    if (extra) u.searchParams.set('meta_oauth_error', extra)
    return NextResponse.redirect(u)
}

export async function GET(request: Request) {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const oauthErr = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (oauthErr) return dashboardRedirect('error', 'unknown', oauthErr)
    if (!code || !state) return NextResponse.json({ error: 'Invalid callback' }, { status: 400 })

    const verified = verifyMetaOAuthState(state)
    if (!verified) return NextResponse.json({ error: 'Invalid state' }, { status: 400 })

    try {
        const supabase = await createClient()
        const {
            data: { user }
        } = await supabase.auth.getUser()
        if (!user || user.id !== verified.userId) return dashboardRedirect('error', verified.workspaceSlug, 'Sessao invalida')

        const shortLived = await exchangeCodeForShortLivedToken(code, getMetaOAuthRedirectUri())
        const longLived = await exchangeForLongLivedToken(shortLived)
        const phones = await discoverWhatsAppPhones(longLived, getMetaAppId(), getMetaAppSecret())
        if (!phones.length) return dashboardRedirect('error', verified.workspaceSlug, 'Nenhum numero encontrado')

        if (phones.length === 1) {
            const p = phones[0]
            const token = `official:${verified.workspaceSlug}:${p.phone_number_id}`
            const { error } = await supabase
                .from('whatsapp_instances')
                .upsert(
                    {
                        workspace_slug: verified.workspaceSlug,
                        provider: 'official',
                        instance_token: token,
                        phone_number: p.display_phone_number || null,
                        status: 'connected',
                        phone_number_id: p.phone_number_id,
                        waba_id: p.waba_id,
                        meta_access_token: longLived,
                        meta_token_obtained_at: new Date().toISOString(),
                        last_connected_at: new Date().toISOString()
                    },
                    { onConflict: 'workspace_slug' }
                )
            if (error) return dashboardRedirect('error', verified.workspaceSlug, 'Falha ao guardar conexao')
            return dashboardRedirect('success', verified.workspaceSlug)
        }

        await setMetaPendingPickCookie({
            userId: verified.userId,
            workspaceSlug: verified.workspaceSlug,
            accessToken: longLived,
            phones
        })
        return dashboardRedirect('pick', verified.workspaceSlug)
    } catch (e) {
        console.error('meta oauth callback', e)
        return dashboardRedirect('error', verified.workspaceSlug, 'Falha no callback')
    }
}
