import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { normalizePhoneForBrazil, generateBrazilianPhoneVariants, isWhatsAppGroup } from '@/lib/phone'
import { addToBuffer } from '@/lib/ai-agent/buffer'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { parseMessageForWhatsApp } from '@/lib/ai-agent/format-for-whatsapp'
import { resetFollowupAnchorForContact, setFollowupAnchorForContact } from '@/lib/ai-agent/followup-anchor'
import * as uazapi from '@/lib/uazapi'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const supabase = await createAdminClient()

        const instanceToken =
            body.token ||
            request.headers.get('x-instance-token') ||
            new URL(request.url).searchParams.get('token')

        if (!instanceToken) {
            return NextResponse.json({ error: 'Missing instance token' }, { status: 401 })
        }

        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('id, workspace_slug, status, phone_number')
            .eq('instance_token', instanceToken)
            .single()

        if (!instance) {
            return NextResponse.json({ error: 'Invalid instance token' }, { status: 401 })
        }

        const workspaceSlug = instance.workspace_slug

        if (body.status || body.event === 'connection' || body.EventType === 'connection') {
            const newStatus = body.status || 'disconnected'
            await supabase
                .from('whatsapp_instances')
                .update({
                    status: newStatus,
                    phone_number: body.phone || body.owner || null,
                    last_connected_at: newStatus === 'connected' ? new Date().toISOString() : null
                })
                .eq('id', instance.id)

            return NextResponse.json({ success: true })
        }

        if (body.EventType === 'messages' && body.message) {
            const sql = getTenantSql()
            const sch = quotedSchema(workspaceSlug)
            const msg = body.message
            const chat = body.chat

            if (!msg.chatid || msg.wasSentByApi) {
                return NextResponse.json({ success: true })
            }

            const messageId = msg.messageid || msg.id
            if (messageId) {
                const dup = await sql.unsafe(
                    `SELECT id FROM ${sch}.messages WHERE whatsapp_id = $1 LIMIT 1`,
                    [String(messageId)]
                )
                if (dup.length) {
                    return NextResponse.json({ success: true })
                }
            }

            const phoneFromChatId = msg.chatid.split('@')[0]
            if (isWhatsAppGroup(phoneFromChatId)) {
                return NextResponse.json({ success: true })
            }

            const rawPhone = normalizePhoneForBrazil(phoneFromChatId)
            if (!rawPhone) return NextResponse.json({ success: true })

            const isFromMe = msg.fromMe || false
            const contactName = isFromMe
                ? rawPhone
                : (msg.senderName || chat?.name || chat?.wa_contactName || rawPhone)

            const phonesToTry = generateBrazilianPhoneVariants(rawPhone)
            const found = await sql.unsafe(
                `SELECT id FROM ${sch}.contacts WHERE phone = ANY($1::text[]) LIMIT 1`,
                [phonesToTry]
            )
            let contactId = (found[0] as unknown as { id: string } | undefined)?.id

            if (!contactId) {
                try {
                    const ins = await sql.unsafe(
                        `INSERT INTO ${sch}.contacts (phone, name) VALUES ($1, $2)
                         ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
                         RETURNING id`,
                        [rawPhone, contactName]
                    )
                    contactId = (ins[0] as unknown as { id: string }).id
                } catch (e: unknown) {
                    const err = e as { code?: string }
                    if (err.code === '23505') {
                        const again = await sql.unsafe(
                            `SELECT id FROM ${sch}.contacts WHERE phone = $1 LIMIT 1`,
                            [rawPhone]
                        )
                        contactId = (again[0] as unknown as { id: string } | undefined)?.id
                    } else {
                        throw e
                    }
                }
            }

            if (!contactId) {
                return NextResponse.json({ error: 'Failed to find/create contact' }, { status: 500 })
            }

            let activeAiConversationId: string | null = null
            try {
                const convLookup = await sql.unsafe(
                    `SELECT id FROM ${sch}.ai_conversations
                     WHERE contact_id = $1::uuid AND status = 'active'
                     ORDER BY created_at DESC LIMIT 1`,
                    [contactId]
                )
                activeAiConversationId =
                    (convLookup[0] as unknown as { id: string } | undefined)?.id ?? null
            } catch (e) {
                console.error('webhook active ai_conversation lookup', e)
            }

            const buttonReplyText = msg.buttonOrListid ?? msg.content?.buttonReply?.title ?? ''
            const bodyContent =
                msg.text ||
                msg.caption ||
                msg.content?.text ||
                msg.content?.caption ||
                String(buttonReplyText) ||
                'Mídia enviada'

            let insertedMsg: { id: string } | undefined
            try {
                const ins = await sql.unsafe(
                    `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, media_type, status, whatsapp_id)
                     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
                     RETURNING id`,
                    [
                        contactId,
                        activeAiConversationId,
                        isFromMe ? 'user' : 'contact',
                        bodyContent,
                        msg.mediaType || null,
                        isFromMe ? 'sent' : 'received',
                        messageId ? String(messageId) : null
                    ]
                )
                insertedMsg = ins[0] as unknown as { id: string }
                if (isFromMe) {
                    await setFollowupAnchorForContact(workspaceSlug, contactId).catch(() => {})
                }
            } catch (e: unknown) {
                const err = e as { code?: string }
                if (err.code === '23505' && messageId) {
                    return NextResponse.json({ success: true })
                }
                console.error('Webhook message insert error:', e)
                return NextResponse.json({ error: 'Failed to store message' }, { status: 500 })
            }

            if (!isFromMe && insertedMsg) {
                await resetFollowupAnchorForContact(workspaceSlug, contactId).catch(err =>
                    console.error('resetFollowupAnchorForContact', err)
                )
                let skipBuffer = false
                try {
                    const cfgRows = await sql.unsafe(
                        `SELECT greeting_message, enabled FROM ${sch}.ai_agent_config LIMIT 1`,
                        []
                    )
                    const cfg = cfgRows[0] as unknown as
                        | { greeting_message?: string | null; enabled?: boolean }
                        | undefined
                    const gm = cfg?.greeting_message?.trim()
                    if (gm && cfg?.enabled !== false) {
                        const cntRows = await sql.unsafe(
                            `SELECT COUNT(*)::int AS c FROM ${sch}.messages WHERE contact_id = $1::uuid`,
                            [contactId]
                        )
                        const c = (cntRows[0] as unknown as { c: number } | undefined)?.c ?? 0
                        if (c === 1) {
                            const { data: inst } = await supabase
                                .from('whatsapp_instances')
                                .select('instance_token')
                                .eq('workspace_slug', workspaceSlug)
                                .eq('status', 'connected')
                                .maybeSingle()
                            if (inst?.instance_token) {
                                const textOut = parseMessageForWhatsApp(gm)
                                await uazapi.sendTextMessage(inst.instance_token, rawPhone, textOut, {
                                    delayMs: 800,
                                    presence: 'composing'
                                })
                                await sql.unsafe(
                                    `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, status) VALUES ($1::uuid, $2::uuid, 'ai', $3, 'sent')`,
                                    [contactId, activeAiConversationId, gm]
                                )
                                await setFollowupAnchorForContact(workspaceSlug, contactId).catch(() => {})
                                skipBuffer = true
                            }
                        }
                    }
                } catch (e) {
                    console.error('greeting_message webhook', e)
                }
                if (!skipBuffer) {
                    await addToBuffer(workspaceSlug, contactId, insertedMsg.id).catch(() => {})
                }
            }

            return NextResponse.json({ success: true })
        }

        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('Webhook error:', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
