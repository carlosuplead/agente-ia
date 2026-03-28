import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'
import * as uazapi from '@/lib/uazapi'

/** Cria instância na Uazapi e regista em public.whatsapp_instances (uma por workspace). */
export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = await request.json()
        const workspace_slug = body.workspace_slug as string | undefined
        const display_name = (body.display_name as string | undefined) || workspace_slug
        const provider = (body.provider as 'uazapi' | 'official' | undefined) || 'uazapi'

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceRole(supabase, workspace_slug, [
            'owner',
            'admin',
            'member',
            'client'
        ])
        if (!access.ok) return access.response

        const { data: existing } = await supabase
            .from('whatsapp_instances')
            .select('id')
            .eq('workspace_slug', workspace_slug)
            .maybeSingle()

        if (existing) {
            return NextResponse.json({ error: 'Workspace já tem instância WhatsApp' }, { status: 409 })
        }

        if (provider !== 'uazapi') {
            return NextResponse.json({ error: 'Use o fluxo OAuth para provider official' }, { status: 400 })
        }

        const { token } = await uazapi.createRemoteInstance(display_name || workspace_slug)

        const { data: row, error } = await supabase
            .from('whatsapp_instances')
            .insert({
                workspace_slug,
                instance_token: token,
                provider: 'uazapi',
                status: 'disconnected'
            })
            .select('id, workspace_slug, status')
            .single()

        if (error) {
            console.error('whatsapp_instances insert', error)
            return NextResponse.json({ error: 'Falha ao guardar instância' }, { status: 500 })
        }

        return NextResponse.json({ success: true, instance: row, instance_token: token })
    } catch (e) {
        console.error('instances POST', e)
        const msg = e instanceof Error ? e.message : 'Erro interno'
        return NextResponse.json({ error: msg }, { status: 502 })
    }
}

export async function GET(request: Request) {
    try {
        const supabase = await createClient()
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')
        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceRole(supabase, workspace_slug, [
            'owner',
            'admin',
            'member',
            'client'
        ])
        if (!access.ok) return access.response

        const { data: instance, error } = await supabase
            .from('whatsapp_instances')
            .select(
                'id, status, phone_number, last_connected_at, updated_at, provider, phone_number_id, waba_id, meta_token_obtained_at'
            )
            .eq('workspace_slug', workspace_slug)
            .maybeSingle()

        if (error) {
            return NextResponse.json({ error: 'Database error' }, { status: 500 })
        }

        return NextResponse.json({ instance: instance || null })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
