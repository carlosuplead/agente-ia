'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

/**
 * Página de redefinição de senha.
 * O usuário chega aqui via link de email (resetPasswordForEmail).
 * Supabase já cria uma sessão temporária — basta usar updateUser com a nova senha.
 */
export default function ResetPasswordPage() {
    const router = useRouter()
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)
    const [loading, setLoading] = useState(false)
    const [ready, setReady] = useState(false)

    useEffect(() => {
        // Aguarda o Supabase processar o token do link
        const sb = createBrowserSupabaseClient()
        sb.auth.getSession().then(({ data }) => {
            if (!data.session) {
                setError('Link inválido ou expirado. Solicite um novo email de recuperação.')
            }
            setReady(true)
        })
    }, [])

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        if (password.length < 6) {
            setError('A senha deve ter pelo menos 6 caracteres.')
            return
        }
        if (password !== confirmPassword) {
            setError('As senhas não coincidem.')
            return
        }
        setLoading(true)
        const sb = createBrowserSupabaseClient()
        const { error: updErr } = await sb.auth.updateUser({ password })
        setLoading(false)
        if (updErr) {
            setError(updErr.message)
            return
        }
        setSuccess(true)
        // Redireciona pro login depois de 2s
        setTimeout(() => {
            router.push('/login')
            router.refresh()
        }, 2000)
    }

    if (!ready) {
        return (
            <div className="login-wrap">
                <div className="login-card">
                    <p className="login-sub">A validar link…</p>
                </div>
            </div>
        )
    }

    return (
        <div className="login-wrap">
            <div className="login-card">
                <h1>Redefinir senha</h1>
                <p className="login-sub">Escolha uma nova palavra-passe</p>

                {error && (
                    <div className="login-error" role="alert">
                        {error}
                    </div>
                )}

                {success ? (
                    <div
                        role="status"
                        style={{
                            padding: '14px 16px',
                            background: 'color-mix(in srgb, var(--green, #22c55e) 12%, transparent)',
                            color: 'var(--green, #22c55e)',
                            borderRadius: 8,
                            fontSize: 14,
                            textAlign: 'center',
                            lineHeight: 1.5
                        }}
                    >
                        ✓ Senha atualizada com sucesso!
                        <br />
                        Redirecionando para o login...
                    </div>
                ) : (
                    <form onSubmit={onSubmit} className="login-form">
                        <label className="input-group">
                            <span className="input-label">Nova senha</span>
                            <input
                                className="input"
                                type="password"
                                autoComplete="new-password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                minLength={6}
                                required
                                autoFocus
                            />
                        </label>
                        <label className="input-group">
                            <span className="input-label">Confirmar nova senha</span>
                            <input
                                className="input"
                                type="password"
                                autoComplete="new-password"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                minLength={6}
                                required
                            />
                        </label>
                        <button
                            type="submit"
                            className="btn btn-primary login-btn"
                            disabled={loading || !password || !confirmPassword}
                        >
                            {loading ? 'Salvando…' : 'Redefinir senha'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    )
}
