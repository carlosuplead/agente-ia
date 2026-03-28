import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'

function pgErrorCode(e: unknown): string {
    if (typeof e !== 'object' || e === null || !('code' in e)) return ''
    return String((e as { code: unknown }).code)
}

export async function GET(request: Request) {
    try {
        const supabase = await createClient()
        const { searchParams } = new URL(request.url)
        const workspace_slug = searchParams.get('workspace_slug')
        const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 20))

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)
        const messages = await sql.unsafe(
            `SELECT id, body, sender_type, status, created_at, contact_id
             FROM ${sch}.messages
             ORDER BY created_at DESC
             LIMIT $1`,
            [limit]
        )

        return NextResponse.json({ messages: messages || [] })
    } catch (e) {
        if (pgErrorCode(e) === '57014') {
            console.error('messages recent', e)
            return NextResponse.json({ messages: [] })
        }
        console.error('messages recent', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
