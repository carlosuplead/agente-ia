import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getProviderForWorkspace } from '@/lib/whatsapp/factory'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = await request.json()
        const { workspace_slug } = body

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('id, instance_token, status, provider')
            .eq('workspace_slug', workspace_slug)
            .single()

        if (!instance) {
            return NextResponse.json({ error: 'No instance configured' }, { status: 404 })
        }

        if (instance.status === 'connected') {
            return NextResponse.json({ status: 'connected', message: 'Already connected' })
        }

        try {
            const { provider } = await getProviderForWorkspace(supabase, workspace_slug)
            const connectResult = await provider.connect(instance.instance_token)
            
            await supabase
                .from('whatsapp_instances')
                .update({ status: connectResult.status === 'connected' ? 'connected' : 'connecting' })
                .eq('id', instance.id)

            return NextResponse.json({
                status: 'connecting',
                qrcode: connectResult.qrcode,
                pairingCode: connectResult.pairingCode
            })
        } catch (error) {
            console.error('UAZAPI connect error:', error)
            return NextResponse.json({ error: 'Failed to generate QR code' }, { status: 502 })
        }
    } catch (error) {
        console.error('Connect error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
