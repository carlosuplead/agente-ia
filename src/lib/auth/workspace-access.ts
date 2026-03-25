import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Acesso ao dashboard interno (IA, envio manual, etc.) — exclui `client`. */
export const INTERNAL_WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const

/** Operações do portal WhatsApp + mensagens — inclui `client`. */
export const PORTAL_WORKSPACE_ROLES = ['owner', 'admin', 'member', 'client'] as const

export type WorkspaceAccess =
    | { ok: true; userId: string; role: string }
    | { ok: false; response: NextResponse }

export async function requirePlatformAdmin(
    supabase: SupabaseClient
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
    const {
        data: { user },
        error: userError
    } = await supabase.auth.getUser()
    if (userError || !user) {
        return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }
    const { data: row } = await supabase
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
    if (!row) {
        return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }
    return { ok: true, userId: user.id }
}

export async function requireWorkspaceMember(
    supabase: SupabaseClient,
    workspaceSlug: string
): Promise<WorkspaceAccess> {
    const {
        data: { user },
        error: userError
    } = await supabase.auth.getUser()
    if (userError || !user) {
        return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }

    const { data: adminRow } = await supabase
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
    if (adminRow) {
        return { ok: true, userId: user.id, role: 'platform_admin' }
    }

    const { data: member } = await supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_slug', workspaceSlug)
        .eq('user_id', user.id)
        .maybeSingle()

    if (!member) {
        return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }

    return { ok: true, userId: user.id, role: member.role }
}

/** Bloqueia utilizadores com papel `client` (só portal). Platform admin passa. */
export async function requireWorkspaceInternal(
    supabase: SupabaseClient,
    workspaceSlug: string
): Promise<WorkspaceAccess> {
    const access = await requireWorkspaceMember(supabase, workspaceSlug)
    if (!access.ok) return access
    if (access.role === 'platform_admin') return access
    if (access.role === 'client') {
        return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }
    return access
}

/**
 * Utilizador só com acesso ao portal: não é platform admin e todas as memberships são `client`.
 * Sem memberships → false (evita redirecionar contas mal configuradas).
 */
export async function isPortalOnlyUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
    const { data: pa } = await supabase
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle()
    if (pa) return false

    const { data: rows } = await supabase.from('workspace_members').select('role').eq('user_id', userId)

    if (!rows?.length) return false
    return rows.every(r => r.role === 'client')
}

export async function requireWorkspaceRole(
    supabase: SupabaseClient,
    workspaceSlug: string,
    allowed: string[]
): Promise<WorkspaceAccess> {
    const access = await requireWorkspaceMember(supabase, workspaceSlug)
    if (!access.ok) return access
    if (access.role === 'platform_admin') return access
    if (!allowed.includes(access.role)) {
        return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }
    return access
}
