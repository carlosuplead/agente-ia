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
