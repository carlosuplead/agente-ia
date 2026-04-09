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
        `SELECT sender_type, body, media_type, media_processed FROM (
            SELECT sender_type, body, media_type, media_processed, created_at FROM ${sch}.messages
            WHERE contact_id = $1::uuid AND ${innerWhere}
            ORDER BY created_at DESC
            LIMIT ${limit}
        ) sub ORDER BY sub.created_at ASC`,
        params
    )) as unknown as { sender_type: string; body: string | null; media_type: string | null; media_processed: boolean | null }[]

    const lines = messages.map(m => {
        const sender =
            m.sender_type === 'contact'
                ? contact.name
                : m.sender_type === 'ai'
                  ? opts.labelAssistant
                  : opts.labelTeam
        // Indicador de tipo de mídia para a IA saber diferenciar texto de mídia
        let content = m.body || '[Mídia]'
        if (m.media_type && m.media_type !== 'text') {
            const mediaLabel =
                m.media_type === 'audio' ? 'áudio'
                : m.media_type === 'image' ? 'imagem'
                : m.media_type === 'video' ? 'vídeo'
                : m.media_type === 'document' ? 'documento'
                : m.media_type === 'sticker' ? 'sticker'
                : m.media_type

            // Se é mídia de contato e ainda não foi processada, indicar claramente
            const bodyText = m.body || ''
            const isPlaceholder = ['Imagem enviada', 'Áudio enviado', 'Mídia enviada', 'Midia enviada', 'Vídeo enviado', 'Documento enviado', ''].includes(bodyText.trim())

            if (m.sender_type === 'contact' && isPlaceholder && !m.media_processed) {
                // Mídia ainda não processada — dizer explicitamente à IA
                content = m.media_type === 'image'
                    ? `[${mediaLabel}] [Você não conseguiu ver esta imagem. Peça ao cliente para descrever o que a imagem mostra.]`
                    : m.media_type === 'audio'
                        ? `[${mediaLabel}] [Você não conseguiu ouvir este áudio. Peça ao cliente para digitar a mensagem.]`
                        : `[${mediaLabel}] [Mídia recebida mas não processada]`
            } else {
                content = `[${mediaLabel}] ${bodyText}`
            }
        }
        // Delimitadores claros para dificultar prompt injection via mensagens do contato
        return `[${sender}]: ${content.trim() || '[Mídia]'}`
    })

    return {
        contactId,
        contactName: contact.name,
        contactPhone: contact.phone,
        transcript: lines.join('\n')
    }
}
