import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { readMetaPendingPickCookie } from '@/lib/meta/pending-pick-cookie'

export async function GET() {
    const pending = await readMetaPendingPickCookie()
    if (!pending) return NextResponse.json({ phones: [] })

    const supabase = await createClient()
    const {
        data: { user }
    } = await supabase.auth.getUser()
    if (!user || user.id !== pending.userId) return NextResponse.json({ phones: [] })

    return NextResponse.json({ workspace_slug: pending.workspaceSlug, phones: pending.phones })
}
