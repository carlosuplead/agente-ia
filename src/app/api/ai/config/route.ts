import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET: Recuperar configuração de IA do workspace
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const workspaceSlug = searchParams.get('workspace_slug')

        if (!workspaceSlug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const supabase = await createClient()

        const { data: config, error } = await supabase
            .schema(workspaceSlug)
            .from('ai_agent_config')
            .select('*')
            .single()

        if (error && error.code !== 'PGRST116') {
            return NextResponse.json({ error: 'Database error' }, { status: 500 })
        }

        return NextResponse.json({ config: config || null })
    } catch (e) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

// POST: Criar ou atualizar configuração de IA
export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { workspace_slug, enabled, provider, model, temperature, system_prompt, max_messages_per_conversation } = body

        if (!workspace_slug || !system_prompt) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const supabase = await createClient()

        // As the table now exists in the tenant schema and there's only max 1 row per tenant
        // we can fetch existing and update or insert. Since it's unique by schema, not by workspace_id anymore.
        const { data: existing } = await supabase.schema(workspace_slug).from('ai_agent_config').select('id').single()

        let dbOperation
        const payload = {
            enabled: enabled ?? true,
            provider: provider || 'gemini',
            model: model || 'gemini-2.5-flash',
            temperature: temperature ?? 0.7,
            system_prompt,
            max_messages_per_conversation: max_messages_per_conversation ?? 50
        }

        if (existing) {
            dbOperation = supabase.schema(workspace_slug).from('ai_agent_config').update(payload).eq('id', existing.id)
        } else {
            dbOperation = supabase.schema(workspace_slug).from('ai_agent_config').insert(payload)
        }

        const { data: config, error } = await dbOperation.select('*').single()

        if (error) {
            console.error('AI Config update error:', error)
            return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
        }

        return NextResponse.json({ success: true, config })
    } catch (e) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
