'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDashboard } from './dashboard-context'
import {
    Activity,
    MessageCircle,
    Bot,
    Send,
    AlertTriangle,
    RefreshCw,
    ArrowDownCircle,
    ArrowUpCircle,
    UserPlus
} from 'lucide-react'
import { formatRelativeTime } from '@/lib/dashboard/format-relative-time'

type LogEntry = {
    id: string
    body: string | null
    sender_type: string
    status: string
    created_at: string
    contact_id: string
    contact_phone?: string
    contact_name?: string
}

type FilterType = 'all' | 'contact' | 'ai' | 'user' | 'system'

export function AtividadeTab() {
    const d = useDashboard()
    const slug = d.selectedSlug
    const [entries, setEntries] = useState<LogEntry[]>([])
    const [loading, setLoading] = useState(false)
    const [filter, setFilter] = useState<FilterType>('all')
    const [autoRefresh, setAutoRefresh] = useState(true)

    const loadActivity = useCallback(async () => {
        if (!slug) {
            setEntries([])
            return
        }
        setLoading(true)
        try {
            const res = await fetch(
                `/api/messages/recent?workspace_slug=${encodeURIComponent(slug)}&limit=100`,
                { credentials: 'include' }
            )
            const j = await res.json().catch(() => ({}))
            if (Array.isArray(j.messages)) {
                setEntries(j.messages as LogEntry[])
            }
        } finally {
            setLoading(false)
        }
    }, [slug])

    useEffect(() => {
        void loadActivity()
    }, [loadActivity])

    // Auto-refresh every 10s
    useEffect(() => {
        if (!autoRefresh || !slug) return
        const id = setInterval(() => {
            void loadActivity()
        }, 10000)
        return () => clearInterval(id)
    }, [autoRefresh, slug, loadActivity])

    const filtered = filter === 'all'
        ? entries
        : entries.filter(e => {
            if (filter === 'contact') return e.sender_type === 'contact'
            if (filter === 'ai') return e.sender_type === 'ai'
            if (filter === 'user') return e.sender_type === 'user'
            if (filter === 'system') return e.sender_type === 'system'
            return true
        })

    function iconForType(type: string) {
        switch (type) {
            case 'contact': return <ArrowDownCircle size={16} />
            case 'ai': return <Bot size={16} />
            case 'user': return <ArrowUpCircle size={16} />
            case 'system': return <AlertTriangle size={16} />
            default: return <MessageCircle size={16} />
        }
    }

    function iconClassForType(type: string) {
        switch (type) {
            case 'contact': return 'activity-log-icon--inbound'
            case 'ai': return 'activity-log-icon--ai'
            case 'user': return 'activity-log-icon--outbound'
            case 'system': return 'activity-log-icon--error'
            default: return 'activity-log-icon--system'
        }
    }

    function labelForType(type: string) {
        switch (type) {
            case 'contact': return 'Mensagem recebida'
            case 'ai': return 'Resposta da IA'
            case 'user': return 'Enviada pela equipa'
            case 'system': return 'Sistema'
            default: return type
        }
    }

    if (!slug) {
        return (
            <>
                <div className="page-header">
                    <h2>Atividade</h2>
                    <p className="page-subtitle">Selecione um workspace para ver a atividade.</p>
                </div>
            </>
        )
    }

    return (
        <>
            <div className="page-header">
                <div className="page-header-row">
                    <div>
                        <h2>Atividade</h2>
                        <p className="page-subtitle">
                            Eventos recentes do workspace em tempo real
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={e => setAutoRefresh(e.target.checked)}
                            />
                            Auto-refresh
                        </label>
                        <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            disabled={loading}
                            onClick={() => loadActivity()}
                        >
                            <RefreshCw size={14} />
                            Atualizar
                        </button>
                    </div>
                </div>
            </div>

            {/* Filter bar */}
            <div className="activity-filter-bar">
                {([
                    { key: 'all', label: 'Todos', icon: Activity },
                    { key: 'contact', label: 'Recebidas', icon: ArrowDownCircle },
                    { key: 'ai', label: 'IA', icon: Bot },
                    { key: 'user', label: 'Equipa', icon: Send },
                ] as const).map(f => (
                    <button
                        key={f.key}
                        type="button"
                        className={`btn ${filter === f.key ? 'btn-primary' : 'btn-secondary'} btn-compact`}
                        onClick={() => setFilter(f.key)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                        <f.icon size={13} />
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Stats summary */}
            <div className="disparos-stats" style={{ marginBottom: 16 }}>
                <div className="disparos-stat-item">
                    <span className="disparos-stat-value">{entries.length}</span>
                    <span className="disparos-stat-label">Total eventos</span>
                </div>
                <div className="disparos-stat-item">
                    <span className="disparos-stat-value disparos-stat-value--green">
                        {entries.filter(e => e.sender_type === 'contact').length}
                    </span>
                    <span className="disparos-stat-label">Recebidas</span>
                </div>
                <div className="disparos-stat-item">
                    <span className="disparos-stat-value" style={{ color: 'var(--purple)' }}>
                        {entries.filter(e => e.sender_type === 'ai').length}
                    </span>
                    <span className="disparos-stat-label">IA</span>
                </div>
                <div className="disparos-stat-item">
                    <span className="disparos-stat-value" style={{ color: 'var(--accent)' }}>
                        {entries.filter(e => e.sender_type === 'user').length}
                    </span>
                    <span className="disparos-stat-label">Equipa</span>
                </div>
            </div>

            {/* Activity List */}
            <div className="card">
                <div className="card-header">
                    <div className="card-header-left">
                        <div className="card-header-icon card-header-icon--blue">
                            <Activity size={16} />
                        </div>
                        <span className="card-title">Eventos Recentes</span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {filtered.length} evento(s)
                        {autoRefresh && ' · atualização automática'}
                    </span>
                </div>

                <div className="activity-log-list">
                    {filtered.map(entry => (
                        <div key={entry.id} className="activity-log-item">
                            <div className={`activity-log-icon ${iconClassForType(entry.sender_type)}`}>
                                {iconForType(entry.sender_type)}
                            </div>
                            <div className="activity-log-content">
                                <div className="activity-log-title">
                                    {labelForType(entry.sender_type)}
                                    {entry.contact_name && (
                                        <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>
                                            {' — '}{entry.contact_name}
                                        </span>
                                    )}
                                    {!entry.contact_name && entry.contact_phone && (
                                        <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>
                                            {' — '}{entry.contact_phone}
                                        </span>
                                    )}
                                </div>
                                <div className="activity-log-body">
                                    {entry.body || '[sem conteúdo]'}
                                </div>
                            </div>
                            <span className="activity-log-time" title={new Date(entry.created_at).toLocaleString()}>
                                {formatRelativeTime(entry.created_at)}
                            </span>
                        </div>
                    ))}

                    {filtered.length === 0 && !loading && (
                        <div className="disparos-empty" style={{ padding: 40 }}>
                            <Activity size={28} />
                            <p>Sem atividade recente.</p>
                            <p>As mensagens enviadas e recebidas aparecerão aqui.</p>
                        </div>
                    )}

                    {loading && entries.length === 0 && (
                        <div className="disparos-empty" style={{ padding: 40 }}>
                            <RefreshCw size={20} className="spin" />
                            <p>Carregando atividade...</p>
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}
