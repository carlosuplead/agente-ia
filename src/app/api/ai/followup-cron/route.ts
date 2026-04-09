import { NextResponse } from 'next/server'
import { requireInternalAiSecret } from '@/lib/auth/internal'
import { createAdminClient } from '@/lib/supabase/server'
import { processFollowupsForWorkspace } from '@/lib/ai-agent/followup-due'
import { parseWorkspaceSlugForTenantSql } from '@/lib/validation/internal-ai-params'

async function runCron(request: Request) {
    const denied = requireInternalAiSecret(request)
    if (denied) return denied

    const url = new URL(request.url)
    const fromQuery = url.searchParams.get('workspace_slug')

    let bodySlugRaw: unknown | undefined
    if (request.method === 'POST') {
        const body = (await request.json().catch(() => null)) as { workspace_slug?: unknown } | null
        bodySlugRaw = body?.workspace_slug
    }

    const slugRaw =
        request.method === 'POST' && bodySlugRaw !== undefined ? bodySlugRaw : fromQuery
    const slug =
        slugRaw !== undefined && slugRaw !== null && String(slugRaw).trim() !== ''
            ? parseWorkspaceSlugForTenantSql(slugRaw)
            : ''
    if (slugRaw !== undefined && slugRaw !== null && String(slugRaw).trim() !== '' && !slug) {
        return NextResponse.json({ error: 'Invalid workspace_slug format' }, { status: 400 })
    }

    const supabase = await createAdminClient()

    if (slug) {
        const r = await processFollowupsForWorkspace(supabase, slug)
        return NextResponse.json({
            workspace_slug: slug,
            scanned: r.scanned,
            sent: r.sent,
            errors: r.errors
        })
    }

    const { data: wss, error: wsErr } = await supabase.from('workspaces').select('slug')
    if (wsErr) {
        return NextResponse.json({ error: wsErr.message }, { status: 500 })
    }

    let scanned = 0
    let sent = 0
    const errors: string[] = []
    for (const w of wss || []) {
        try {
            const r = await processFollowupsForWorkspace(supabase, w.slug)
            scanned += r.scanned
            sent += r.sent
            errors.push(...r.errors)
        } catch (e) {
            errors.push(`${w.slug}: ${e instanceof Error ? e.message : String(e)}`)
        }
    }

    return NextResponse.json({ scanned, sent, errors })
}

export async function GET(request: Request) {
    try {
        return await runCron(request)
    } catch (e) {
        console.error('followup-cron GET', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        return await runCron(request)
    } catch (e) {
        console.error('followup-cron POST', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
