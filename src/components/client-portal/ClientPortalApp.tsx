'use client'

import { useCallback, useState } from 'react'
import { Zap } from 'lucide-react'
import { formatRelativeTime } from '@/lib/dashboard/format-relative-time'
import { Toast } from '@/components/dashboard/Toast'
import { ClientPortalStats } from './ClientPortalStats'
import { useClientPortalState } from './use-client-portal-state'

function senderLabel(senderType: string): string {
    if (senderType === 'ai') return 'Assistente'
    if (senderType === 'contact') return 'Cliente'
    if (senderType === 'user') return 'Equipa'
    return senderType
}

function connectionLabel(status: string | undefined): string {
    if (!status) return 'Ainda não configurado'
    if (status === 'connected') return 'Ligado ao WhatsApp'
    if (status === 'disconnected') return 'Desligado — gera um novo QR Code para voltar a ligar'
    return status
}

function AccountSection({ p }: { p: ReturnType<typeof useClientPortalState> }) {
    const [editingName, setEditingName] = useState(false)
    const [nameInput, setNameInput] = useState(p.userName || '')
    const [showPasswordForm, setShowPasswordForm] = useState(false)
    const [currentPwd, setCurrentPwd] = useState('')
    const [newPwd, setNewPwd] = useState('')
    const [confirmPwd, setConfirmPwd] = useState('')

    async function saveName(e: React.FormEvent) {
        e.preventDefault()
        const name = nameInput.trim()
        if (!name) return
        const ok = await p.updateProfile(name)
        if (ok) setEditingName(false)
    }

    async function savePassword(e: React.FormEvent) {
        e.preventDefault()
        if (!currentPwd.trim()) {
            p.setToast({ message: 'Preenche a senha atual.', variant: 'error' })
            return
        }
        if (newPwd.length < 6) {
            p.setToast({ message: 'Nova senha: mínimo 6 caracteres.', variant: 'error' })
            return
        }
        if (newPwd !== confirmPwd) {
            p.setToast({ message: 'As senhas não coincidem.', variant: 'error' })
            return
        }
        const ok = await p.changePassword(currentPwd, newPwd)
        if (ok) {
            setCurrentPwd('')
            setNewPwd('')
            setConfirmPwd('')
            setShowPasswordForm(false)
        }
    }

    return (
        <div className="card">
            <div className="card-header">
                <span className="card-title">Minha conta</span>
            </div>

            {/* Nome */}
            <div style={{ marginBottom: 20 }}>
                <label className="input-label">Nome</label>
                {editingName ? (
                    <form onSubmit={saveName} style={{ display: 'flex', gap: 8, maxWidth: 420 }}>
                        <input
                            className="input"
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value)}
                            autoComplete="name"
                            autoFocus
                        />
                        <button type="submit" className="btn btn-primary" disabled={p.busy}>
                            Guardar
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                                setEditingName(false)
                                setNameInput(p.userName || '')
                            }}
                        >
                            Cancelar
                        </button>
                    </form>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 15 }}>{p.userName || '(não definido)'}</span>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 12, padding: '2px 10px' }}
                            onClick={() => {
                                setNameInput(p.userName || '')
                                setEditingName(true)
                            }}
                        >
                            Editar
                        </button>
                    </div>
                )}
            </div>

            {/* Email (readonly) */}
            <div style={{ marginBottom: 20 }}>
                <label className="input-label">Email</label>
                <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>{p.userEmail || '—'}</span>
            </div>

            {/* Senha */}
            <div>
                <label className="input-label">Senha</label>
                {showPasswordForm ? (
                    <form onSubmit={savePassword} style={{ maxWidth: 420 }}>
                        <input
                            type="password"
                            className="input"
                            placeholder="Senha atual"
                            value={currentPwd}
                            onChange={e => setCurrentPwd(e.target.value)}
                            autoComplete="current-password"
                            style={{ marginBottom: 10 }}
                        />
                        <input
                            type="password"
                            className="input"
                            placeholder="Nova senha (mínimo 6 caracteres)"
                            value={newPwd}
                            onChange={e => setNewPwd(e.target.value)}
                            autoComplete="new-password"
                            style={{ marginBottom: 10 }}
                        />
                        <input
                            type="password"
                            className="input"
                            placeholder="Confirmar nova senha"
                            value={confirmPwd}
                            onChange={e => setConfirmPwd(e.target.value)}
                            autoComplete="new-password"
                            style={{ marginBottom: 12 }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="submit" className="btn btn-primary" disabled={p.busy}>
                                Alterar senha
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => {
                                    setShowPasswordForm(false)
                                    setCurrentPwd('')
                                    setNewPwd('')
                                    setConfirmPwd('')
                                }}
                            >
                                Cancelar
                            </button>
                        </div>
                    </form>
                ) : (
                    <div>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 13 }}
                            onClick={() => setShowPasswordForm(true)}
                        >
                            Alterar senha
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

export function ClientPortalApp() {
    const p = useClientPortalState()

    const dismissToast = useCallback(() => p.setToast(null), [p.setToast])

    const refreshAll = useCallback(() => {
        if (!p.selectedSlug) return
        void p.loadInstance(p.selectedSlug, { syncUazapi: true })
        void p.loadMessages(p.selectedSlug)
        void p.loadStats(p.selectedSlug, p.statsDays)
    }, [p.selectedSlug, p.loadInstance, p.loadMessages, p.loadStats, p.statsDays])

    return (
        <div className="client-portal">
            <header className="client-portal-header">
                <div className="client-portal-brand">
                    <div className="sidebar-brand-icon" aria-hidden="true">
                        <Zap size={18} />
                    </div>
                    <div>
                        <h1 className="client-portal-title">Área do cliente</h1>
                        <p className="client-portal-tagline">WhatsApp e resumo da IA da sua empresa</p>
                    </div>
                </div>
                <div className="client-portal-header-actions">
                    {p.workspaces.length > 1 && (
                        <label className="client-portal-workspace-label">
                            <span className="workspace-selector-label">Empresa</span>
                            <select
                                className="client-portal-select client-portal-select--header"
                                value={p.selectedSlug ?? ''}
                                onChange={e => p.setSelectedSlug(e.target.value || null)}
                            >
                                {p.workspaces.map(w => (
                                    <option key={w.slug} value={w.slug}>
                                        {w.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    {p.userEmail && (
                        <span className="client-portal-email" title={p.userEmail}>
                            {p.userEmail}
                        </span>
                    )}
                    <button type="button" className="btn btn-secondary" onClick={() => p.logout()}>
                        Sair
                    </button>
                </div>
            </header>

            <main className="client-portal-main">
                {p.loadError && (
                    <div className="card alert-card" role="alert">
                        <p className="alert-card-text">{p.loadError}</p>
                    </div>
                )}

                {!p.selectedSlug && p.workspaces.length === 0 && (
                    <>
                        <div className="card">
                            <p className="client-portal-muted">
                                Ainda não tens acesso a nenhuma empresa. Pedir à equipa que te adicione como membro
                                do workspace.
                            </p>
                        </div>
                        <AccountSection p={p} />
                    </>
                )}

                {p.selectedSlug && (
                    <>
                        <div className="page-header client-portal-page-header">
                            <h2>{p.selectedWs?.name ?? 'Empresa'}</h2>
                            <p>Liga o WhatsApp da empresa e consulta o desempenho do assistente automático.</p>
                        </div>

                        <div className="card">
                            <div className="card-header">
                                <span className="card-title">Ligação WhatsApp</span>
                                <span
                                    className={`status-badge ${
                                        p.instance?.status === 'connected'
                                            ? 'connected'
                                            : p.instance?.status === 'connecting'
                                              ? 'connecting'
                                              : 'disconnected'
                                    }`}
                                >
                                    <span className="status-dot" aria-hidden="true" />
                                    {p.instance?.status === 'connected'
                                        ? 'Ligado'
                                        : p.instance
                                          ? p.instance.status
                                          : 'Não configurado'}
                                </span>
                            </div>
                            <p className="client-portal-muted" style={{ marginBottom: 16 }}>
                                {connectionLabel(p.instance?.status)}
                            </p>
                            {p.instance?.phone_number && (
                                <p className="client-portal-phone">{p.instance.phone_number}</p>
                            )}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {!p.instance && (
                                    <p className="client-portal-muted" style={{ margin: 0, flex: '1 1 100%' }}>
                                        A ligação WhatsApp ainda não foi configurada. Pedir a um administrador da
                                        empresa (painel interno) para preparar a instância; depois poderás associar o
                                        telemóvel com o QR Code aqui.
                                    </p>
                                )}
                                {p.instance && p.instance.status !== 'connected' && (
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        disabled={p.busy}
                                        onClick={p.connectWhatsapp}
                                    >
                                        Mostrar QR Code para associar
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    disabled={p.busy || !p.instance}
                                    onClick={() =>
                                        p.selectedSlug && p.loadInstance(p.selectedSlug, { syncUazapi: true })
                                    }
                                >
                                    Atualizar estado
                                </button>
                            </div>
                            {p.qrSrc && (
                                <div className="client-portal-qr-block">
                                    <img
                                        src={p.qrSrc}
                                        alt="Código QR para associar o WhatsApp"
                                        className="client-portal-qr-img"
                                    />
                                    {p.qrPayload?.pairingCode && (
                                        <p className="client-portal-pairing">
                                            Ou usa o código: <strong>{p.qrPayload.pairingCode}</strong>
                                        </p>
                                    )}
                                    <p className="client-portal-muted client-portal-qr-hint">
                                        Na app WhatsApp: Definições → Aparelhos ligados → Ligar um aparelho →
                                        escaneia o código com o telemóvel da empresa.
                                    </p>
                                </div>
                            )}
                        </div>

                        <ClientPortalStats
                            stats={p.stats}
                            statsLoadFailed={p.statsLoadFailed}
                            statsDays={p.statsDays}
                            onStatsDaysChange={p.setStatsDays}
                            onRefresh={refreshAll}
                            busy={p.busy}
                        />

                        <div className="card">
                            <div className="card-header">
                                <span className="card-title">Conversa recente (amostra)</span>
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ fontSize: 12 }}
                                    disabled={p.busy}
                                    onClick={() => p.selectedSlug && p.loadMessages(p.selectedSlug)}
                                >
                                    Atualizar
                                </button>
                            </div>
                            <p className="client-portal-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                                Pré-visualização das últimas mensagens registadas (sem dados técnicos).
                            </p>
                            <div className="message-list">
                                {p.messages.map(msg => (
                                    <div key={msg.id} className="message-item">
                                        <div className="message-avatar" aria-hidden="true">
                                            {senderLabel(msg.sender_type)[0]?.toUpperCase()}
                                        </div>
                                        <div className="message-content">
                                            <div className="message-name">{senderLabel(msg.sender_type)}</div>
                                            <div className="message-text message-text--multiline">
                                                {msg.body || '—'}
                                            </div>
                                        </div>
                                        <span
                                            className="message-time"
                                            title={new Date(msg.created_at).toLocaleString('pt-PT')}
                                        >
                                            <span className="message-time-relative">
                                                {formatRelativeTime(msg.created_at)}
                                            </span>
                                            <span className="message-time-full">
                                                {new Date(msg.created_at).toLocaleString('pt-PT')}
                                            </span>
                                        </span>
                                    </div>
                                ))}
                                {p.messages.length === 0 && (
                                    <p className="client-portal-muted">Sem mensagens registadas ainda.</p>
                                )}
                            </div>
                        </div>

                        <AccountSection p={p} />
                    </>
                )}
            </main>

            {p.toast && (
                <div className="toast-region" aria-live="polite">
                    <Toast message={p.toast.message} variant={p.toast.variant} onDismiss={dismissToast} />
                </div>
            )}
        </div>
    )
}
