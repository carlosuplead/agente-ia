import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceInternal, requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { assertTemplateApproved } from '@/lib/meta/template-approval'
import { getOfficialInstanceForWorkspace } from '@/lib/whatsapp/official-instance'

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseUuidList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x))
}

export async function GET(request: Request) {
    try {
        const supabase = await createClient()
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')?.trim()
        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceInternal(supabase, workspace_slug)
        if (!access.ok) return access.response

        const { data, error } = await supabase
            .from('whatsapp_broadcasts')
            .select(
                'id, name, template_name, template_language, status, scheduled_at, sent_count, failed_count, pending_count, created_at, updated_at'
            )
            .eq('workspace_slug', workspace_slug)
            .order('created_at', { ascending: false })

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ broadcasts: data || [] })
    } catch (e) {
        console.error('broadcasts GET', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = (await request.json().catch(() => null)) as {
            workspace_slug?: string
            name?: string
            template_name?: string
            template_language?: string
            template_components?: unknown
            contact_ids?: unknown
            start?: boolean
        } | null

        const workspace_slug = body?.workspace_slug?.trim()
        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceRole(supabase, workspace_slug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const name = body?.name?.trim()
        const template_name = body?.template_name?.trim()
        const template_language = (body?.template_language?.trim() || 'pt_BR').replace(/-/g, '_')
        const contact_ids = parseUuidList(body?.contact_ids)

        if (!name || !template_name) {
            return NextResponse.json({ error: 'name e template_name são obrigatórios' }, { status: 400 })
        }
        if (contact_ids.length === 0) {
            return NextResponse.json({ error: 'contact_ids deve ter pelo menos um UUID' }, { status: 400 })
        }

        const official = await getOfficialInstanceForWorkspace(supabase, workspace_slug)
        if (!official) {
            return NextResponse.json({ error: 'WhatsApp oficial não configurado ou não ligado' }, { status: 400 })
        }

        await assertTemplateApproved(
            official.waba_id,
            official.meta_access_token,
            template_name,
            template_language
        )

        const {
            data: { user }
        } = await supabase.auth.getUser()
        const template_components = Array.isArray(body?.template_components) ? body.template_components : []

        const start = body?.start === true
        const status = start ? 'running' : 'draft'

        const { data: broadcast, error: insErr } = await supabase
            .from('whatsapp_broadcasts')
            .insert({
                workspace_slug,
                name,
                template_name,
                template_language,
                template_components,
                status,
                pending_count: contact_ids.length,
                created_by: user?.id ?? null
            })
            .select('id')
            .single()

        if (insErr || !broadcast) {
            console.error('broadcast insert', insErr)
            return NextResponse.json({ error: 'Falha ao criar campanha' }, { status: 500 })
        }

        const queueRows = contact_ids.map(contact_id => ({
            broadcast_id: broadcast.id,
            workspace_slug,
            contact_id,
            status: 'pending' as const
        }))

        const { error: qErr } = await supabase.from('whatsapp_broadcast_queue').insert(queueRows)
        if (qErr) {
            await supabase.from('whatsapp_broadcasts').delete().eq('id', broadcast.id)
            console.error('broadcast queue insert', qErr)
            return NextResponse.json({ error: 'Falha ao enfileirar contactos' }, { status: 500 })
        }

        return NextResponse.json({ success: true, id: broadcast.id, status })
    } catch (e) {
        console.error('broadcasts POST', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 502 })
    }
}
