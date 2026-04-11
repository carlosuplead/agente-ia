import { NextResponse, after } from 'next/server'
import { requireInternalAiSecret } from '@/lib/auth/internal'
import { createAdminClient } from '@/lib/supabase/server'
import { runAiProcess } from '@/lib/ai-agent/run-process'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { parseContactUuidParam, parseWorkspaceSlugForTenantSql } from '@/lib/validation/internal-ai-params'

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export async function POST(request: Request) {
    const denied = requireInternalAiSecret(request)
    if (denied) return denied

    const body = await request.json().catch(() => null) as {
        workspace_slug?: unknown
        contact_id?: unknown
    } | null
    const workspace_slug = parseWorkspaceSlugForTenantSql(body?.workspace_slug)
    const contact_id = parseContactUuidParam(body?.contact_id)
    if (!workspace_slug || !contact_id) {
        return NextResponse.json({ error: 'Missing or invalid ids' }, { status: 400 })
    }

    after(async () => {
        let delaySec = 30
        try {
            const sql = getTenantSql()
            const sch = quotedSchema(workspace_slug)
            const rows = await sql.unsafe(`SELECT buffer_delay_seconds FROM ${sch}.ai_agent_config LIMIT 1`, [])
            const raw = (rows[0] as unknown as { buffer_delay_seconds?: number } | undefined)?.buffer_delay_seconds
            if (typeof raw === 'number' && Number.isFinite(raw)) {
                delaySec = Math.min(120, Math.max(5, Math.floor(raw)))
            }
        } catch (e) {
            console.error('schedule buffer_delay_seconds', e)
        }
        await sleep(delaySec * 1000)
        const supabase = await createAdminClient()
        let acquired = false
        for (let attempt = 0; attempt < 8 && !acquired; attempt++) {
            const { data: lockOk, error: lockErr } = await supabase.rpc('try_ai_process_lock', {
                p_slug: workspace_slug,
                p_contact: contact_id,
                p_ttl_seconds: 90
            })
            if (lockErr) {
                console.error('try_ai_process_lock', lockErr)
                await sleep(500)
                continue
            }
            if (lockOk === true) {
                acquired = true
                break
            }
            await sleep(500)
        }
        if (!acquired) return

        try {
            const result = await runAiProcess(supabase, workspace_slug, contact_id, { runSource: 'schedule' })
            if (!result.ok && result.status >= 500) {
                console.error('runAiProcess', result.error)
            }
        } catch (e) {
            console.error('runAiProcess threw', e)
        } finally {
            await supabase.rpc('release_ai_process_lock', {
                p_slug: workspace_slug,
                p_contact: contact_id
            })
        }
    })

    return NextResponse.json({ scheduled: true })
}
