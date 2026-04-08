import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema, isMissingTenantSchema, isStatementTimeout } from '@/lib/db/tenant-sql'

export type ConversationListItem = {
    contact_id: string
    phone: string
    name: string
    avatar_url: string | null
    last_message: string | null
    last_message_at: string | null
    last_sender_type: string | null
    unread_count: number
    ai_status: string | null
    conversation_id: string | null
    handoff_reason: string | null
    internal_notes: string | null
    messages_count: number
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)

        const rows = await sql.unsafe(
            `SELECT
                c.id AS contact_id,
                c.phone,
                c.name,
                c.avatar_url,
                m.body AS last_message,
                m.created_at AS last_message_at,
                m.sender_type AS last_sender_type,
                COALESCE(conv.status, 'none') AS ai_status,
                conv.id AS conversation_id,
                conv.handoff_reason,
                conv.internal_notes,
                COALESCE(conv.messages_count, 0)::int AS messages_count
             FROM ${sch}.contacts c
             LEFT JOIN LATERAL (
                SELECT body, created_at, sender_type
                FROM ${sch}.messages
                WHERE contact_id = c.id AND is_deleted = false
                ORDER BY created_at DESC
                LIMIT 1
             ) m ON true
             LEFT JOIN LATERAL (
                SELECT id, status, handoff_reason, internal_notes, messages_count
                FROM ${sch}.ai_conversations
                WHERE contact_id = c.id
                ORDER BY created_at DESC
                LIMIT 1
             ) conv ON true
             ORDER BY m.created_at DESC NULLS LAST
             LIMIT 100`,
            []
        )

        return NextResponse.json({ conversations: rows })
    } catch (e) {
        if (isMissingTenantSchema(e) || isStatementTimeout(e)) {
            return NextResponse.json({ conversations: [] })
        }
        console.error('conversations list', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
