import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/auth/workspace-access'

export async function GET() {
    try {
        const supabase = await createClient()
        const {
            data: { user },
            error: userError
        } = await supabase.auth.getUser()
        if (userError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: isAdmin } = await supabase
            .from('platform_admins')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle()

        if (isAdmin) {
            const { data, error } = await supabase
                .from('workspaces')
                .select('id, name, slug, created_at')
                .order('created_at', { ascending: false })
            if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
            return NextResponse.json({ workspaces: data })
        }

        const { data: members, error: memErr } = await supabase
            .from('workspace_members')
            .select('workspace_slug')
            .eq('user_id', user.id)

        if (memErr) return NextResponse.json({ error: 'Database error' }, { status: 500 })

        const slugs = [...new Set((members || []).map(m => m.workspace_slug))]
        if (slugs.length === 0) {
            return NextResponse.json({ workspaces: [] })
        }

        const { data, error } = await supabase
            .from('workspaces')
            .select('id, name, slug, created_at')
            .in('slug', slugs)
            .order('created_at', { ascending: false })

        if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
        return NextResponse.json({ workspaces: data })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const admin = await requirePlatformAdmin(supabase)
        if (!admin.ok) return admin.response

        const body = await request.json()
        const name = body.name as string | undefined
        const slug = body.slug as string | undefined

        if (!name || !slug) {
            return NextResponse.json({ error: 'name and slug are required' }, { status: 400 })
        }

        const safeSlug = slug.toLowerCase().replace(/[^a-z0-9_]/g, '_')

        const { data, error } = await supabase
            .from('workspaces')
            .insert({ name, slug: safeSlug })
            .select('*')
            .single()

        if (error) {
            if (error.code === '23505') {
                return NextResponse.json({ error: 'Slug already exists' }, { status: 409 })
            }
            return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
        }

        const { error: memErr } = await supabase.from('workspace_members').insert({
            user_id: admin.userId,
            workspace_slug: safeSlug,
            role: 'owner'
        })
        if (memErr) {
            console.error('workspace_members insert', memErr)
            return NextResponse.json({ error: 'Workspace criado mas falhou ao atribuir owner' }, { status: 500 })
        }

        return NextResponse.json({ success: true, workspace: data })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
