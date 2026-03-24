import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildContext } from '@/lib/ai-agent/context-builder'
import { callLLM } from '@/lib/ai-agent/llm-router'
import { parseMessageForWhatsApp } from '@/lib/ai-agent/format-for-whatsapp'
import * as uazapi from '@/lib/uazapi'

export async function POST(request: Request) {
    try {
        const { workspace_slug, contact_id } = await request.json()
        if (!workspace_slug || !contact_id) {
            return NextResponse.json({ error: 'Missing ids' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // Verifica configuração da IA
        const { data: config } = await supabase
            .schema(workspace_slug)
            .from('ai_agent_config')
            .select('*')
            .single()

        if (!config || !config.enabled) {
            return NextResponse.json({ success: true, reason: 'AI disabled' })
        }

        // Verifica conversa AI (se existir, se passou do limite ou se foi desligada)
        const { data: aiConv } = await supabase
            .schema(workspace_slug)
            .from('ai_conversations')
            .select('*')
            .eq('contact_id', contact_id)
            .single()

        let conversationId = aiConv?.id
        let messageCount = aiConv?.messages_count || 0

        if (aiConv && aiConv.status === 'handed_off') {
            return NextResponse.json({ success: true, reason: 'Already handed off' })
        }

        if (!aiConv) {
            const { data: newConv } = await supabase
                .schema(workspace_slug)
                .from('ai_conversations')
                .insert({ contact_id, status: 'active' })
                .select('id')
                .single()
            if (newConv) conversationId = newConv.id
        }

        if (messageCount >= config.max_messages_per_conversation) {
            await supabase.schema(workspace_slug).from('ai_conversations').update({ status: 'handed_off', handoff_reason: 'Limite de mensagens atingido' }).eq('id', conversationId)
            return NextResponse.json({ success: true, reason: 'Limit reached' })
        }

        const context = await buildContext(supabase, workspace_slug, contact_id)
        if (!context) {
            return NextResponse.json({ error: 'Failed to build context' }, { status: 500 })
        }

        // Call LLM
        const response = await callLLM(config, context)

        // Find instance token
        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('instance_token')
            .eq('workspace_slug', workspace_slug)
            .eq('status', 'connected')
            .single()

        if (!instance) {
            return NextResponse.json({ error: 'No instance connected' })
        }

        const textToSave = response.text
        const textToSend = parseMessageForWhatsApp(response.text)

        if (textToSave) {
            // Save to DB
            const { data: savedMsg } = await supabase.schema(workspace_slug).from('messages').insert({
                contact_id,
                conversation_id: conversationId,
                sender_type: 'ai',
                body: textToSave,
                status: 'sending'
            }).select('id').single()

            // Send via UAZAPI
            try {
                const sendRes = await uazapi.sendTextMessage(instance.instance_token, context.contactPhone, textToSend)
                if (savedMsg) {
                    await supabase.schema(workspace_slug).from('messages').update({ status: 'sent', whatsapp_id: sendRes.messageId }).eq('id', savedMsg.id)
                }
            } catch (err) {
                if (savedMsg) {
                    await supabase.schema(workspace_slug).from('messages').update({ status: 'failed' }).eq('id', savedMsg.id)
                }
            }
        }

        // Handoff logic
        if (response.shouldHandoff) {
            await supabase.schema(workspace_slug).from('ai_conversations').update({ status: 'handed_off', handoff_reason: response.handoffReason }).eq('id', conversationId)
        } else {
            // Increment message count
            await supabase.schema(workspace_slug).from('ai_conversations').update({ messages_count: messageCount + 1 }).eq('id', conversationId)
        }

        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('AI Process API Error:', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
