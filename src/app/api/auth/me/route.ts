import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isPortalOnlyUser } from '@/lib/auth/workspace-access'

export async function GET() {
    try {
        const supabase = await createClient()
        const {
            data: { user },
            error
        } = await supabase.auth.getUser()
        if (error || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: pa } = await supabase
            .from('platform_admins')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle()

        const { data: membershipRows } = await supabase
            .from('workspace_members')
            .select('workspace_slug, role')
            .eq('user_id', user.id)

        const memberships =
            membershipRows?.map(r => ({
                workspace_slug: r.workspace_slug as string,
                role: r.role as string
            })) ?? []

        const portal_only = await isPortalOnlyUser(supabase, user.id)

        return NextResponse.json({
            user: { id: user.id, email: user.email },
            is_platform_admin: !!pa,
            portal_only,
            memberships
        })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
