import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'

export async function GET() {
    try {
        const supabase = await createClient()
        const admin = await requirePlatformAdmin(supabase)
        if (!admin.ok) return admin.response

        // Buscar todos os workspaces
        const { data: workspaces, error: wsErr } = await supabase
            .from('workspaces')
            .select('id, name, slug, created_at')
            .order('created_at', { ascending: false })

        if (wsErr) {
            return NextResponse.json({ error: 'Erro ao buscar workspaces' }, { status: 500 })
        }

        // Para cada workspace, buscar stats
        const sql = getTenantSql()
        const enriched = await Promise.all(
            (workspaces || []).map(async (ws) => {
                const sch = quotedSchema(ws.slug)
                let totalContacts = 0
                let totalMessages = 0
                let aiEnabled = false
                let provider = '—'
                let membersCount = 0

                try {
                    const [contactsRes, messagesRes, configRes] = await Promise.all([
                        sql.unsafe(`SELECT COUNT(*)::int AS c FROM ${sch}.contacts`),
                        sql.unsafe(`SELECT COUNT(*)::int AS c FROM ${sch}.messages`),
                        sql.unsafe(`SELECT enabled, provider FROM ${sch}.ai_agent_config LIMIT 1`)
                    ])
                    totalContacts = (contactsRes[0] as unknown as { c: number })?.c ?? 0
                    totalMessages = (messagesRes[0] as unknown as { c: number })?.c ?? 0
                    const cfg = configRes[0] as unknown as { enabled?: boolean; provider?: string } | undefined
                    aiEnabled = cfg?.enabled === true
                    provider = cfg?.provider ?? '—'
                } catch {
                    // Schema pode não existir ainda
                }

                try {
                    const { count } = await supabase
                        .from('workspace_members')
                        .select('*', { count: 'exact', head: true })
                        .eq('workspace_slug', ws.slug)
                    membersCount = count ?? 0
                } catch { /* ignore */ }

                return {
                    ...ws,
                    total_contacts: totalContacts,
                    total_messages: totalMessages,
                    ai_enabled: aiEnabled,
                    provider,
                    members_count: membersCount
                }
            })
        )

        return NextResponse.json({ workspaces: enriched })
    } catch (err) {
        console.error('admin workspaces', err)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

/** DELETE — desativa um workspace (soft delete: remove da lista, não apaga schema) */
export async function DELETE(request: Request) {
    try {
        const supabase = await createClient()
        const admin = await requirePlatformAdmin(supabase)
        if (!admin.ok) return admin.response

        const { slug } = await request.json()
        if (!slug) {
            return NextResponse.json({ error: 'slug obrigatório' }, { status: 400 })
        }

        const { error } = await supabase.from('workspaces').delete().eq('slug', slug)
        if (error) {
            return NextResponse.json({ error: 'Erro ao remover workspace' }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
