import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { assertTenantSlug } from '@/lib/db/tenant-sql'

export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string }> }) {
    try {
        const { slug: rawSlug } = await ctx.params
        let slug: string
        try {
            slug = assertTenantSlug(rawSlug)
        } catch {
            return NextResponse.json({ error: 'Invalid workspace slug' }, { status: 400 })
        }

        const body = (await request.json().catch(() => ({}))) as { name?: unknown }
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name || name.length > 200) {
            return NextResponse.json({ error: 'name is required (max 200 chars)' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceRole(supabase, slug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const { data, error } = await supabase
            .from('workspaces')
            .update({ name })
            .eq('slug', slug)
            .select('id, name, slug, created_at')
            .maybeSingle()

        if (error) {
            console.error('workspace PATCH', error)
            return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
        }
        if (!data) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        return NextResponse.json({ workspace: data })
    } catch (e) {
        console.error('PATCH /api/workspaces/[slug]', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
