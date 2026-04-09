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

        const fullName = (user.user_metadata?.full_name as string) || null

        return NextResponse.json({
            user: { id: user.id, email: user.email, full_name: fullName },
            is_platform_admin: !!pa,
            portal_only,
            memberships
        })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

/** PATCH /api/auth/me — atualiza o perfil (nome). */
export async function PATCH(request: Request) {
    try {
        const supabase = await createClient()
        const {
            data: { user },
            error
        } = await supabase.auth.getUser()
        if (error || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json().catch(() => null)
        const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : null

        if (fullName === null || fullName.length === 0) {
            return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
        }
        if (fullName.length > 100) {
            return NextResponse.json({ error: 'Nome muito longo' }, { status: 400 })
        }

        const { error: updateErr } = await supabase.auth.updateUser({
            data: { full_name: fullName }
        })
        if (updateErr) {
            console.error('auth me patch:', updateErr)
            return NextResponse.json({ error: 'Falha ao atualizar perfil' }, { status: 500 })
        }

        return NextResponse.json({ success: true, full_name: fullName })
    } catch {
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
