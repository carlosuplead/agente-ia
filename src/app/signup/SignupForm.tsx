'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

export function SignupForm() {
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)
    const router = useRouter()

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            })

            const data = await res.json()

            if (!res.ok) {
                setError(data.error || 'Erro ao cadastrar.')
                setLoading(false)
                return
            }

            // Conta criada — aguarda aprovação do admin
            setSuccess(true)
            setLoading(false)
        } catch {
            setError('Erro de conexão. Tente novamente.')
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="login-wrap">
                <div className="login-card" style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>&#9203;</div>
                    <h1>Conta criada!</h1>
                    <p className="login-sub" style={{ marginBottom: 24, lineHeight: 1.6 }}>
                        Sua conta foi registrada com sucesso.<br />
                        Um administrador precisa aprovar seu acesso antes de você poder utilizar a plataforma.
                    </p>
                    <p className="login-sub">
                        Já foi aprovado?{' '}
                        <a href="/login" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                            Faça login
                        </a>
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="login-wrap">
            <div className="login-card">
                <h1>Agente WhatsApp IA</h1>
                <p className="login-sub">Crie sua conta</p>
                {error && (
                    <div className="login-error" role="alert">
                        {error}
                    </div>
                )}
                <form onSubmit={onSubmit} className="login-form">
                    <label className="input-group">
                        <span className="input-label">Nome / Empresa</span>
                        <input
                            className="input"
                            type="text"
                            autoComplete="name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                            placeholder="Ex: Minha Empresa"
                        />
                    </label>
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
                        <span className="input-label">Senha</span>
                        <input
                            className="input"
                            type="password"
                            autoComplete="new-password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            minLength={6}
                        />
                    </label>
                    <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
                        {loading ? 'Criando conta...' : 'Criar Conta'}
                    </button>
                </form>
                <p className="login-sub" style={{ marginTop: '1rem' }}>
                    Já tem conta?{' '}
                    <a href="/login" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                        Faça login
                    </a>
                </p>
            </div>
        </div>
    )
}
