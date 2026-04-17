import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { verifyOfficialWhatsAppCredentials } from '@/lib/meta/verify-official-credentials'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = (await request.json().catch(() => ({}))) as {
            workspace_slug?: string
            phone_number_id?: string
            waba_id?: string
            meta_access_token?: string
            phone_number?: string
            meta_webhook_verify_token?: string
        }

        const workspace_slug = body.workspace_slug?.trim()
        const phone_number_id = body.phone_number_id?.trim()
        const waba_id = body.waba_id?.trim()
        const meta_access_token = body.meta_access_token?.trim()
        const meta_webhook_verify_token =
            typeof body.meta_webhook_verify_token === 'string'
                ? body.meta_webhook_verify_token.trim()
                : undefined

        if (!workspace_slug || !phone_number_id || !waba_id || !meta_access_token) {
            return NextResponse.json({ error: 'Faltam campos obrigatórios.' }, { status: 400 })
        }

        const access = await requireWorkspaceRole(supabase, workspace_slug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const verified = await verifyOfficialWhatsAppCredentials({
            phoneNumberId: phone_number_id,
            wabaId: waba_id,
            accessToken: meta_access_token
        })
        if (!verified.ok) {
            return NextResponse.json({ error: verified.error }, { status: 400 })
        }

        const phone_number =
            body.phone_number?.trim() || verified.displayPhoneNumber || null

        const token = `official:${workspace_slug}:${phone_number_id}`
        const upsertPayload: Record<string, unknown> = {
            workspace_slug,
            provider: 'official',
            instance_token: token,
            phone_number,
            status: 'connected',
            phone_number_id,
            waba_id,
            meta_access_token,
            meta_token_obtained_at: new Date().toISOString(),
            last_connected_at: new Date().toISOString()
        }
        // Só actualiza o verify_token se veio explicitamente (string vazia limpa)
        if (meta_webhook_verify_token !== undefined) {
            upsertPayload.meta_webhook_verify_token = meta_webhook_verify_token || null
        }
        const { error } = await supabase
            .from('whatsapp_instances')
            .upsert(upsertPayload, { onConflict: 'workspace_slug' })
        if (error) {
            if (error.code === '23505') {
                return NextResponse.json(
                    {
                        error:
                            'Este Phone Number ID já está ligado a outro workspace. Desliga-o primeiro ou usa outro número.'
                    },
                    { status: 409 }
                )
            }
            console.error('configure official upsert', error)
            return NextResponse.json({ error: 'Falha ao guardar a ligação oficial.' }, { status: 500 })
        }
        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('configure official', e)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
