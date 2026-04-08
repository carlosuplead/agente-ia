import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { getProviderForWorkspace } from '@/lib/whatsapp/factory'

/**
 * POST /api/whatsapp/broadcast-quick
 * Envio rápido de texto para múltiplos contactos via Uazapi ou API oficial.
 * Máx 50 contactos por chamada.
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const body = await request.json()
        const { workspace_slug, contact_ids, message } = body as {
            workspace_slug?: string
            contact_ids?: string[]
            message?: string
        }

        if (!workspace_slug || !contact_ids || !message?.trim()) {
            return NextResponse.json(
                { error: 'workspace_slug, contact_ids e message são obrigatórios' },
                { status: 400 }
            )
        }

        if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
            return NextResponse.json({ error: 'contact_ids deve ter pelo menos 1' }, { status: 400 })
        }

        if (contact_ids.length > 50) {
            return NextResponse.json(
                { error: 'Máximo de 50 contactos por envio rápido' },
                { status: 400 }
            )
        }

        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        // Verificar instância conectada
        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('instance_token, status')
            .eq('workspace_slug', workspace_slug)
            .single()

        if (!instance || instance.status !== 'connected') {
            return NextResponse.json(
                { error: 'WhatsApp não está conectado' },
                { status: 400 }
            )
        }

        const { provider } = await getProviderForWorkspace(supabase, workspace_slug)
        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)

        // Buscar telefones dos contactos
        const placeholders = contact_ids.map((_, i) => `$${i + 1}::uuid`).join(', ')
        const contacts = await sql.unsafe(
            `SELECT id, phone, name FROM ${sch}.contacts WHERE id IN (${placeholders})`,
            contact_ids
        )

        const results: { contact_id: string; phone: string; name: string; status: 'sent' | 'failed'; error?: string }[] = []

        for (const row of contacts) {
            const c = row as unknown as { id: string; phone: string; name: string }
            try {
                // Buscar conversa ativa (se houver)
                let conversationId: string | null = null
                try {
                    const convRows = await sql.unsafe(
                        `SELECT id FROM ${sch}.ai_conversations
                         WHERE contact_id = $1::uuid AND status = 'active'
                         ORDER BY created_at DESC LIMIT 1`,
                        [c.id]
                    )
                    conversationId = (convRows[0] as unknown as { id: string } | undefined)?.id ?? null
                } catch { /* ok */ }

                // Salvar mensagem na BD
                const savedRows = await sql.unsafe(
                    `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, status)
                     VALUES ($1::uuid, $2::uuid, 'user', $3, 'sending')
                     RETURNING id`,
                    [c.id, conversationId, message]
                )
                const savedId = (savedRows[0] as unknown as { id: string } | undefined)?.id

                // Enviar via provider
                const result = await provider.sendText(instance.instance_token, c.phone, message)

                if (savedId) {
                    await sql.unsafe(
                        `UPDATE ${sch}.messages SET status = 'sent', whatsapp_id = $2 WHERE id = $1::uuid`,
                        [savedId, result.messageId]
                    ).catch(() => {})
                }

                results.push({ contact_id: c.id, phone: c.phone, name: c.name, status: 'sent' })

                // Delay entre envios para evitar bloqueio
                await new Promise(r => setTimeout(r, 1200))
            } catch (err) {
                results.push({
                    contact_id: c.id,
                    phone: c.phone,
                    name: c.name,
                    status: 'failed',
                    error: err instanceof Error ? err.message : 'Erro ao enviar'
                })
            }
        }

        const sent = results.filter(r => r.status === 'sent').length
        const failed = results.filter(r => r.status === 'failed').length

        return NextResponse.json({ sent, failed, total: results.length, results })
    } catch (error) {
        console.error('broadcast-quick error:', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
