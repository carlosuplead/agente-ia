import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { findAuthUserIdByEmail } from '@/lib/auth/admin-users'
import { assertTenantSlug } from '@/lib/db/tenant-sql'

const MIN_PASSWORD_LENGTH = 8

function parseOptionalPassword(body: Record<string, unknown>): string | undefined {
    const p = body.password
    if (typeof p !== 'string') return undefined
    const t = p.trim()
    return t.length > 0 ? t : undefined
}

/**
 * Convida por email e associa o papel `client` (portal).
 * - Sem senha: convite por email (Supabase), como antes.
 * - Com senha: cria conta com password ou redefine a senha se o utilizador já existir.
 * Requer SUPABASE_SERVICE_ROLE_KEY no servidor.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
    try {
        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return NextResponse.json(
                { error: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY — convites indisponíveis.' },
                { status: 503 }
            )
        }

        const { slug: rawSlug } = await ctx.params
        let slug: string
        try {
            slug = assertTenantSlug(rawSlug)
        } catch {
            return NextResponse.json({ error: 'Invalid workspace slug' }, { status: 400 })
        }

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
        const emailRaw = typeof body.email === 'string' ? body.email.trim() : ''
        if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
            return NextResponse.json({ error: 'Email inválido' }, { status: 400 })
        }
        const email = emailRaw.toLowerCase()

        const passwordPlain = parseOptionalPassword(body)
        if (passwordPlain !== undefined && passwordPlain.length < MIN_PASSWORD_LENGTH) {
            return NextResponse.json(
                { error: `Senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres (ou deixa vazio para só convite por email).` },
                { status: 400 }
            )
        }

        const supabase = await createClient()
        const access = await requireWorkspaceRole(supabase, slug, ['owner', 'admin', 'member'])
        if (!access.ok) return access.response

        const admin = await createAdminClient()

        let userId: string | null = await findAuthUserIdByEmail(admin, email)
        let passwordSetViaCreateUser = false

        const loadMembership = async (uid: string) =>
            admin
                .from('workspace_members')
                .select('role')
                .eq('workspace_slug', slug)
                .eq('user_id', uid)
                .maybeSingle()

        const setPassword = async (uid: string): Promise<{ ok: true } | { ok: false; message: string }> => {
            if (!passwordPlain) return { ok: true }
            const { error } = await admin.auth.admin.updateUserById(uid, { password: passwordPlain })
            if (error) return { ok: false, message: error.message }
            return { ok: true }
        }

        if (userId) {
            const { data: existing } = await loadMembership(userId)
            if (existing) {
                if (existing.role === 'client') {
                    if (passwordPlain) {
                        const pwd = await setPassword(userId)
                        if (!pwd.ok) {
                            return NextResponse.json({ error: pwd.message }, { status: 400 })
                        }
                        return NextResponse.json({
                            success: true,
                            user_id: userId,
                            message: 'Senha atualizada. O cliente pode entrar em /login com este email e a nova senha.'
                        })
                    }
                    return NextResponse.json({
                        success: true,
                        user_id: userId,
                        message: 'Este email já tem acesso ao portal deste workspace.'
                    })
                }
                return NextResponse.json(
                    {
                        error: 'Este utilizador já é membro interno (owner/admin/member) deste workspace.'
                    },
                    { status: 409 }
                )
            }
        }

        if (!userId && passwordPlain) {
            const { data: created, error: createErr } = await admin.auth.admin.createUser({
                email,
                password: passwordPlain,
                email_confirm: true
            })
            if (!createErr && created?.user?.id) {
                userId = created.user.id
                passwordSetViaCreateUser = true
            } else if (createErr) {
                userId = await findAuthUserIdByEmail(admin, email)
                if (!userId) {
                    return NextResponse.json(
                        {
                            error: createErr.message,
                            hint: 'Se o email já existir noutro projeto Supabase ou a política de passwords falhar, verifica a mensagem acima.'
                        },
                        { status: 400 }
                    )
                }
            } else {
                userId = await findAuthUserIdByEmail(admin, email)
                if (userId) {
                    passwordSetViaCreateUser = false
                }
            }
        }

        if (!userId && !passwordPlain) {
            const site = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
            const nextPath = encodeURIComponent('/portal')
            const { data: invData, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
                redirectTo: `${site}/auth/callback?next=${nextPath}`
            })

            if (invErr) {
                const low = invErr.message.toLowerCase()
                if (low.includes('already') || low.includes('registered') || low.includes('exists')) {
                    userId = await findAuthUserIdByEmail(admin, email)
                } else {
                    return NextResponse.json({ error: invErr.message }, { status: 400 })
                }
            } else if (invData?.user?.id) {
                userId = invData.user.id
            }
        }

        if (!userId) {
            userId = await findAuthUserIdByEmail(admin, email)
        }

        if (!userId) {
            return NextResponse.json(
                {
                    success: true,
                    pending: true,
                    message:
                        'Se o email era novo, o convite foi enviado. Após aceitar, volta a usar este botão ou adiciona manualmente em workspace_members se necessário.'
                },
                { status: 202 }
            )
        }

        const { data: internalBlock } = await loadMembership(userId)
        if (internalBlock) {
            if (internalBlock.role === 'client') {
                if (passwordPlain && !passwordSetViaCreateUser) {
                    const pwd = await setPassword(userId)
                    if (!pwd.ok) {
                        return NextResponse.json({ error: pwd.message }, { status: 400 })
                    }
                    return NextResponse.json({
                        success: true,
                        user_id: userId,
                        message: 'Senha atualizada.'
                    })
                }
                return NextResponse.json({
                    success: true,
                    user_id: userId,
                    message: 'Acesso ao portal já estava ativo.'
                })
            }
            return NextResponse.json(
                { error: 'Este utilizador já é membro interno deste workspace.' },
                { status: 409 }
            )
        }

        if (passwordPlain && !passwordSetViaCreateUser) {
            const pwd = await setPassword(userId)
            if (!pwd.ok) {
                return NextResponse.json({ error: pwd.message }, { status: 400 })
            }
        }

        const { error: insErr } = await admin.from('workspace_members').insert({
            user_id: userId,
            workspace_slug: slug,
            role: 'client'
        })

        if (insErr) {
            if (insErr.code === '23505') {
                return NextResponse.json({
                    success: true,
                    user_id: userId,
                    message: 'Acesso ao portal já existia.'
                })
            }
            console.error('invite-client insert workspace_members', insErr)
            return NextResponse.json(
                {
                    error: `Falha ao associar o acesso portal: ${insErr.message}${insErr.details ? ` (${insErr.details})` : ''}`
                },
                { status: 500 }
            )
        }

        const msg = passwordPlain
            ? 'Acesso ao portal criado. O cliente pode entrar em /login com email e a senha definida.'
            : 'Acesso ao portal criado. Se a conta era nova, também enviámos email de convite.'

        return NextResponse.json({
            success: true,
            user_id: userId,
            message: msg
        })
    } catch (e) {
        console.error('POST invite-client', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
