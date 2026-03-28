/** Escopos: calendário + email para mostrar na UI. */
export const GOOGLE_CALENDAR_OAUTH_SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid'
].join(' ')

export function getGoogleCalendarClientId(): string {
    const id = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim()
    if (!id) throw new Error('GOOGLE_CALENDAR_CLIENT_ID is required')
    return id
}

export function getGoogleCalendarClientSecret(): string {
    const s = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim()
    if (!s) throw new Error('GOOGLE_CALENDAR_CLIENT_SECRET is required')
    return s
}

export function getGoogleCalendarOAuthRedirectUri(): string {
    if (process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI) {
        return process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI.replace(/\/$/, '')
    }
    const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
    return `${base}/api/auth/google/calendar/callback`
}
