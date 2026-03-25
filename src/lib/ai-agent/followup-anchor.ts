import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'

/** Cliente respondeu: cancela sequência de follow-ups. */
export async function resetFollowupAnchorForContact(workspaceSlug: string, contactId: string): Promise<void> {
    const sql = getTenantSql()
    const sch = quotedSchema(workspaceSlug)
    await sql.unsafe(
        `UPDATE ${sch}.ai_conversations
         SET ai_followup_anchor_at = NULL, ai_followup_progress = 0
         WHERE contact_id = $1::uuid AND status = 'active'`,
        [contactId]
    )
}

/** Nova mensagem nossa (IA, equipe ou telefone): inicia/reinicia a contagem para os passos. */
export async function setFollowupAnchorForContact(workspaceSlug: string, contactId: string): Promise<void> {
    const sql = getTenantSql()
    const sch = quotedSchema(workspaceSlug)
    await sql.unsafe(
        `UPDATE ${sch}.ai_conversations
         SET ai_followup_anchor_at = now(), ai_followup_progress = 0
         WHERE contact_id = $1::uuid AND status = 'active'`,
        [contactId]
    )
}

export async function setFollowupAnchorForConversation(
    workspaceSlug: string,
    conversationId: string
): Promise<void> {
    const sql = getTenantSql()
    const sch = quotedSchema(workspaceSlug)
    await sql.unsafe(
        `UPDATE ${sch}.ai_conversations
         SET ai_followup_anchor_at = now(), ai_followup_progress = 0
         WHERE id = $1::uuid AND status = 'active'`,
        [conversationId]
    )
}
