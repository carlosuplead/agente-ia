import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema, isMissingTenantSchema } from '@/lib/db/tenant-sql'

export type ChatMessage = {
    id: string
    body: string | null
    sender_type: string
    status: string
    media_url: string | null
    media_type: string | null
    created_at: string
    whatsapp_id: string | null
}

/** GET — message history for a contact */
export async function GET(request: Request, ctx: { params: Promise<{ contactId: string }> }) {
    try {
        const { contactId } = await ctx.params
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')?.trim()
        const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 80))

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)

        // Uma única query com CTEs em vez de 3 queries sequenciais (elimina 2 roundtrips)
        const result = await sql.unsafe(
            `WITH contact_data AS (
                SELECT id, phone, name, avatar_url
                FROM ${sch}.contacts WHERE id = $1::uuid LIMIT 1
            ),
            conv_data AS (
                SELECT id, status, handoff_reason, internal_notes, messages_count
                FROM ${sch}.ai_conversations
                WHERE contact_id = $1::uuid
                ORDER BY created_at DESC LIMIT 1
            ),
            msg_data AS (
                SELECT id, body, sender_type, status, media_url, media_type, created_at, whatsapp_id
                FROM ${sch}.messages
                WHERE contact_id = $1::uuid AND is_deleted = false
                ORDER BY created_at ASC
                LIMIT $2
            )
            SELECT json_build_object(
                'messages', COALESCE((SELECT json_agg(row_to_json(msg_data) ORDER BY msg_data.created_at ASC) FROM msg_data), '[]'::json),
                'contact', (SELECT row_to_json(contact_data) FROM contact_data),
                'conversation', (SELECT row_to_json(conv_data) FROM conv_data)
            ) AS payload`,
            [contactId, limit]
        )

        const payload = (result[0] as unknown as { payload: { messages: ChatMessage[]; contact: unknown; conversation: unknown } } | undefined)?.payload

        return NextResponse.json({
            messages: payload?.messages || [],
            contact: payload?.contact || null,
            conversation: payload?.conversation || null
        }, {
            headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' }
        })
    } catch (e) {
        if (isMissingTenantSchema(e)) {
            return NextResponse.json({ messages: [], contact: null, conversation: null })
        }
        console.error('conversation messages', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

/** PATCH — update conversation (pause/resume AI, add notes) */
export async function PATCH(request: Request, ctx: { params: Promise<{ contactId: string }> }) {
    try {
        const { contactId } = await ctx.params
        const body = (await request.json()) as Record<string, unknown>
        const workspace_slug = typeof body.workspace_slug === 'string' ? body.workspace_slug.trim() : ''

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)

        // Get active/latest conversation
        const convRows = await sql.unsafe(
            `SELECT id, status FROM ${sch}.ai_conversations
             WHERE contact_id = $1::uuid
             ORDER BY created_at DESC LIMIT 1`,
            [contactId]
        )
        const conv = convRows[0] as unknown as { id: string; status: string } | undefined

        // Handle AI status toggle
        if (body.action === 'pause_ai' && conv && conv.status === 'active') {
            await sql.unsafe(
                `UPDATE ${sch}.ai_conversations
                 SET status = 'handed_off', handoff_reason = 'Pausado manualmente pelo painel'
                 WHERE id = $1::uuid`,
                [conv.id]
            )
            return NextResponse.json({ success: true, new_status: 'handed_off' })
        }

        if (body.action === 'resume_ai' && conv) {
            // Create a new active conversation to re-enable AI
            await sql.unsafe(
                `UPDATE ${sch}.ai_conversations SET status = 'ended', ended_at = NOW() WHERE id = $1::uuid`,
                [conv.id]
            )
            await sql.unsafe(
                `INSERT INTO ${sch}.ai_conversations (contact_id, status) VALUES ($1::uuid, 'active')`,
                [contactId]
            )
            return NextResponse.json({ success: true, new_status: 'active' })
        }

        // Handle internal notes
        if (typeof body.internal_notes === 'string') {
            if (conv) {
                await sql.unsafe(
                    `UPDATE ${sch}.ai_conversations SET internal_notes = $2 WHERE id = $1::uuid`,
                    [conv.id, body.internal_notes.trim() || null]
                )
            }
            return NextResponse.json({ success: true })
        }

        return NextResponse.json({ error: 'No valid action' }, { status: 400 })
    } catch (e) {
        console.error('conversation PATCH', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
