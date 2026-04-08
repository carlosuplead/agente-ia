'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type WorkspaceAdmin = {
    id: string
    name: string
    slug: string
    created_at: string
    total_contacts: number
    total_messages: number
    ai_enabled: boolean
    provider: string
    members_count: number
}

type UserAdmin = {
    id: string
    email: string
    created_at: string
    last_sign_in_at: string | null
    full_name: string | null
    is_platform_admin: boolean
    workspaces: Array<{ workspace_slug: string; role: string }>
}

type Tab = 'workspaces' | 'users'

export function AdminPanel() {
    const router = useRouter()
    const [tab, setTab] = useState<Tab>('workspaces')
    const [workspaces, setWorkspaces] = useState<WorkspaceAdmin[]>([])
    const [users, setUsers] = useState<UserAdmin[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    const loadWorkspaces = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/workspaces')
            if (res.status === 403 || res.status === 401) {
                router.push('/')
                return
            }
            const data = await res.json()
            if (data.workspaces) setWorkspaces(data.workspaces)
        } catch {
            setError('Erro ao carregar workspaces')
        }
    }, [router])

    const loadUsers = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/users')
            if (res.status === 403 || res.status === 401) {
                router.push('/')
                return
            }
            const data = await res.json()
            if (data.users) setUsers(data.users)
        } catch {
            setError('Erro ao carregar usuários')
        }
    }, [router])

    useEffect(() => {
        setLoading(true)
        Promise.all([loadWorkspaces(), loadUsers()]).finally(() => setLoading(false))
    }, [loadWorkspaces, loadUsers])

    async function handleDeleteWorkspace(slug: string) {
        if (!window.confirm(`Tem certeza que deseja remover o workspace "${slug}"? Esta ação não pode ser desfeita.`)) return
        const res = await fetch('/api/admin/workspaces', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug })
        })
        if (res.ok) {
            setWorkspaces(prev => prev.filter(w => w.slug !== slug))
        }
    }

    function fmtDate(iso: string) {
        return new Date(iso).toLocaleDateString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })
    }

    if (loading) {
        return (
            <div className="login-wrap">
                <div className="login-card">
                    <p className="login-sub">Carregando painel admin...</p>
                </div>
            </div>
        )
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Painel Administrativo</h1>
                <div style={{ display: 'flex', gap: 8 }}>
                    <a href="/" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                        Voltar ao Dashboard
                    </a>
                </div>
            </div>

            {error && <div className="login-error" role="alert">{error}</div>}

            <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
                <button
                    className={`btn ${tab === 'workspaces' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setTab('workspaces')}
                >
                    Workspaces ({workspaces.length})
                </button>
                <button
                    className={`btn ${tab === 'users' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setTab('users')}
                >
                    Usuários ({users.length})
                </button>
            </div>

            {tab === 'workspaces' && (
                <div className="card" style={{ padding: '1rem' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="token-usage-table" style={{ width: '100%' }}>
                            <thead>
                                <tr>
                                    <th>Nome</th>
                                    <th>Slug</th>
                                    <th className="token-usage-table-num">Membros</th>
                                    <th className="token-usage-table-num">Contatos</th>
                                    <th className="token-usage-table-num">Mensagens</th>
                                    <th>IA</th>
                                    <th>Provider</th>
                                    <th>Criado em</th>
                                    <th>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {workspaces.length === 0 && (
                                    <tr>
                                        <td colSpan={9} style={{ color: 'var(--text-secondary)' }}>
                                            Nenhum workspace encontrado.
                                        </td>
                                    </tr>
                                )}
                                {workspaces.map(ws => (
                                    <tr key={ws.slug}>
                                        <td><strong>{ws.name}</strong></td>
                                        <td><code style={{ fontSize: 13 }}>{ws.slug}</code></td>
                                        <td className="token-usage-table-num">{ws.members_count}</td>
                                        <td className="token-usage-table-num">{ws.total_contacts}</td>
                                        <td className="token-usage-table-num">{ws.total_messages}</td>
                                        <td>
                                            <span style={{
                                                display: 'inline-block',
                                                width: 10, height: 10, borderRadius: '50%',
                                                backgroundColor: ws.ai_enabled ? '#22c55e' : '#ef4444'
                                            }} />
                                            {ws.ai_enabled ? ' Ativa' : ' Inativa'}
                                        </td>
                                        <td>{ws.provider}</td>
                                        <td style={{ fontSize: 13 }}>{fmtDate(ws.created_at)}</td>
                                        <td>
                                            <button
                                                className="btn btn-secondary"
                                                style={{ fontSize: 12, padding: '2px 8px' }}
                                                onClick={() => handleDeleteWorkspace(ws.slug)}
                                            >
                                                Remover
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {tab === 'users' && (
                <div className="card" style={{ padding: '1rem' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="token-usage-table" style={{ width: '100%' }}>
                            <thead>
                                <tr>
                                    <th>Nome</th>
                                    <th>Email</th>
                                    <th>Admin</th>
                                    <th>Workspaces</th>
                                    <th>Criado em</th>
                                    <th>Último login</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.length === 0 && (
                                    <tr>
                                        <td colSpan={6} style={{ color: 'var(--text-secondary)' }}>
                                            Nenhum usuário encontrado.
                                        </td>
                                    </tr>
                                )}
                                {users.map(u => (
                                    <tr key={u.id}>
                                        <td>{u.full_name || '—'}</td>
                                        <td><code style={{ fontSize: 13 }}>{u.email}</code></td>
                                        <td>
                                            {u.is_platform_admin ? (
                                                <span style={{ color: '#f59e0b', fontWeight: 600 }}>Admin</span>
                                            ) : '—'}
                                        </td>
                                        <td style={{ fontSize: 13 }}>
                                            {u.workspaces.length === 0 ? '—' : u.workspaces.map(w =>
                                                `${w.workspace_slug} (${w.role})`
                                            ).join(', ')}
                                        </td>
                                        <td style={{ fontSize: 13 }}>{fmtDate(u.created_at)}</td>
                                        <td style={{ fontSize: 13 }}>
                                            {u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : 'Nunca'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}
