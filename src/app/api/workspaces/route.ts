import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// GET: Listar todos os workspaces (clientes)
export async function GET() {
    try {
        const supabase = await createAdminClient()
        const { data, error } = await supabase
            .from('workspaces')
            .select('id, name, slug, created_at')
            .order('created_at', { ascending: false })

        if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
        return NextResponse.json({ workspaces: data })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

// POST: Criar novo workspace (cliente) — o trigger do banco cria o schema automaticamente
export async function POST(request: Request) {
    try {
        const { name, slug } = await request.json()

        if (!name || !slug) {
            return NextResponse.json({ error: 'name and slug are required' }, { status: 400 })
        }

        // Slug precisa ser lowercase, sem espaços, seguro para nome de schema PG
        const safeSlug = slug.toLowerCase().replace(/[^a-z0-9_]/g, '_')

        const supabase = await createAdminClient()

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

        return NextResponse.json({ success: true, workspace: data })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
