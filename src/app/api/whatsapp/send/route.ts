import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as uazapi from '@/lib/uazapi'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = await request.json()
        const { workspace_slug, contact_id, message } = body

        if (!workspace_slug || !contact_id || !message) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('instance_token, status')
            .eq('workspace_slug', workspace_slug)
            .single()

        if (!instance || instance.status !== 'connected') {
            return NextResponse.json({ error: 'WhatsApp is not connected' }, { status: 400 })
        }

        const { data: contact } = await supabase
            .schema(workspace_slug)
            .from('contacts')
            .select('phone')
            .eq('id', contact_id)
            .single()

        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        const { data: savedMessage, error: saveError } = await supabase
            .schema(workspace_slug)
            .from('messages')
            .insert({
                contact_id,
                sender_type: 'user',
                body: message,
                status: 'sending'
            })
            .select('id')
            .single()

        if (saveError) {
            return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
        }

        try {
            const result = await uazapi.sendTextMessage(instance.instance_token, contact.phone, message)
            
            await supabase
                .schema(workspace_slug)
                .from('messages')
                .update({ status: 'sent', whatsapp_id: result.messageId })
                .eq('id', savedMessage.id)

            return NextResponse.json({ success: true, messageId: savedMessage.id })
        } catch (error) {
            await supabase.schema(workspace_slug).from('messages').update({ status: 'failed' }).eq('id', savedMessage.id)
            return NextResponse.json({ error: 'Failed to send WhatsApp message' }, { status: 502 })
        }
    } catch (error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
