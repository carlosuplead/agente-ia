import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

/**
 * PUT /api/auth/password — altera a password do utilizador autenticado.
 *
 * Body: { current_password: string, new_password: string }
 *
 * Valida a password atual re-autenticando e depois atualiza.
 * Rate limit: 5 tentativas / 10 min por IP+user.
 */
export async function PUT(request: Request) {
    try {
        const supabase = await createClient()
        const {
            data: { user },
            error: authErr
        } = await supabase.auth.getUser()
        if (authErr || !user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        // Rate limit por user+IP: 5 tentativas em 10 minutos
        const ip = getClientIp(request)
        const rl = checkRateLimit(`password:${user.id}:${ip}`, { max: 5, windowMs: 10 * 60 * 1000 })
        if (!rl.ok) {
            return NextResponse.json(
                { error: `Muitas tentativas. Tente novamente em ${Math.ceil(rl.retryAfterMs / 1000)}s.` },
                { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
            )
        }

        const body = await request.json().catch(() => null)
        const currentPassword = (body?.current_password ?? '').trim()
        const newPassword = (body?.new_password ?? '').trim()

        if (!currentPassword) {
            return NextResponse.json({ error: 'Senha atual é obrigatória' }, { status: 400 })
        }
        if (!newPassword || newPassword.length < 6) {
            return NextResponse.json(
                { error: 'Nova senha deve ter pelo menos 6 caracteres' },
                { status: 400 }
            )
        }
        if (currentPassword === newPassword) {
            return NextResponse.json(
                { error: 'A nova senha não pode ser igual à atual' },
                { status: 400 }
            )
        }

        // Verificar senha atual tentando login com email + password
        const email = user.email
        if (!email) {
            return NextResponse.json({ error: 'Conta sem email associado' }, { status: 400 })
        }

        const adminSb = await createAdminClient()

        // Re-autenticar para validar a senha atual
        const { error: signInErr } = await adminSb.auth.signInWithPassword({
            email,
            password: currentPassword
        })
        if (signInErr) {
            return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 403 })
        }

        // Atualizar password via admin client (service role)
        const { error: updateErr } = await adminSb.auth.admin.updateUserById(user.id, {
            password: newPassword
        })
        if (updateErr) {
            console.error('auth password update:', updateErr)
            return NextResponse.json({ error: 'Falha ao atualizar senha' }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('auth password:', e)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
