import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema, isMissingTenantSchema, isStatementTimeout } from '@/lib/db/tenant-sql'

export async function GET(request: Request) {
    try {
        const supabase = await createClient()
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')?.trim()
        const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 50))

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)
        const rows = await sql.unsafe(
            `SELECT r.id, r.contact_id, r.conversation_id, r.status, r.source, r.started_at, r.finished_at,
                    r.reason, r.error_message, r.meta,
                    c.phone AS contact_phone, c.name AS contact_name
             FROM ${sch}.ai_agent_runs r
             LEFT JOIN ${sch}.contacts c ON c.id = r.contact_id
             ORDER BY r.started_at DESC
             LIMIT $1`,
            [limit]
        )

        return NextResponse.json({ runs: rows || [] })
    } catch (e) {
        if (isMissingTenantSchema(e) || isStatementTimeout(e)) {
            return NextResponse.json({ runs: [], partial: true })
        }
        console.error('ai runs recent', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
