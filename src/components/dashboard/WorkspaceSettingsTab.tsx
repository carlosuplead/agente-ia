'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDashboard } from './dashboard-context'

type MemberRow = {
    user_id: string
    role: string
    created_at: string
    email: string | null
}

export function WorkspaceSettingsTab() {
    const d = useDashboard()
    const [wsName, setWsName] = useState('')
    const [members, setMembers] = useState<MemberRow[]>([])
    const [membersLoading, setMembersLoading] = useState(false)
    const [inviteEmail, setInviteEmail] = useState('')
    const [invitePassword, setInvitePassword] = useState('')

    const canOpen = Boolean(d.selectedSlug && d.canManageWorkspaceSlug(d.selectedSlug))
    const canEdit = d.selectedSlug ? d.canEditWorkspaceIdentity(d.selectedSlug) : false
    const canInvite = d.selectedSlug ? d.canInvitePortalClients(d.selectedSlug) : false

    useEffect(() => {
        setWsName(d.selectedWs?.name ?? '')
    }, [d.selectedWs?.name, d.selectedSlug])

    const loadMembers = useCallback(async () => {
        if (!d.selectedSlug || !canInvite) {
            setMembers([])
            return
        }
        setMembersLoading(true)
        const res = await fetch(`/api/workspaces/${encodeURIComponent(d.selectedSlug)}/members`, {
            credentials: 'include'
        })
        setMembersLoading(false)
        const json = (await res.json().catch(() => ({}))) as { members?: MemberRow[]; error?: string }
        if (!res.ok) {
            d.setToast({ message: json.error || 'Não foi possível carregar membros.', variant: 'error' })
            setMembers([])
            return
        }
        setMembers(json.members || [])
    }, [d.selectedSlug, canInvite, d.setToast])

    useEffect(() => {
        void loadMembers()
    }, [loadMembers])

    async function saveWorkspaceName(e: React.FormEvent) {
        e.preventDefault()
        if (!d.selectedSlug || !canEdit) return
        const name = wsName.trim()
        if (!name) {
            d.setToast({ message: 'Indica um nome.', variant: 'error' })
            return
        }
        d.setLoadError('')
        const res = await fetch(`/api/workspaces/${encodeURIComponent(d.selectedSlug)}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
            d.setLoadError((json as { error?: string }).error || 'Falha ao guardar o nome')
            d.setToast({ message: 'Não foi possível guardar o nome.', variant: 'error' })
            return
        }
        await d.refreshWorkspaces()
        d.setToast({ message: 'Nome do workspace atualizado.', variant: 'success' })
    }

    async function sendInvite(e: React.FormEvent) {
        e.preventDefault()
        if (!d.selectedSlug || !canInvite) return
        const email = inviteEmail.trim().toLowerCase()
        if (!email) {
            d.setToast({ message: 'Indica o email do cliente.', variant: 'error' })
            return
        }
        const payload: { email: string; password?: string } = { email }
        const pwd = invitePassword.trim()
        if (pwd.length > 0) {
            payload.password = pwd
        }

        const res = await fetch(
            `/api/workspaces/${encodeURIComponent(d.selectedSlug)}/members/invite-client`,
            {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        )
        const json = (await res.json().catch(() => ({}))) as {
            error?: string
            hint?: string
            message?: string
            pending?: boolean
        }
        if (!res.ok && res.status !== 202) {
            const detail = [json.error, json.hint].filter(Boolean).join(' ')
            d.setToast({
                message: detail || `Pedido falhou (HTTP ${res.status}).`,
                variant: 'error'
            })
            return
        }
        setInviteEmail('')
        setInvitePassword('')
        d.setToast({
            message: json.message || (res.status === 202 ? 'Convite em processamento.' : 'Convite enviado.'),
            variant: 'success'
        })
        await loadMembers()
    }

    async function removeClient(userId: string, email: string | null) {
        if (!d.selectedSlug || !canInvite) return
        if (!window.confirm(`Remover acesso ao portal para ${email || userId}?`)) return
        const res = await fetch(
            `/api/workspaces/${encodeURIComponent(d.selectedSlug)}/members?user_id=${encodeURIComponent(userId)}`,
            { method: 'DELETE', credentials: 'include' }
        )
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
            d.setToast({
                message: (json as { error?: string }).error || 'Não foi possível remover.',
                variant: 'error'
            })
            return
        }
        d.setToast({ message: 'Acesso removido.', variant: 'success' })
        await loadMembers()
    }

    const portalUrl =
        typeof window !== 'undefined' ? `${window.location.origin}/portal` : '/portal'

    return (
        <>
            <div className="page-header">
                <h2>Definições</h2>
                <p>Configurações do seu espaço de trabalho.</p>
            </div>

            {!d.selectedSlug && (
                <p style={{ color: 'var(--text-secondary)' }}>Seleciona um workspace na grelha ou no menu.</p>
            )}

            {d.selectedSlug && !canOpen && (
                <div className="card">
                    <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        Sem permissão para alterar as definições deste workspace.
                    </p>
                </div>
            )}

            {d.selectedSlug && canOpen && (
                <>
                    {canEdit && (
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Identidade</span>
                        </div>
                        {d.isPlatformAdmin && (
                            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                                O <strong>slug</strong> (schema na base de dados) não pode ser alterado aqui:{' '}
                                <code>{d.selectedSlug}</code>
                            </p>
                        )}
                        <form onSubmit={saveWorkspaceName} className="input-group" style={{ maxWidth: 420 }}>
                            <label className="input-label" htmlFor="ws-settings-name">
                                Nome apresentado
                            </label>
                            <input
                                id="ws-settings-name"
                                className="input"
                                value={wsName}
                                onChange={e => setWsName(e.target.value)}
                                autoComplete="organization"
                            />
                            <button type="submit" className="btn btn-primary" style={{ marginTop: 12 }}>
                                Guardar nome
                            </button>
                        </form>
                    </div>
                    )}

                    {d.isPlatformAdmin && canInvite && (
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Portal do cliente</span>
                        </div>
                        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
                            Partilha este endereço com o cliente (depois de criares o acesso abaixo). Ele só vê o portal
                            — não o painel interno nem a configuração da IA.
                        </p>
                        <p style={{ fontSize: 13, marginBottom: 16 }}>
                            <strong>URL:</strong>{' '}
                            <a href={portalUrl} target="_blank" rel="noreferrer">
                                {portalUrl}
                            </a>
                        </p>

                        <form onSubmit={sendInvite} style={{ marginBottom: 24 }}>
                            <label className="input-label" htmlFor="invite-client-email">
                                Email do cliente
                            </label>
                            <input
                                id="invite-client-email"
                                type="email"
                                className="input"
                                style={{ maxWidth: 420, marginBottom: 12 }}
                                placeholder="cliente@empresa.com"
                                value={inviteEmail}
                                onChange={e => setInviteEmail(e.target.value)}
                                autoComplete="email"
                            />
                            <label className="input-label" htmlFor="invite-client-password">
                                Senha para login imediato
                            </label>
                            <input
                                id="invite-client-password"
                                type="password"
                                className="input"
                                style={{ maxWidth: 420, marginBottom: 12 }}
                                placeholder="Mínimo 8 caracteres (recomendado). Vazio = só convite por email"
                                value={invitePassword}
                                onChange={e => setInvitePassword(e.target.value)}
                                autoComplete="new-password"
                            />
                            <button type="submit" className="btn btn-primary">
                                Criar acesso ao portal
                            </button>
                        </form>

                        <div className="card-header" style={{ padding: 0, marginBottom: 8 }}>
                            <span className="card-title" style={{ fontSize: 15 }}>
                                Acessos portal ({members.filter(m => m.role === 'client').length})
                            </span>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: 12 }}
                                disabled={membersLoading}
                                onClick={() => void loadMembers()}
                            >
                                Atualizar lista
                            </button>
                        </div>

                        {membersLoading && (
                            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>A carregar…</p>
                        )}

                        {!membersLoading && members.filter(m => m.role === 'client').length === 0 && (
                            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                                Ainda não há contas só-portal. Usa o formulário acima.
                            </p>
                        )}

                        <ul className="workspace-settings-member-list">
                            {members
                                .filter(m => m.role === 'client')
                                .map(m => (
                                    <li key={m.user_id} className="workspace-settings-member-item">
                                        <div>
                                            <div style={{ fontWeight: 600 }}>{m.email || m.user_id}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                                Cliente (só /portal)
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            style={{ fontSize: 12 }}
                                            onClick={() => void removeClient(m.user_id, m.email)}
                                        >
                                            Remover
                                        </button>
                                    </li>
                                ))}
                        </ul>

                        {members.some(m => m.role !== 'client') && (
                            <>
                                <p
                                    style={{
                                        fontSize: 13,
                                        fontWeight: 600,
                                        marginTop: 20,
                                        marginBottom: 8,
                                        color: 'var(--text-secondary)'
                                    }}
                                >
                                    Equipa interna (não gerida aqui)
                                </p>
                                <ul style={{ fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 18 }}>
                                    {members
                                        .filter(m => m.role !== 'client')
                                        .map(m => (
                                            <li key={m.user_id} style={{ marginBottom: 4 }}>
                                                {m.email || m.user_id} — {m.role}
                                            </li>
                                        ))}
                                </ul>
                            </>
                        )}
                    </div>
                    )}
                </>
            )}
        </>
    )
}
