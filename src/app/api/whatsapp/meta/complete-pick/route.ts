import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { clearMetaPendingPickCookie, readMetaPendingPickCookie } from '@/lib/meta/pending-pick-cookie'

export async function POST(request: Request) {
    const pending = await readMetaPendingPickCookie()
    if (!pending) return NextResponse.json({ error: 'No pending pick' }, { status: 400 })

    const body = (await request.json().catch(() => ({}))) as { phone_number_id?: string }
    const selectedId = body.phone_number_id
    if (!selectedId) return NextResponse.json({ error: 'phone_number_id is required' }, { status: 400 })

    const picked = pending.phones.find(p => p.phone_number_id === selectedId)
    if (!picked) return NextResponse.json({ error: 'Invalid phone_number_id' }, { status: 400 })

    const supabase = await createClient()
    const {
        data: { user }
    } = await supabase.auth.getUser()
    if (!user || user.id !== pending.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const token = `official:${pending.workspaceSlug}:${picked.phone_number_id}`
    const { error } = await supabase
        .from('whatsapp_instances')
        .upsert(
            {
                workspace_slug: pending.workspaceSlug,
                provider: 'official',
                instance_token: token,
                phone_number: picked.display_phone_number || null,
                status: 'connected',
                phone_number_id: picked.phone_number_id,
                waba_id: picked.waba_id,
                meta_access_token: pending.accessToken,
                meta_token_obtained_at: new Date().toISOString(),
                last_connected_at: new Date().toISOString()
            },
            { onConflict: 'workspace_slug' }
        )
    if (error) return NextResponse.json({ error: 'Failed to persist selection' }, { status: 500 })

    await clearMetaPendingPickCookie()
    return NextResponse.json({ success: true })
}
