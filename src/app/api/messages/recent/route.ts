import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema, isMissingTenantSchema, isStatementTimeout } from '@/lib/db/tenant-sql'

export async function GET(request: Request) {
    try {
        const supabase = await createClient()
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')
        const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 20))

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)
        const messages = await sql.unsafe(
            `SELECT m.id, m.body, m.sender_type, m.status, m.created_at, m.contact_id,
                    c.phone AS contact_phone, c.name AS contact_name
             FROM ${sch}.messages m
             LEFT JOIN ${sch}.contacts c ON c.id = m.contact_id
             ORDER BY m.created_at DESC
             LIMIT $1`,
            [limit]
        )

        return NextResponse.json({ messages: messages || [] })
    } catch (e) {
        if (isMissingTenantSchema(e) || isStatementTimeout(e)) {
            return NextResponse.json({ messages: [] })
        }
        console.error('messages recent', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
