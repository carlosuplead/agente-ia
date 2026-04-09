import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { allowSignupAttempt, clientIpFromRequest } from '@/lib/rate-limit/signup-ip'

const MIN_PASSWORD_LENGTH = 8

function signupDisabled(): boolean {
    const v = process.env.SIGNUP_DISABLED?.trim().toLowerCase()
    return v === '1' || v === 'true' || v === 'yes'
}

export async function POST(request: Request) {
    try {
        if (signupDisabled()) {
            return NextResponse.json(
                { error: 'O registo público está desativado. Contacta um administrador.' },
                { status: 403 }
            )
        }

        const ip = clientIpFromRequest(request)
        if (!allowSignupAttempt(ip)) {
            return NextResponse.json(
                { error: 'Demasiadas tentativas a partir desta rede. Tenta mais tarde.' },
                { status: 429 }
            )
        }

        const body = await request.json()
        const email = (body.email as string || '').trim().toLowerCase()
        const password = body.password as string || ''
        const name = (body.name as string || '').trim()

        if (!email || !password || !name) {
            return NextResponse.json({ error: 'Nome, email e senha obrigatórios.' }, { status: 400 })
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            return NextResponse.json(
                { error: `Senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` },
                { status: 400 }
            )
        }

        const adminClient = await createAdminClient()

        // 1. Criar usuário no Supabase Auth (via admin API para confirmar email automaticamente)
        const { data: userData, error: createErr } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: name }
        })

        if (createErr) {
            if (createErr.message?.includes('already been registered')) {
                return NextResponse.json({ error: 'Este email já está cadastrado.' }, { status: 409 })
            }
            console.error('signup error', createErr)
            return NextResponse.json({ error: createErr.message }, { status: 400 })
        }

        const userId = userData.user?.id
        if (!userId) {
            return NextResponse.json({ error: 'Erro ao criar conta.' }, { status: 500 })
        }

        // NÃO cria workspace automaticamente.
        // O admin precisa aprovar o usuário e atribuir um workspace pelo painel admin.
        // Isso garante que ninguém acessa o sistema sem aprovação.

        return NextResponse.json({ success: true, pending_approval: true })
    } catch (err) {
        console.error('signup route error', err)
        return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
    }
}
