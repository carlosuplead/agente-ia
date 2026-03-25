import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
    if (
        request.nextUrl.pathname.startsWith('/api/whatsapp/webhook') ||
        request.nextUrl.pathname.startsWith('/api/ai/schedule') ||
        request.nextUrl.pathname.startsWith('/api/ai/followup-cron') ||
        request.nextUrl.pathname.startsWith('/api/ai/process')
    ) {
        return NextResponse.next()
    }

    const { response, user, portalOnly } = await updateSession(request)
    const path = request.nextUrl.pathname

    if (path.startsWith('/api/')) {
        return response
    }

    const isAuthPage = path.startsWith('/login') || path.startsWith('/auth')
    if (!user && !isAuthPage) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }
    if (user && path === '/login') {
        const url = request.nextUrl.clone()
        url.pathname = portalOnly ? '/portal' : '/'
        return NextResponse.redirect(url)
    }

    if (user && portalOnly) {
        const allowed =
            path.startsWith('/portal') ||
            path.startsWith('/auth') ||
            path === '/login'
        if (!allowed) {
            const url = request.nextUrl.clone()
            url.pathname = '/portal'
            return NextResponse.redirect(url)
        }
    }

    return response
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']
}
