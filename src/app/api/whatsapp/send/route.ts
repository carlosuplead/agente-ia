import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { setFollowupAnchorForContact } from '@/lib/ai-agent/followup-anchor'
import { getProviderForWorkspace } from '@/lib/whatsapp/factory'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = await request.json()
        const { workspace_slug, contact_id, message } = body

        if (!workspace_slug || !contact_id || !message) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (typeof contact_id !== 'string' || !UUID_RE.test(contact_id)) {
            return NextResponse.json({ error: 'Invalid contact_id format' }, { status: 400 })
        }

        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('instance_token, status')
            .eq('workspace_slug', workspace_slug)
            .single()

        if (!instance || instance.status !== 'connected') {
            return NextResponse.json({ error: 'WhatsApp is not connected' }, { status: 400 })
        }

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)

        const contacts = await sql.unsafe(
            `SELECT phone FROM ${sch}.contacts WHERE id = $1::uuid LIMIT 1`,
            [contact_id]
        )
        const contact = contacts[0] as unknown as { phone: string } | undefined
        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        let activeAiConversationId: string | null = null
        try {
            const convRows = await sql.unsafe(
                `SELECT id FROM ${sch}.ai_conversations
                 WHERE contact_id = $1::uuid AND status = 'active'
                 ORDER BY created_at DESC LIMIT 1`,
                [contact_id]
            )
            activeAiConversationId =
                (convRows[0] as unknown as { id: string } | undefined)?.id ?? null
        } catch (e) {
            console.error('whatsapp send active ai_conversation lookup', e)
        }

        const savedRows = await sql.unsafe(
            `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, status)
             VALUES ($1::uuid, $2::uuid, 'user', $3, 'sending')
             RETURNING id`,
            [contact_id, activeAiConversationId, message]
        )
        const savedMessage = savedRows[0] as unknown as { id: string } | undefined
        if (!savedMessage) {
            return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
        }

        try {
            const { provider } = await getProviderForWorkspace(supabase, workspace_slug)
            const result = await provider.sendText(instance.instance_token, contact.phone, message)

            await sql.unsafe(
                `UPDATE ${sch}.messages SET status = 'sent', whatsapp_id = $2 WHERE id = $1::uuid`,
                [savedMessage.id, result.messageId]
            )

            await setFollowupAnchorForContact(workspace_slug, contact_id).catch(() => {})

            // Quando um atendente humano envia mensagem, pausa a IA para este contato
            // A conversa ativa muda para 'handed_off' — a IA não responde mais
            // Para reativar: cliente envia /reset OU admin reativa manualmente
            if (activeAiConversationId) {
                try {
                    await sql.unsafe(
                        `UPDATE ${sch}.ai_conversations SET status = 'handed_off', handoff_reason = $2 WHERE id = $1::uuid AND status = 'active'`,
                        [activeAiConversationId, 'Atendente assumiu a conversa']
                    )
                } catch (e) {
                    console.error('whatsapp send handoff on human reply', e)
                }
            }

            return NextResponse.json({ success: true, messageId: savedMessage.id })
        } catch {
            await sql.unsafe(`UPDATE ${sch}.messages SET status = 'failed' WHERE id = $1::uuid`, [savedMessage.id])
            return NextResponse.json({ error: 'Failed to send WhatsApp message' }, { status: 502 })
        }
    } catch (error) {
        console.error('whatsapp send', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
