'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

type Mode = 'signin' | 'forgot'

export function LoginForm() {
    const [mode, setMode] = useState<Mode>('signin')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [info, setInfo] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()
    const qpError = searchParams.get('error')

    async function onSignIn(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setInfo('')
        setLoading(true)
        const sb = createBrowserSupabaseClient()
        const { error: signErr } = await sb.auth.signInWithPassword({ email, password })
        setLoading(false)
        if (signErr) {
            setError(signErr.message)
            return
        }
        router.push('/')
        router.refresh()
    }

    async function onForgotPassword(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setInfo('')
        if (!email.trim()) {
            setError('Por favor informe o email.')
            return
        }
        setLoading(true)
        const sb = createBrowserSupabaseClient()
        const redirectTo =
            typeof window !== 'undefined'
                ? `${window.location.origin}/auth/reset-password`
                : undefined
        const { error: resetErr } = await sb.auth.resetPasswordForEmail(email.trim(), {
            redirectTo
        })
        setLoading(false)
        if (resetErr) {
            setError(resetErr.message)
            return
        }
        setInfo(
            `Enviamos um email para ${email.trim()} com instruções para redefinir sua senha. Verifique a caixa de entrada e spam.`
        )
    }

    return (
        <div className="login-wrap">
            <div className="login-card">
                <h1>Agente WhatsApp IA</h1>
                <p className="login-sub">
                    {mode === 'signin' ? 'Inicie sessão para continuar' : 'Recuperar acesso à conta'}
                </p>
                {(error || qpError) && (
                    <div className="login-error" role="alert">
                        {error || 'Falha na autenticação.'}
                    </div>
                )}
                {info && (
                    <div
                        role="status"
                        style={{
                            padding: '10px 12px',
                            background: 'color-mix(in srgb, var(--green, #22c55e) 12%, transparent)',
                            color: 'var(--green, #22c55e)',
                            borderRadius: 8,
                            marginBottom: 12,
                            fontSize: 14,
                            lineHeight: 1.5
                        }}
                    >
                        {info}
                    </div>
                )}

                {mode === 'signin' ? (
                    <form onSubmit={onSignIn} className="login-form">
                        <label className="input-group">
                            <span className="input-label">Email</span>
                            <input
                                className="input"
                                type="email"
                                autoComplete="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                            />
                        </label>
                        <label className="input-group">
                            <span className="input-label">Palavra-passe</span>
                            <input
                                className="input"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                            />
                        </label>
                        <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
                            {loading ? 'A entrar…' : 'Entrar'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-link"
                            onClick={() => { setMode('forgot'); setError(''); setInfo('') }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--accent, #3b82f6)',
                                cursor: 'pointer',
                                textAlign: 'center',
                                marginTop: 8,
                                fontSize: 13,
                                padding: 4
                            }}
                        >
                            Esqueci minha senha
                        </button>
                    </form>
                ) : (
                    <form onSubmit={onForgotPassword} className="login-form">
                        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                            Informe seu email cadastrado. Enviaremos um link para redefinir sua senha.
                        </p>
                        <label className="input-group">
                            <span className="input-label">Email</span>
                            <input
                                className="input"
                                type="email"
                                autoComplete="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                autoFocus
                            />
                        </label>
                        <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
                            {loading ? 'Enviando…' : 'Enviar link de recuperação'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-link"
                            onClick={() => { setMode('signin'); setError(''); setInfo('') }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                textAlign: 'center',
                                marginTop: 8,
                                fontSize: 13,
                                padding: 4
                            }}
                        >
                            ← Voltar ao login
                        </button>
                    </form>
                )}

                <p className="login-sub" style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#999' }}>
                    Acesso exclusivo para clientes autorizados.
                </p>
            </div>
        </div>
    )
}
