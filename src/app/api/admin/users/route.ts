import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/auth/workspace-access'

export async function GET() {
    try {
        const supabase = await createClient()
        const admin = await requirePlatformAdmin(supabase)
        if (!admin.ok) return admin.response

        const adminClient = await createAdminClient()

        // Listar todos os users do Supabase Auth (paginado)
        const allUsers: Array<{
            id: string
            email: string
            created_at: string
            last_sign_in_at: string | null
            full_name: string | null
        }> = []

        for (let page = 1; page <= 50; page++) {
            const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 })
            if (error || !data?.users?.length) break
            for (const u of data.users) {
                allUsers.push({
                    id: u.id,
                    email: u.email ?? '',
                    created_at: u.created_at,
                    last_sign_in_at: u.last_sign_in_at ?? null,
                    full_name: (u.user_metadata?.full_name as string) ?? null
                })
            }
            if (data.users.length < 200) break
        }

        // Buscar memberships para cada user
        const { data: memberships } = await supabase
            .from('workspace_members')
            .select('user_id, workspace_slug, role')

        const memberMap = new Map<string, Array<{ workspace_slug: string; role: string }>>()
        for (const m of memberships || []) {
            const arr = memberMap.get(m.user_id) ?? []
            arr.push({ workspace_slug: m.workspace_slug, role: m.role })
            memberMap.set(m.user_id, arr)
        }

        // Buscar admins
        const { data: admins } = await supabase.from('platform_admins').select('user_id')
        const adminIds = new Set((admins || []).map(a => a.user_id))

        const users = allUsers.map(u => ({
            ...u,
            is_platform_admin: adminIds.has(u.id),
            workspaces: memberMap.get(u.id) ?? []
        }))

        return NextResponse.json({ users })
    } catch (err) {
        console.error('admin users', err)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

/** DELETE /api/admin/users — remove um usuário e todas as suas memberships */
export async function DELETE(request: Request) {
    try {
        const supabase = await createClient()
        const admin = await requirePlatformAdmin(supabase)
        if (!admin.ok) return admin.response

        const body = await request.json().catch(() => null)
        const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : ''
        if (!userId) {
            return NextResponse.json({ error: 'user_id é obrigatório' }, { status: 400 })
        }

        // Impedir deletar a si mesmo
        const { data: { user: currentUser } } = await supabase.auth.getUser()
        if (currentUser?.id === userId) {
            return NextResponse.json({ error: 'Não é possível remover o próprio usuário' }, { status: 400 })
        }

        // Impedir deletar outros platform_admins (proteção)
        const { data: pa } = await supabase
            .from('platform_admins')
            .select('user_id')
            .eq('user_id', userId)
            .maybeSingle()
        if (pa) {
            return NextResponse.json({ error: 'Não é possível remover um administrador da plataforma' }, { status: 400 })
        }

        const adminSb = await createAdminClient()

        // 1. Remover memberships do usuário
        try {
            await adminSb.from('workspace_members').delete().eq('user_id', userId)
        } catch { /* pode não ter memberships */ }

        // 2. Remover o usuário do Supabase Auth
        const { error: deleteErr } = await adminSb.auth.admin.deleteUser(userId)
        if (deleteErr) {
            console.error('admin delete user:', deleteErr)
            return NextResponse.json({ error: 'Falha ao remover usuário: ' + deleteErr.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (err) {
        console.error('admin delete user:', err)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

/** PATCH /api/admin/users — reset de senha de um usuário */
export async function PATCH(request: Request) {
    try {
        const supabase = await createClient()
        const admin = await requirePlatformAdmin(supabase)
        if (!admin.ok) return admin.response

        const body = await request.json().catch(() => null)
        const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : ''
        const newPassword = typeof body?.new_password === 'string' ? body.new_password.trim() : ''

        if (!userId) {
            return NextResponse.json({ error: 'user_id é obrigatório' }, { status: 400 })
        }
        if (!newPassword || newPassword.length < 6) {
            return NextResponse.json({ error: 'Nova senha deve ter pelo menos 6 caracteres' }, { status: 400 })
        }

        const adminSb = await createAdminClient()

        const { error: updateErr } = await adminSb.auth.admin.updateUserById(userId, {
            password: newPassword
        })
        if (updateErr) {
            console.error('admin reset password:', updateErr)
            return NextResponse.json({ error: 'Falha ao resetar senha: ' + updateErr.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (err) {
        console.error('admin reset password:', err)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
