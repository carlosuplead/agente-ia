import { cookies } from 'next/headers'

const COOKIE_NAME = 'meta_pending_pick'
const MAX_AGE_SECONDS = 10 * 60

export type PendingMetaPick = {
    userId: string
    workspaceSlug: string
    accessToken: string
    phones: Array<{
        phone_number_id: string
        waba_id: string
        display_phone_number?: string
        verified_name?: string
    }>
}

export async function setMetaPendingPickCookie(data: PendingMetaPick): Promise<void> {
    const store = await cookies()
    store.set(COOKIE_NAME, Buffer.from(JSON.stringify(data), 'utf8').toString('base64url'), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: MAX_AGE_SECONDS
    })
}

export async function readMetaPendingPickCookie(): Promise<PendingMetaPick | null> {
    const store = await cookies()
    const raw = store.get(COOKIE_NAME)?.value
    if (!raw) return null
    try {
        return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as PendingMetaPick
    } catch {
        return null
    }
}

export async function clearMetaPendingPickCookie(): Promise<void> {
    const store = await cookies()
    store.delete(COOKIE_NAME)
}
