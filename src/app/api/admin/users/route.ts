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

        // Buscar memberships + nomes dos workspaces
        const [{ data: memberships }, { data: allWorkspaces }] = await Promise.all([
            supabase.from('workspace_members').select('user_id, workspace_slug, role'),
            supabase.from('workspaces').select('slug, name')
        ])

        const wsNameMap = new Map<string, string>()
        for (const ws of allWorkspaces || []) {
            wsNameMap.set(ws.slug, ws.name)
        }

        const memberMap = new Map<string, Array<{ workspace_slug: string; workspace_name: string; role: string }>>()
        for (const m of memberships || []) {
            const arr = memberMap.get(m.user_id) ?? []
            arr.push({
                workspace_slug: m.workspace_slug,
                workspace_name: wsNameMap.get(m.workspace_slug) || m.workspace_slug,
                role: m.role
            })
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

/** POST /api/admin/users — cria um novo cliente (usuário + workspace) */
export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const admin = await requirePlatformAdmin(supabase)
        if (!admin.ok) return admin.response

        const body = await request.json().catch(() => null)
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
        const password = typeof body?.password === 'string' ? body.password : ''

        if (!name || !email || !password) {
            return NextResponse.json({ error: 'Nome, email e senha são obrigatórios' }, { status: 400 })
        }
        if (password.length < 6) {
            return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres' }, { status: 400 })
        }

        const adminSb = await createAdminClient()

        // 1. Criar usuário no Supabase Auth
        const { data: userData, error: createErr } = await adminSb.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: name }
        })

        if (createErr) {
            if (createErr.message?.includes('already been registered')) {
                return NextResponse.json({ error: 'Este email já está cadastrado.' }, { status: 409 })
            }
            return NextResponse.json({ error: 'Falha ao criar usuário: ' + createErr.message }, { status: 500 })
        }

        const userId = userData.user?.id
        if (!userId) {
            return NextResponse.json({ error: 'Erro interno ao criar usuário' }, { status: 500 })
        }

        // 2. Gerar slug do workspace
        const slug = name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 40) + '_' + Date.now().toString(36)

        // 3. Criar workspace
        const { error: wsErr } = await supabase
            .from('workspaces')
            .insert({ name, slug })
        if (wsErr) {
            console.error('admin create client: workspace', wsErr)
            return NextResponse.json({ error: 'Usuário criado, mas falhou ao criar workspace: ' + wsErr.message }, { status: 500 })
        }

        // 4. Atribuir como owner
        const { error: memErr } = await supabase
            .from('workspace_members')
            .insert({ user_id: userId, workspace_slug: slug, role: 'owner' })
        if (memErr) {
            console.error('admin create client: membership', memErr)
            return NextResponse.json({ error: 'Workspace criado, mas falhou ao atribuir acesso' }, { status: 500 })
        }

        return NextResponse.json({ success: true, user_id: userId, workspace_slug: slug, email })
    } catch (err) {
        console.error('admin create client:', err)
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

/** PUT /api/admin/users — atribuir usuário a um workspace */
export async function PUT(request: Request) {
    try {
        const supabase = await createClient()
        const admin = await requirePlatformAdmin(supabase)
        if (!admin.ok) return admin.response

        const body = await request.json().catch(() => null)
        const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : ''
        const workspaceSlug = typeof body?.workspace_slug === 'string' ? body.workspace_slug.trim() : ''
        const role = typeof body?.role === 'string' ? body.role.trim() : ''

        if (!userId || !workspaceSlug || !role) {
            return NextResponse.json({ error: 'user_id, workspace_slug e role são obrigatórios' }, { status: 400 })
        }

        const validRoles = ['owner', 'admin', 'member', 'client']
        if (!validRoles.includes(role)) {
            return NextResponse.json({ error: `role deve ser: ${validRoles.join(', ')}` }, { status: 400 })
        }

        // Verificar se workspace existe
        const { data: ws } = await supabase
            .from('workspaces')
            .select('slug')
            .eq('slug', workspaceSlug)
            .maybeSingle()
        if (!ws) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        // Upsert membership (atualiza role se já existir)
        const adminSb = await createAdminClient()
        const { error: memErr } = await adminSb
            .from('workspace_members')
            .upsert(
                { user_id: userId, workspace_slug: workspaceSlug, role },
                { onConflict: 'user_id,workspace_slug' }
            )
        if (memErr) {
            console.error('admin assign workspace:', memErr)
            return NextResponse.json({ error: 'Falha ao atribuir: ' + memErr.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (err) {
        console.error('admin assign workspace:', err)
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
