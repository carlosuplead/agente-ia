const GRAPH_VERSION = 'v21.0'

export const META_WHATSAPP_OAUTH_SCOPES = [
    'business_management',
    'whatsapp_business_management',
    'whatsapp_business_messaging'
].join(',')

export function getMetaOAuthRedirectUri(): string {
    if (process.env.META_OAUTH_REDIRECT_URI) return process.env.META_OAUTH_REDIRECT_URI.replace(/\/$/, '')
    const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
    return `${base}/api/auth/meta/whatsapp/callback`
}

export function getMetaAppId(): string {
    const v = process.env.META_APP_ID?.trim()
    if (!v) throw new Error('META_APP_ID is required')
    return v
}

export function getMetaAppSecret(): string {
    const v = process.env.META_APP_SECRET?.trim()
    if (!v) throw new Error('META_APP_SECRET is required')
    return v
}

export async function exchangeCodeForShortLivedToken(code: string, redirectUri: string): Promise<string> {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`)
    url.searchParams.set('client_id', getMetaAppId())
    url.searchParams.set('client_secret', getMetaAppSecret())
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('code', code)
    const res = await fetch(url.toString())
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } }
    if (!res.ok || !data.access_token) throw new Error(data.error?.message || 'Falha na troca do code por token')
    return data.access_token
}

export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`)
    url.searchParams.set('grant_type', 'fb_exchange_token')
    url.searchParams.set('client_id', getMetaAppId())
    url.searchParams.set('client_secret', getMetaAppSecret())
    url.searchParams.set('fb_exchange_token', shortLivedToken)
    const res = await fetch(url.toString())
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } }
    if (!res.ok || !data.access_token) throw new Error(data.error?.message || 'Falha ao obter token de longa duração')
    return data.access_token
}
