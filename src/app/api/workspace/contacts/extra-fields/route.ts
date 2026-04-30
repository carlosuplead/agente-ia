import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'

/**
 * Lista todas as chaves distintas presentes em `contacts.extra_fields`
 * para o workspace. Usado pela UI de broadcasts para mostrar quais
 * variáveis o utilizador pode inserir nos componentes do template
 * (ex: `{{var:nome}}`, `{{var:pedido}}`).
 *
 * GET /api/workspace/contacts/extra-fields?workspace_slug=xxx
 * → { fields: ['nome', 'pedido', 'valor'] }
 */
export async function GET(request: Request) {
    try {
        const url = new URL(request.url)
        const workspace_slug = url.searchParams.get('workspace_slug')?.trim()
        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)
        // Distinct chaves de jsonb em todos os contacts
        const rows = await sql.unsafe(`
            SELECT DISTINCT jsonb_object_keys(extra_fields) AS k
            FROM ${sch}.contacts
            WHERE extra_fields IS NOT NULL AND extra_fields != '{}'::jsonb
            ORDER BY k
        `)
        const fields = rows.map(r => (r as { k: string }).k).filter(Boolean)
        return NextResponse.json({ fields })
    } catch (e) {
        console.error('contacts/extra-fields GET', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
