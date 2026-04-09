import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
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

/** POST — cria workspace e atribui a um usuário (aprovação de conta) */
export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const admin = await requirePlatformAdmin(supabase)
        if (!admin.ok) return admin.response

        const body = await request.json()
        const { name, slug, owner_user_id } = body as {
            name?: string
            slug?: string
            owner_user_id?: string
        }

        if (!name || !slug || !owner_user_id) {
            return NextResponse.json(
                { error: 'name, slug e owner_user_id são obrigatórios' },
                { status: 400 }
            )
        }

        // 1. Criar workspace
        const { error: wsErr } = await supabase
            .from('workspaces')
            .insert({ name, slug })
        if (wsErr) {
            console.error('admin create workspace', wsErr)
            return NextResponse.json({ error: 'Falha ao criar workspace: ' + wsErr.message }, { status: 500 })
        }

        // 2. Atribuir usuário como owner
        const { error: memErr } = await supabase
            .from('workspace_members')
            .insert({ user_id: owner_user_id, workspace_slug: slug, role: 'owner' })
        if (memErr) {
            console.error('admin assign owner', memErr)
            return NextResponse.json({ error: 'Workspace criado, mas falhou ao atribuir usuário' }, { status: 500 })
        }

        return NextResponse.json({ success: true, slug })
    } catch (err) {
        console.error('admin create workspace', err)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

/** DELETE — remove um workspace e todos os dados relacionados */
export async function DELETE(request: Request) {
    try {
        const supabase = await createClient()
        const admin = await requirePlatformAdmin(supabase)
        if (!admin.ok) return admin.response

        const body = await request.json().catch(() => null)
        const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
        if (!slug) {
            return NextResponse.json({ error: 'slug obrigatório' }, { status: 400 })
        }

        // 1. Dropar schema do tenant primeiro (remove todas tabelas internas de uma vez)
        try {
            const sql = getTenantSql()
            const sch = quotedSchema(slug)
            await sql.unsafe(`DROP SCHEMA IF EXISTS ${sch} CASCADE`)
        } catch (e) {
            console.warn('admin delete workspace: drop schema:', e)
        }

        // 2. Limpar tabelas públicas que referenciam workspace_slug (service role = bypass RLS)
        const adminSb = await createAdminClient()
        const publicTables = [
            'whatsapp_broadcast_queue',
            'whatsapp_broadcasts',
            'workspace_members',
            'whatsapp_instances',
            'workspace_google_calendar',
            'ai_process_fallback_queue'
        ]
        for (const table of publicTables) {
            try {
                await adminSb.from(table).delete().eq('workspace_slug', slug)
            } catch {
                // Tabela pode não existir neste projeto — ignorar
            }
        }

        // 3. Remover o workspace
        const { error } = await adminSb.from('workspaces').delete().eq('slug', slug)
        if (error) {
            console.error('admin delete workspace:', error)
            return NextResponse.json({ error: 'Erro ao remover workspace: ' + error.message }, { status: 500 })
        }

        // 4. Fallback: se ainda existir por qualquer FK desconhecida, forçar via SQL
        try {
            const sql = getTenantSql()
            const check = await sql.unsafe(`SELECT id FROM public.workspaces WHERE slug = $1`, [slug])
            if (check.length > 0) {
                await sql.unsafe(`DELETE FROM public.workspaces WHERE slug = $1`, [slug])
            }
        } catch (e) {
            console.warn('admin delete workspace: sql fallback:', e)
        }

        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('admin delete workspace:', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
