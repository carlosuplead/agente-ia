import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceInternal } from '@/lib/auth/workspace-access'
import { listMessageTemplates } from '@/lib/meta/templates'
import { getOfficialInstanceForWorkspace } from '@/lib/whatsapp/official-instance'

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

        const official = await getOfficialInstanceForWorkspace(supabase, workspace_slug)
        if (!official) {
            return NextResponse.json({ error: 'WhatsApp oficial não configurado ou não ligado' }, { status: 400 })
        }

        const templates = await listMessageTemplates(official.waba_id, official.meta_access_token)
        return NextResponse.json({ templates })
    } catch (e) {
        console.error('meta templates GET', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 502 })
    }
}
