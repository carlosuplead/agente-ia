import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { downloadMediaUazapi } from '@/lib/ai-agent/media-processing'

/**
 * GET /api/whatsapp/media?workspace_slug=X&whatsapp_id=Y
 * Proxy que baixa media do Uazapi e retorna o binário com content-type correto.
 * Necessário porque o Uazapi não expõe URLs públicas de media.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')?.trim()
        const whatsapp_id = searchParams.get('whatsapp_id')?.trim()

        if (!workspace_slug || !whatsapp_id) {
            return NextResponse.json({ error: 'workspace_slug and whatsapp_id are required' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        // Buscar instance_token do workspace
        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('instance_token, provider')
            .eq('workspace_slug', workspace_slug)
            .maybeSingle()

        if (!instance?.instance_token) {
            return NextResponse.json({ error: 'No WhatsApp instance found' }, { status: 404 })
        }

        if (instance.provider === 'official') {
            // Media da API oficial seria via Graph API — não suportado neste proxy ainda
            return NextResponse.json({ error: 'Official media proxy not implemented' }, { status: 501 })
        }

        // Download do Uazapi
        const media = await downloadMediaUazapi(instance.instance_token, whatsapp_id)
        if (!media) {
            return NextResponse.json({ error: 'Media not found or download failed' }, { status: 404 })
        }

        // Retornar binário com cache de 1 hora
        return new NextResponse(new Uint8Array(media.buffer), {
            status: 200,
            headers: {
                'Content-Type': media.mimetype,
                'Content-Length': String(media.buffer.length),
                'Cache-Control': 'private, max-age=3600',
                'X-Content-Type-Options': 'nosniff'
            }
        })
    } catch (error) {
        console.error('whatsapp media proxy', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
