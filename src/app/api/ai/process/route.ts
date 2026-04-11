import { NextResponse } from 'next/server'
import { requireInternalAiSecret } from '@/lib/auth/internal'
import { createAdminClient } from '@/lib/supabase/server'
import { runAiProcess } from '@/lib/ai-agent/run-process'
import { parseContactUuidParam, parseWorkspaceSlugForTenantSql } from '@/lib/validation/internal-ai-params'

export async function POST(request: Request) {
    const denied = requireInternalAiSecret(request)
    if (denied) return denied

    try {
        const body = await request.json().catch(() => null) as {
            workspace_slug?: unknown
            contact_id?: unknown
        } | null
        const workspace_slug = parseWorkspaceSlugForTenantSql(body?.workspace_slug)
        const contact_id = parseContactUuidParam(body?.contact_id)
        if (!workspace_slug || !contact_id) {
            return NextResponse.json({ error: 'Missing or invalid ids' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const result = await runAiProcess(supabase, workspace_slug, contact_id, { runSource: 'http_process' })

        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: result.status })
        }

        return NextResponse.json({ success: true, reason: result.reason })
    } catch (e) {
        console.error('AI Process API Error:', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
