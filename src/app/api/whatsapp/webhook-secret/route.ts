import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'

/**
 * POST /api/whatsapp/webhook-secret
 * Atualiza o segredo partilhado do webhook Uazapi (x-uazapi-secret / ?secret=)
 * associado ao workspace. Só owner/admin pode alterar.
 *
 * Body: { workspace_slug, uazapi_webhook_secret? }
 * Se `uazapi_webhook_secret` for string vazia → limpa (volta ao global).
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = (await request.json().catch(() => null)) as
            | { workspace_slug?: string; uazapi_webhook_secret?: string }
            | null

        const workspace_slug = body?.workspace_slug?.trim()
        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug é obrigatório' }, { status: 400 })
        }

        const access = await requireWorkspaceRole(supabase, workspace_slug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const uazapi_webhook_secret =
            typeof body?.uazapi_webhook_secret === 'string'
                ? body.uazapi_webhook_secret.trim()
                : ''

        // Verifica que existe um registo para este workspace
        const { data: existing, error: selErr } = await supabase
            .from('whatsapp_instances')
            .select('id')
            .eq('workspace_slug', workspace_slug)
            .maybeSingle()
        if (selErr) {
            return NextResponse.json({ error: 'Erro de base de dados' }, { status: 500 })
        }
        if (!existing) {
            return NextResponse.json(
                { error: 'Workspace ainda não tem instância WhatsApp. Conecta uma antes.' },
                { status: 404 }
            )
        }

        const { error } = await supabase
            .from('whatsapp_instances')
            .update({ uazapi_webhook_secret: uazapi_webhook_secret || null })
            .eq('workspace_slug', workspace_slug)
        if (error) {
            console.error('webhook-secret update', error)
            return NextResponse.json({ error: 'Falha ao guardar o segredo' }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
