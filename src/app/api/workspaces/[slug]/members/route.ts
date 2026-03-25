import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { assertTenantSlug } from '@/lib/db/tenant-sql'

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
    try {
        const { slug: rawSlug } = await ctx.params
        let slug: string
        try {
            slug = assertTenantSlug(rawSlug)
        } catch {
            return NextResponse.json({ error: 'Invalid workspace slug' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceRole(supabase, slug, ['owner', 'admin', 'member'])
        if (!access.ok) return access.response

        const admin = await createAdminClient()
        const { data: rows, error } = await admin
            .from('workspace_members')
            .select('user_id, role, created_at')
            .eq('workspace_slug', slug)
            .order('created_at', { ascending: true })

        if (error) {
            console.error('workspace members list', error)
            return NextResponse.json({ error: 'Failed to list members' }, { status: 500 })
        }

        const members: {
            user_id: string
            role: string
            created_at: string
            email: string | null
        }[] = []

        for (const r of rows || []) {
            const uid = r.user_id as string
            let email: string | null = null
            try {
                const { data: u } = await admin.auth.admin.getUserById(uid)
                email = u.user?.email ?? null
            } catch {
                email = null
            }
            members.push({
                user_id: uid,
                role: r.role as string,
                created_at: r.created_at as string,
                email
            })
        }

        return NextResponse.json({ members })
    } catch (e) {
        console.error('GET /api/workspaces/[slug]/members', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ slug: string }> }) {
    try {
        const { slug: rawSlug } = await ctx.params
        let slug: string
        try {
            slug = assertTenantSlug(rawSlug)
        } catch {
            return NextResponse.json({ error: 'Invalid workspace slug' }, { status: 400 })
        }

        const targetUserId = new URL(request.url).searchParams.get('user_id')
        if (!targetUserId) {
            return NextResponse.json({ error: 'user_id query parameter is required' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceRole(supabase, slug, ['owner', 'admin', 'member'])
        if (!access.ok) return access.response

        const admin = await createAdminClient()
        const { data: targetRow, error: selErr } = await admin
            .from('workspace_members')
            .select('role')
            .eq('workspace_slug', slug)
            .eq('user_id', targetUserId)
            .maybeSingle()

        if (selErr || !targetRow) {
            return NextResponse.json({ error: 'Member not found' }, { status: 404 })
        }

        if (access.role === 'member' && targetRow.role !== 'client') {
            return NextResponse.json(
                { error: 'Apenas owners/admins podem remover membros que não sejam clientes do portal.' },
                { status: 403 }
            )
        }

        if (targetRow.role === 'owner') {
            const { count, error: cErr } = await admin
                .from('workspace_members')
                .select('*', { count: 'exact', head: true })
                .eq('workspace_slug', slug)
                .eq('role', 'owner')

            if (!cErr && (count ?? 0) <= 1) {
                return NextResponse.json(
                    { error: 'Não é possível remover o único owner do workspace.' },
                    { status: 400 }
                )
            }
        }

        const { error: delErr } = await admin
            .from('workspace_members')
            .delete()
            .eq('workspace_slug', slug)
            .eq('user_id', targetUserId)

        if (delErr) {
            console.error('workspace member delete', delErr)
            return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('DELETE /api/workspaces/[slug]/members', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
