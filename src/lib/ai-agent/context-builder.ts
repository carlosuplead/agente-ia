import type { SupabaseClient } from '@supabase/supabase-js'
import type { BuiltContext } from './types'

export async function buildContext(
    supabase: SupabaseClient,
    workspaceSlug: string,
    contactId: string
): Promise<BuiltContext | null> {
    const { data: contact } = await supabase
        .schema(workspaceSlug)
        .from('contacts')
        .select('name, phone')
        .eq('id', contactId)
        .single()

    if (!contact) return null

    // Get the last 20 messages for context
    const { data: messages } = await supabase
        .schema(workspaceSlug)
        .from('messages')
        .select('sender_type, body')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(20)

    if (!messages) return null

    messages.reverse() // Sort chronologically

    // Formatar como transcript
    const lines = messages.map(m => {
        const sender = m.sender_type === 'user' || m.sender_type === 'ai' ? 'Assistente' : contact.name
        return `${sender}: ${m.body || '[Mídia]'}`
    })

    return {
        contactId,
        contactName: contact.name,
        contactPhone: contact.phone,
        transcript: lines.join('\n')
    }
}
