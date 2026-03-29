import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import type { BuiltContext } from './types'

export type BuildContextOptions = {
    maxMessages: number
    labelTeam: string
    labelAssistant: string
    /** Conversa IA atual — o transcript inclui mensagens desta sessão (e da anterior imediata após rotação). */
    aiConversationId: string
    /** `created_at` da linha `ai_conversations` atual (corta mensagens `NULL` antigas). */
    conversationCreatedAt: string | Date
    /** Após expirar/rotação por inatividade: incluir mensagens ainda ligadas à conversa anterior. */
    priorAiConversationId?: string | null
}

export async function buildContext(
    workspaceSlug: string,
    contactId: string,
    opts: BuildContextOptions
): Promise<BuiltContext | null> {
    const sql = getTenantSql()
    const sch = quotedSchema(workspaceSlug)

    const contacts = await sql.unsafe(
        `SELECT name, phone FROM ${sch}.contacts WHERE id = $1::uuid LIMIT 1`,
        [contactId]
    )
    const contact = contacts[0] as unknown as { name: string; phone: string } | undefined
    if (!contact) return null

    const limit = Math.min(Math.max(opts.maxMessages, 1), 100)
    const cutoff = new Date(opts.conversationCreatedAt).toISOString()
    const priorId = opts.priorAiConversationId ?? null

    const innerWhere = priorId
        ? `(conversation_id = $2::uuid OR conversation_id = $3::uuid OR (conversation_id IS NULL AND created_at >= $4::timestamptz))`
        : `(conversation_id = $2::uuid OR (conversation_id IS NULL AND created_at >= $3::timestamptz))`

    const params = priorId
        ? [contactId, opts.aiConversationId, priorId, cutoff]
        : [contactId, opts.aiConversationId, cutoff]

    const messages = (await sql.unsafe(
        `SELECT sender_type, body FROM (
            SELECT sender_type, body, created_at FROM ${sch}.messages
            WHERE contact_id = $1::uuid AND ${innerWhere}
            ORDER BY created_at DESC
            LIMIT ${limit}
        ) sub ORDER BY sub.created_at ASC`,
        params
    )) as unknown as { sender_type: string; body: string | null }[]

    const lines = messages.map(m => {
        const sender =
            m.sender_type === 'contact'
                ? contact.name
                : m.sender_type === 'ai'
                  ? opts.labelAssistant
                  : opts.labelTeam
        // Delimitadores claros para dificultar prompt injection via mensagens do contato
        return `[${sender}]: ${m.body || '[Mídia]'}`
    })

    return {
        contactId,
        contactName: contact.name,
        contactPhone: contact.phone,
        transcript: lines.join('\n')
    }
}
