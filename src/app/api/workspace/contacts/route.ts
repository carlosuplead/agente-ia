import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceInternal } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'

export async function GET(request: Request) {
    try {
        const supabase = await createClient()
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')?.trim()
        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceInternal(supabase, workspace_slug)
        if (!access.ok) return access.response

        const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '200', 10) || 200))
        const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)
        const rows = await sql.unsafe(
            `SELECT id, phone, name, created_at FROM ${sch}.contacts ORDER BY name ASC LIMIT $1 OFFSET $2`,
            [limit, offset]
        )
        return NextResponse.json({ contacts: rows })
    } catch (e) {
        console.error('workspace contacts GET', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
