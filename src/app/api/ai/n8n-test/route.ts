import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { callN8nWebhook } from '@/lib/ai-agent/n8n-webhook'

/**
 * POST /api/ai/n8n-test
 * Permite ao cliente testar um workflow N8N do painel — chama o webhook com um
 * payload de diagnóstico e devolve o resultado (ok/erro, status, body).
 *
 * Body: { workspace_slug, url, timeout_seconds?, tool_slug? }
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = (await request.json().catch(() => null)) as {
            workspace_slug?: string
            url?: string
            timeout_seconds?: number
            tool_slug?: string
        } | null

        const workspace_slug = body?.workspace_slug?.trim()
        const url = body?.url?.trim()
        if (!workspace_slug || !url) {
            return NextResponse.json({ error: 'workspace_slug e url são obrigatórios' }, { status: 400 })
        }

        const access = await requireWorkspaceRole(supabase, workspace_slug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const timeout = Math.min(
            120,
            Math.max(5, Math.floor(Number(body?.timeout_seconds) || 30))
        )

        const started = Date.now()
        const result = await callN8nWebhook(
            url,
            {
                payload: '[TESTE] Chamada de diagnóstico a partir do painel.',
                contact: {
                    id: '00000000-0000-0000-0000-000000000000',
                    name: 'Painel (teste)',
                    phone: '+00000000000'
                },
                conversation_id: '00000000-0000-0000-0000-000000000000',
                workspace_slug,
                organization_id: workspace_slug,
                n8n_tool: body?.tool_slug?.trim() || 'test'
            },
            timeout
        )
        const elapsedMs = Date.now() - started

        return NextResponse.json({
            ok: result.ok,
            elapsed_ms: elapsedMs,
            data: result.ok ? result.data?.slice(0, 2000) : undefined,
            error: result.ok ? undefined : result.error
        })
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
