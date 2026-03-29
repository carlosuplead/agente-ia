import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceInternal, requireWorkspaceRole } from '@/lib/auth/workspace-access'
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
            return NextResponse.json(
                {
                    error:
                        'Este workspace já tem um registo de instância WhatsApp. Usa «Gerar QR Code» para ligar o telemóvel. Se quiseres começar de novo, remove primeiro a ligação Uazapi no separador WhatsApp.',
                    code: 'INSTANCE_EXISTS'
                },
                { status: 409 }
            )
        }

        if (provider !== 'uazapi') {
            return NextResponse.json({ error: 'Use o fluxo OAuth para provider official' }, { status: 400 })
        }

        const { token } = await uazapi.createRemoteInstance(display_name || workspace_slug)
        const instanceToken = token.trim()
        if (!instanceToken) {
            return NextResponse.json({ error: 'Uazapi devolveu token da instância vazio' }, { status: 502 })
        }

        const { data: row, error } = await supabase
            .from('whatsapp_instances')
            .insert({
                workspace_slug,
                instance_token: instanceToken,
                provider: 'uazapi',
                status: 'disconnected'
            })
            .select('id, workspace_slug, status')
            .single()

        if (error) {
            console.error('whatsapp_instances insert', error)
            return NextResponse.json({ error: 'Falha ao guardar instância' }, { status: 500 })
        }

        return NextResponse.json({ success: true, instance: row, instance_token: instanceToken })
    } catch (e) {
        console.error('instances POST', e)
        const msg = e instanceof Error ? e.message : 'Erro interno'
        return NextResponse.json({ error: msg }, { status: 502 })
    }
}

/** Literais separados: o client Supabase não infere tipos com `.select(\`\${base}, x\`)`. */
const INSTANCE_SELECT_PUBLIC =
    'id, status, phone_number, last_connected_at, updated_at, provider, phone_number_id, waba_id, meta_token_obtained_at' as const
const INSTANCE_SELECT_WITH_TOKEN =
    'id, status, phone_number, last_connected_at, updated_at, provider, phone_number_id, waba_id, meta_token_obtained_at, instance_token' as const

type WhatsappInstanceDbRow = {
    id: string
    status: string
    phone_number: string | null
    last_connected_at: string | null
    updated_at: string | null
    provider: string | null
    phone_number_id: string | null
    waba_id: string | null
    meta_token_obtained_at: string | null
    instance_token?: string
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

        const syncUazapi =
            searchParams.get('sync_uazapi') === '1' || searchParams.get('sync_uazapi') === 'true'

        const { data: row, error } = syncUazapi
            ? await supabase
                  .from('whatsapp_instances')
                  .select(INSTANCE_SELECT_WITH_TOKEN)
                  .eq('workspace_slug', workspace_slug)
                  .maybeSingle()
            : await supabase
                  .from('whatsapp_instances')
                  .select(INSTANCE_SELECT_PUBLIC)
                  .eq('workspace_slug', workspace_slug)
                  .maybeSingle()

        if (error) {
            return NextResponse.json({ error: 'Database error' }, { status: 500 })
        }

        if (!row) {
            return NextResponse.json({ instance: null, uazapi_live: null })
        }

        const r = row as WhatsappInstanceDbRow
        let uazapiLive: { qrcode?: string; pairingCode?: string } | null = null

        if (syncUazapi && r.provider !== 'official' && r.instance_token) {
            const remote = await uazapi.fetchRemoteInstanceStatus(r.instance_token)
            if (remote) {
                const patch: Record<string, unknown> = {}
                if (remote.dbStatus !== r.status) {
                    patch.status = remote.dbStatus
                }
                if (remote.phoneE164 && remote.phoneE164 !== r.phone_number) {
                    patch.phone_number = remote.phoneE164
                }
                if (remote.dbStatus === 'connected' && r.status !== 'connected') {
                    patch.last_connected_at = new Date().toISOString()
                }
                if (remote.dbStatus !== 'connected' && r.status === 'connected') {
                    patch.last_connected_at = null
                }
                if (Object.keys(patch).length > 0) {
                    const { error: upErr } = await supabase
                        .from('whatsapp_instances')
                        .update(patch)
                        .eq('id', r.id)
                    if (upErr) {
                        console.error('whatsapp_instances sync uazapi', upErr)
                    } else {
                        Object.assign(r, patch)
                    }
                }
                if (remote.qrcode || remote.pairingCode) {
                    uazapiLive = { qrcode: remote.qrcode, pairingCode: remote.pairingCode }
                }
            }
        }

        const { instance_token: _omit, ...instance } = r
        return NextResponse.json({ instance, uazapi_live: uazapiLive })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

/** Apaga o registo local e tenta remover a instância na Uazapi (só equipa interna, não portal `client`). */
export async function DELETE(request: Request) {
    try {
        const supabase = await createClient()
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')
        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceInternal(supabase, workspace_slug)
        if (!access.ok) return access.response

        const { data: row, error: selErr } = await supabase
            .from('whatsapp_instances')
            .select('id, provider, instance_token')
            .eq('workspace_slug', workspace_slug)
            .maybeSingle()

        if (selErr) {
            return NextResponse.json({ error: 'Database error' }, { status: 500 })
        }
        if (!row) {
            return NextResponse.json({ error: 'Sem instância para remover' }, { status: 404 })
        }

        if (row.provider === 'official') {
            return NextResponse.json(
                { error: 'Instância API oficial: não é possível remover por este botão.' },
                { status: 400 }
            )
        }

        try {
            await uazapi.deleteRemoteInstance(row.instance_token)
        } catch (e) {
            console.error('uazapi deleteRemoteInstance', e)
        }

        const { error: delErr } = await supabase.from('whatsapp_instances').delete().eq('id', row.id)
        if (delErr) {
            console.error('whatsapp_instances delete', delErr)
            return NextResponse.json({ error: 'Falha ao apagar o registo na base de dados' }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
