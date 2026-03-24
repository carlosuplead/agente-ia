import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { normalizePhoneForBrazil, generateBrazilianPhoneVariants, isWhatsAppGroup } from '@/lib/phone'
import { addToBuffer } from '@/lib/ai-agent/buffer'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const supabase = await createAdminClient()

        const instanceToken = body.token || 
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

        // Connection events
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

        // Messages
        if (body.EventType === 'messages' && body.message) {
            const msg = body.message
            const chat = body.chat

            if (!msg.chatid || msg.wasSentByApi) {
                return NextResponse.json({ success: true })
            }

            const messageId = msg.messageid || msg.id
            if (messageId) {
                const { data: existingMsg } = await supabase
                    .schema(workspaceSlug)
                    .from('messages')
                    .select('id')
                    .eq('whatsapp_id', messageId)
                    .single()

                if (existingMsg) {
                    return NextResponse.json({ success: true }) // duplicate
                }
            }

            const phoneFromChatId = msg.chatid.split('@')[0]
            if (isWhatsAppGroup(phoneFromChatId)) {
                return NextResponse.json({ success: true }) // ignore groups
            }

            const rawPhone = normalizePhoneForBrazil(phoneFromChatId)
            if (!rawPhone) return NextResponse.json({ success: true })

            const isFromMe = msg.fromMe || false
            const contactName = isFromMe ? rawPhone : (msg.senderName || chat?.name || chat?.wa_contactName || rawPhone)

            let contactId: string | undefined
            const phonesToTry = generateBrazilianPhoneVariants(rawPhone)

            for (const tryPhone of phonesToTry) {
                const { data: extContact } = await supabase
                    .schema(workspaceSlug)
                    .from('contacts')
                    .select('id')
                    .eq('phone', tryPhone)
                    .single()

                if (extContact) {
                    contactId = extContact.id
                    break
                }
            }

            if (!contactId) {
                const { data: newContact } = await supabase
                    .schema(workspaceSlug)
                    .from('contacts')
                    .insert({
                        phone: rawPhone,
                        name: contactName
                    })
                    .select('id')
                    .single()
                
                if (newContact) contactId = newContact.id
            }

            if (!contactId) {
                return NextResponse.json({ error: 'Failed to find/create contact' }, { status: 500 })
            }

            const buttonReplyText = msg.buttonOrListid ?? msg.content?.buttonReply?.title ?? ''
            const bodyContent = msg.text || msg.caption || msg.content?.text || msg.content?.caption || String(buttonReplyText) || 'Mídia enviada'

            const { data: insertedMsg } = await supabase
                .schema(workspaceSlug)
                .from('messages')
                .insert({
                    contact_id: contactId,
                    sender_type: isFromMe ? 'user' : 'contact',
                    body: bodyContent,
                    media_type: msg.mediaType || null,
                    status: isFromMe ? 'sent' : 'received',
                    whatsapp_id: messageId || null
                })
                .select('id')
                .single()

            // If it's from contact, trigger AI buffer
            if (!isFromMe && insertedMsg) {
                // Ignore errors for buffer add
                await addToBuffer(supabase, workspaceSlug, contactId, insertedMsg.id).catch(() => {})
            }

            return NextResponse.json({ success: true })
        }

        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('Webhook error:', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
