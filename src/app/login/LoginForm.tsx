'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

export function LoginForm() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()
    const qpError = searchParams.get('error')

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
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

    return (
        <div className="login-wrap">
            <div className="login-card">
                <h1>Agente WhatsApp IA</h1>
                <p className="login-sub">Inicie sessão para continuar</p>
                {(error || qpError) && (
                    <div className="login-error" role="alert">
                        {error || 'Falha na autenticação.'}
                    </div>
                )}
                <form onSubmit={onSubmit} className="login-form">
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
                </form>
            </div>
        </div>
    )
}
