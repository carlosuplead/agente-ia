import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = (await request.json().catch(() => ({}))) as {
            workspace_slug?: string
            phone_number_id?: string
            waba_id?: string
            meta_access_token?: string
            phone_number?: string
        }

        if (!body.workspace_slug || !body.phone_number_id || !body.waba_id || !body.meta_access_token) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const access = await requireWorkspaceRole(supabase, body.workspace_slug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const token = `official:${body.workspace_slug}:${body.phone_number_id}`
        const { error } = await supabase
            .from('whatsapp_instances')
            .upsert(
                {
                    workspace_slug: body.workspace_slug,
                    provider: 'official',
                    instance_token: token,
                    phone_number: body.phone_number || null,
                    status: 'connected',
                    phone_number_id: body.phone_number_id,
                    waba_id: body.waba_id,
                    meta_access_token: body.meta_access_token,
                    meta_token_obtained_at: new Date().toISOString(),
                    last_connected_at: new Date().toISOString()
                },
                { onConflict: 'workspace_slug' }
            )
        if (error) return NextResponse.json({ error: 'Failed to configure official provider' }, { status: 500 })
        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('configure official', e)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
