'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Modal helpers (replacing window.confirm/prompt) ──
type ConfirmState = {
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => void | Promise<void>
} | null

type InputState = {
    title: string
    message: string
    placeholder?: string
    defaultValue?: string
    inputType?: 'text' | 'password'
    confirmLabel: string
    minLength?: number
    onConfirm: (value: string) => void | Promise<void>
} | null

function ConfirmModal({ state, onCancel }: { state: ConfirmState; onCancel: () => void }) {
    if (!state) return null
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
            <div className="modal-card" role="dialog" aria-modal="true">
                <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>{state.title}</h3>
                <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.5 }}>
                    {state.message}
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
                    <button
                        className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`}
                        onClick={async () => {
                            await state.onConfirm()
                            onCancel()
                        }}
                    >
                        {state.confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    )
}

function InputModal({ state, onCancel }: { state: InputState; onCancel: () => void }) {
    const [value, setValue] = useState(state?.defaultValue ?? '')
    useEffect(() => { setValue(state?.defaultValue ?? '') }, [state])
    if (!state) return null
    const invalid = state.minLength !== undefined && value.length < state.minLength
    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
            <div className="modal-card" role="dialog" aria-modal="true">
                <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>{state.title}</h3>
                <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
                    {state.message}
                </p>
                <input
                    type={state.inputType ?? 'text'}
                    className="input"
                    value={value}
                    placeholder={state.placeholder}
                    onChange={e => setValue(e.target.value)}
                    autoFocus
                    style={{ marginBottom: 12 }}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !invalid && value) {
                            void state.onConfirm(value)
                            onCancel()
                        }
                    }}
                />
                {state.minLength !== undefined && (
                    <p style={{ fontSize: 12, color: invalid ? 'var(--red, #ef4444)' : 'var(--text-muted)', margin: '0 0 12px' }}>
                        Mínimo de {state.minLength} caracteres ({value.length})
                    </p>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
                    <button
                        className="btn btn-primary"
                        disabled={!value || invalid}
                        onClick={async () => {
                            await state.onConfirm(value)
                            onCancel()
                        }}
                    >
                        {state.confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    )
}

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
    workspaces: Array<{ workspace_slug: string; workspace_name: string; role: string }>
}

type Tab = 'workspaces' | 'users'

export function AdminPanel() {
    const router = useRouter()
    const [tab, setTab] = useState<Tab>('workspaces')
    const [workspaces, setWorkspaces] = useState<WorkspaceAdmin[]>([])
    const [users, setUsers] = useState<UserAdmin[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [confirmState, setConfirmState] = useState<ConfirmState>(null)
    const [inputState, setInputState] = useState<InputState>(null)
    const [successMessage, setSuccessMessage] = useState('')
    const [workspacePage, setWorkspacePage] = useState(1)
    const [userPage, setUserPage] = useState(1)
    const [workspaceSearch, setWorkspaceSearch] = useState('')
    const [userSearch, setUserSearch] = useState('')
    const PAGE_SIZE = 25

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
        setConfirmState({
            title: 'Remover workspace',
            message: `Tem certeza que deseja remover o workspace "${slug}"?\n\nTODOS os dados (contatos, mensagens, configurações) serão removidos permanentemente.`,
            confirmLabel: 'Remover definitivamente',
            danger: true,
            onConfirm: async () => {
                setError('')
                const res = await fetch('/api/admin/workspaces', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ slug })
                })
                if (res.ok) {
                    setWorkspaces(prev => prev.filter(w => w.slug !== slug))
                } else {
                    const data = await res.json().catch(() => ({})) as { error?: string }
                    setError(data.error || `Falha ao remover workspace "${slug}"`)
                }
            }
        })
    }

    async function handleDeleteUser(userId: string, userEmail: string) {
        setConfirmState({
            title: 'Remover usuário',
            message: `Tem certeza que deseja REMOVER o usuário "${userEmail}"?\n\nEsta ação é irreversível. O usuário perderá acesso à plataforma.`,
            confirmLabel: 'Remover usuário',
            danger: true,
            onConfirm: async () => {
                setError('')
                const res = await fetch('/api/admin/users', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId })
                })
                if (res.ok) {
                    setUsers(prev => prev.filter(u => u.id !== userId))
                } else {
                    const data = await res.json().catch(() => ({})) as { error?: string }
                    setError(data.error || `Falha ao remover usuário "${userEmail}"`)
                }
            }
        })
    }

    async function handleResetPassword(userId: string, userEmail: string) {
        setInputState({
            title: 'Redefinir senha',
            message: `Nova senha para ${userEmail}:`,
            placeholder: 'Mínimo 6 caracteres',
            inputType: 'password',
            confirmLabel: 'Atualizar senha',
            minLength: 6,
            onConfirm: async (newPassword) => {
                setError('')
                setSuccessMessage('')
                const res = await fetch('/api/admin/users', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, new_password: newPassword })
                })
                if (res.ok) {
                    setSuccessMessage(`Senha de ${userEmail} foi atualizada com sucesso.`)
                    setTimeout(() => setSuccessMessage(''), 5000)
                } else {
                    const data = await res.json().catch(() => ({})) as { error?: string }
                    setError(data.error || `Falha ao resetar senha de "${userEmail}"`)
                }
            }
        })
    }

    async function handleApproveUser(userId: string, userEmail: string, fullName: string | null) {
        const defaultName = fullName || userEmail.split('@')[0]
        setInputState({
            title: 'Aprovar novo workspace',
            message: `Nome do workspace para ${userEmail}:`,
            defaultValue: defaultName,
            placeholder: 'Nome do workspace',
            confirmLabel: 'Criar workspace',
            onConfirm: async (name) => {
                await doApproveUser(userId, name)
            }
        })
    }

    async function doApproveUser(userId: string, name: string) {
        const slug = name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 40) + '_' + Date.now().toString(36)

        const res = await fetch('/api/admin/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, slug, owner_user_id: userId })
        })
        if (res.ok) {
            await Promise.all([loadWorkspaces(), loadUsers()])
            setError('')
        } else {
            const j = await res.json().catch(() => ({}))
            setError((j as { error?: string }).error || 'Falha ao aprovar usuário')
        }
    }

    // ── Estado do modal Atribuir Workspace ──
    const [assignTarget, setAssignTarget] = useState<{ userId: string; userName: string } | null>(null)
    const [assignSlug, setAssignSlug] = useState('')
    const [assignRole, setAssignRole] = useState('member')
    const [assignLoading, setAssignLoading] = useState(false)

    async function handleAssignWorkspace(e: React.FormEvent) {
        e.preventDefault()
        if (!assignTarget || !assignSlug || !assignRole) return
        setAssignLoading(true)
        setError('')
        try {
            const res = await fetch('/api/admin/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: assignTarget.userId,
                    workspace_slug: assignSlug,
                    role: assignRole
                })
            })
            if (res.ok) {
                setAssignTarget(null)
                await Promise.all([loadWorkspaces(), loadUsers()])
            } else {
                const data = await res.json().catch(() => ({})) as { error?: string }
                setError(data.error || 'Falha ao atribuir workspace')
            }
        } catch {
            setError('Erro de conexão')
        } finally {
            setAssignLoading(false)
        }
    }

    // ── Estado do modal Novo Cliente ──
    const [showNewClient, setShowNewClient] = useState(false)
    const [newName, setNewName] = useState('')
    const [newEmail, setNewEmail] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [newClientLoading, setNewClientLoading] = useState(false)
    const [newClientResult, setNewClientResult] = useState<{ email: string; password: string } | null>(null)

    async function handleCreateClient(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setNewClientLoading(true)
        try {
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName, email: newEmail, password: newPassword })
            })
            const data = await res.json()
            if (!res.ok) {
                setError(data.error || 'Erro ao criar cliente')
                setNewClientLoading(false)
                return
            }
            // Mostrar credenciais para copiar
            setNewClientResult({ email: newEmail, password: newPassword })
            setNewName('')
            setNewEmail('')
            setNewPassword('')
            // Recarregar listas
            await Promise.all([loadWorkspaces(), loadUsers()])
        } catch {
            setError('Erro de conexão ao criar cliente')
        } finally {
            setNewClientLoading(false)
        }
    }

    function generatePassword() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
        let pw = ''
        for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)]
        setNewPassword(pw)
    }

    function fmtDate(iso: string) {
        return new Date(iso).toLocaleDateString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })
    }

    if (loading) {
        return (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
                <p className="login-sub" style={{ margin: 0 }}>Carregando painel admin...</p>
            </div>
        )
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Painel Administrativo</h1>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" onClick={() => { setShowNewClient(true); setNewClientResult(null); generatePassword() }}>
                        + Novo Cliente
                    </button>
                    <a href="/" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                        Voltar ao Dashboard
                    </a>
                </div>
            </div>

            {error && <div className="login-error" role="alert">{error}</div>}
            {successMessage && (
                <div
                    role="status"
                    style={{
                        padding: '10px 14px',
                        background: 'color-mix(in srgb, var(--green, #22c55e) 12%, transparent)',
                        color: 'var(--green, #22c55e)',
                        borderRadius: 8,
                        marginBottom: 12,
                        fontSize: 14
                    }}
                >
                    {successMessage}
                </div>
            )}

            <ConfirmModal state={confirmState} onCancel={() => setConfirmState(null)} />
            <InputModal state={inputState} onCancel={() => setInputState(null)} />

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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                        <input
                            type="search"
                            className="input"
                            placeholder="Pesquisar workspace (nome, slug)..."
                            value={workspaceSearch}
                            onChange={e => { setWorkspaceSearch(e.target.value); setWorkspacePage(1) }}
                            style={{ maxWidth: 320 }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {workspaces.length} workspace(s) no total
                        </span>
                    </div>
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
                                {(() => {
                                    const q = workspaceSearch.trim().toLowerCase()
                                    const filtered = q
                                        ? workspaces.filter(w => w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q))
                                        : workspaces
                                    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
                                    const page = Math.min(workspacePage, totalPages)
                                    const start = (page - 1) * PAGE_SIZE
                                    const slice = filtered.slice(start, start + PAGE_SIZE)
                                    if (filtered.length === 0) {
                                        return (
                                            <tr>
                                                <td colSpan={9} style={{ color: 'var(--text-secondary)' }}>
                                                    {q ? 'Nenhum workspace corresponde à pesquisa.' : 'Nenhum workspace encontrado.'}
                                                </td>
                                            </tr>
                                        )
                                    }
                                    return slice.map(ws => (
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
                                    ))
                                })()}
                            </tbody>
                        </table>
                    </div>
                    {(() => {
                        const q = workspaceSearch.trim().toLowerCase()
                        const filtered = q
                            ? workspaces.filter(w => w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q))
                            : workspaces
                        const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
                        if (totalPages <= 1) return null
                        const page = Math.min(workspacePage, totalPages)
                        return (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 }}>
                                <button
                                    className="btn btn-secondary"
                                    disabled={page <= 1}
                                    onClick={() => setWorkspacePage(p => Math.max(1, p - 1))}
                                    style={{ padding: '4px 10px', fontSize: 13 }}
                                >
                                    ← Anterior
                                </button>
                                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                    Página {page} de {totalPages}
                                </span>
                                <button
                                    className="btn btn-secondary"
                                    disabled={page >= totalPages}
                                    onClick={() => setWorkspacePage(p => p + 1)}
                                    style={{ padding: '4px 10px', fontSize: 13 }}
                                >
                                    Próxima →
                                </button>
                            </div>
                        )
                    })()}
                </div>
            )}

            {/* ── Modal Novo Cliente ── */}
            {showNewClient && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
                    onClick={e => { if (e.target === e.currentTarget) setShowNewClient(false) }}
                >
                    <div style={{
                        backgroundColor: 'var(--bg-primary, #fff)', borderRadius: 12,
                        padding: '2rem', width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
                    }}>
                        {newClientResult ? (
                            <>
                                <h2 style={{ fontSize: '1.2rem', marginBottom: 16, color: '#22c55e' }}>
                                    Cliente criado com sucesso!
                                </h2>
                                <p style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-secondary)' }}>
                                    Envie estas credenciais para o cliente:
                                </p>
                                <div style={{
                                    backgroundColor: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8,
                                    padding: 16, fontFamily: 'monospace', fontSize: 14, lineHeight: 1.8
                                }}>
                                    <div><strong>Email:</strong> {newClientResult.email}</div>
                                    <div><strong>Senha:</strong> {newClientResult.password}</div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => {
                                            navigator.clipboard.writeText(
                                                `Email: ${newClientResult.email}\nSenha: ${newClientResult.password}`
                                            )
                                            alert('Credenciais copiadas!')
                                        }}
                                    >
                                        Copiar credenciais
                                    </button>
                                    <button className="btn btn-secondary" onClick={() => setShowNewClient(false)}>
                                        Fechar
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 style={{ fontSize: '1.2rem', marginBottom: 16 }}>Novo Cliente</h2>
                                <form onSubmit={handleCreateClient} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <label className="input-group">
                                        <span className="input-label">Nome / Empresa</span>
                                        <input
                                            className="input"
                                            type="text"
                                            value={newName}
                                            onChange={e => setNewName(e.target.value)}
                                            required
                                            placeholder="Ex: Empresa do Cliente"
                                        />
                                    </label>
                                    <label className="input-group">
                                        <span className="input-label">Email</span>
                                        <input
                                            className="input"
                                            type="email"
                                            value={newEmail}
                                            onChange={e => setNewEmail(e.target.value)}
                                            required
                                            placeholder="cliente@email.com"
                                        />
                                    </label>
                                    <label className="input-group">
                                        <span className="input-label">Senha</span>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <input
                                                className="input"
                                                type="text"
                                                value={newPassword}
                                                onChange={e => setNewPassword(e.target.value)}
                                                required
                                                minLength={6}
                                                style={{ flex: 1 }}
                                            />
                                            <button type="button" className="btn btn-secondary" onClick={generatePassword} title="Gerar senha aleatória" style={{ fontSize: 13 }}>
                                                Gerar
                                            </button>
                                        </div>
                                    </label>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                        <button type="submit" className="btn btn-primary" disabled={newClientLoading}>
                                            {newClientLoading ? 'Criando...' : 'Criar Cliente'}
                                        </button>
                                        <button type="button" className="btn btn-secondary" onClick={() => setShowNewClient(false)}>
                                            Cancelar
                                        </button>
                                    </div>
                                </form>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ── Modal Atribuir Workspace ── */}
            {assignTarget && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
                    onClick={e => { if (e.target === e.currentTarget) setAssignTarget(null) }}
                >
                    <div style={{
                        backgroundColor: 'var(--bg-primary, #fff)', borderRadius: 12,
                        padding: '2rem', width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
                    }}>
                        <h2 style={{ fontSize: '1.2rem', marginBottom: 16 }}>Atribuir Workspace</h2>
                        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                            Atribuindo para: <strong>{assignTarget.userName}</strong>
                        </p>
                        <form onSubmit={handleAssignWorkspace} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <label className="input-group">
                                <span className="input-label">Workspace</span>
                                <select
                                    className="input"
                                    value={assignSlug}
                                    onChange={e => setAssignSlug(e.target.value)}
                                    required
                                >
                                    <option value="">Selecione...</option>
                                    {workspaces.map(ws => (
                                        <option key={ws.slug} value={ws.slug}>
                                            {ws.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="input-group">
                                <span className="input-label">Papel</span>
                                <select
                                    className="input"
                                    value={assignRole}
                                    onChange={e => setAssignRole(e.target.value)}
                                    required
                                >
                                    <option value="owner">Owner</option>
                                    <option value="admin">Admin</option>
                                    <option value="member">Membro</option>
                                    <option value="client">Cliente</option>
                                </select>
                            </label>
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                <button type="submit" className="btn btn-primary" disabled={assignLoading || !assignSlug}>
                                    {assignLoading ? 'Atribuindo...' : 'Atribuir'}
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={() => setAssignTarget(null)}>
                                    Cancelar
                                </button>
                            </div>
                        </form>
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
                                    <th>Status</th>
                                    <th>Workspaces</th>
                                    <th>Criado em</th>
                                    <th>Último login</th>
                                    <th>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.length === 0 && (
                                    <tr>
                                        <td colSpan={7} style={{ color: 'var(--text-secondary)' }}>
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
                                            ) : u.workspaces.length > 0 ? (
                                                <span style={{ color: '#4ae176', fontWeight: 600 }}>Aprovado</span>
                                            ) : (
                                                <span style={{ color: '#ff6b6b', fontWeight: 600 }}>Pendente</span>
                                            )}
                                        </td>
                                        <td style={{ fontSize: 13 }}>
                                            {u.workspaces.length === 0 ? '—' : u.workspaces.map((w, i) => (
                                                <span key={w.workspace_slug}>
                                                    {i > 0 && ', '}
                                                    <strong>{w.workspace_name}</strong>
                                                    <span style={{ color: 'var(--text-secondary)' }}> ({w.role})</span>
                                                </span>
                                            ))}
                                        </td>
                                        <td style={{ fontSize: 13 }}>{fmtDate(u.created_at)}</td>
                                        <td style={{ fontSize: 13 }}>
                                            {u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : 'Nunca'}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                {!u.is_platform_admin && u.workspaces.length === 0 && (
                                                    <button
                                                        className="btn btn-primary"
                                                        style={{ fontSize: 12, padding: '4px 12px' }}
                                                        onClick={() => handleApproveUser(u.id, u.email, u.full_name)}
                                                    >
                                                        Aprovar
                                                    </button>
                                                )}
                                                {!u.is_platform_admin && (
                                                    <>
                                                        <button
                                                            className="btn btn-primary"
                                                            style={{ fontSize: 12, padding: '4px 8px' }}
                                                            onClick={() => {
                                                                setAssignTarget({ userId: u.id, userName: u.full_name || u.email })
                                                                setAssignSlug(workspaces[0]?.slug || '')
                                                                setAssignRole('member')
                                                            }}
                                                        >
                                                            + Workspace
                                                        </button>
                                                        <button
                                                            className="btn btn-secondary"
                                                            style={{ fontSize: 12, padding: '4px 8px' }}
                                                            onClick={() => handleResetPassword(u.id, u.email)}
                                                        >
                                                            Resetar senha
                                                        </button>
                                                        <button
                                                            className="btn btn-secondary"
                                                            style={{ fontSize: 12, padding: '4px 8px', color: '#ef4444' }}
                                                            onClick={() => handleDeleteUser(u.id, u.email)}
                                                        >
                                                            Remover
                                                        </button>
                                                    </>
                                                )}
                                            </div>
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
