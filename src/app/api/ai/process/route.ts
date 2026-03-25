import { NextResponse } from 'next/server'
import { requireInternalAiSecret } from '@/lib/auth/internal'
import { createAdminClient } from '@/lib/supabase/server'
import { runAiProcess } from '@/lib/ai-agent/run-process'

export async function POST(request: Request) {
    const denied = requireInternalAiSecret(request)
    if (denied) return denied

    try {
        const { workspace_slug, contact_id } = await request.json()
        if (!workspace_slug || !contact_id) {
            return NextResponse.json({ error: 'Missing ids' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const result = await runAiProcess(supabase, workspace_slug, contact_id)

        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: result.status })
        }

        return NextResponse.json({ success: true, reason: result.reason })
    } catch (e) {
        console.error('AI Process API Error:', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
