import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { isPortalOnlyUser } from '@/lib/auth/workspace-access'

export async function updateSession(request: NextRequest): Promise<{
    response: NextResponse
    user: User | null
    portalOnly: boolean
}> {
    let supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({ request })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                }
            }
        }
    )

    const {
        data: { user }
    } = await supabase.auth.getUser()

    let portalOnly = false
    if (user) {
        portalOnly = await isPortalOnlyUser(supabase, user.id)
    }

    return { response: supabaseResponse, user, portalOnly }
}
