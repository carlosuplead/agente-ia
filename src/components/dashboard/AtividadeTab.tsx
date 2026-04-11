'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
    ListTree,
    PlayCircle
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

type RunRow = {
    id: string
    contact_id: string
    conversation_id: string | null
    status: string
    source: string
    started_at: string
    finished_at: string | null
    reason: string | null
    error_message: string | null
    meta: unknown
    contact_phone?: string
    contact_name?: string
}

type FilterType = 'all' | 'contact' | 'ai' | 'user' | 'system'
type ActivityView = 'messages' | 'runs'
type RunFilterType = 'all' | 'running' | 'success' | 'error' | 'skipped'

function formatMsDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '—'
    if (ms < 1000) return `${Math.round(ms)} ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`
    return `${(ms / 3_600_000).toFixed(1)} h`
}

function formatRunDuration(started: string, finished: string | null, status: string): string {
    const s = new Date(started).getTime()
    if (!Number.isFinite(s)) return '—'
    const f = finished ? new Date(finished).getTime() : NaN
    const end = Number.isFinite(f) ? f : status === 'running' ? Date.now() : s
    return formatMsDuration(end - s)
}

function runStatusBadgeClass(status: string): string {
    switch (status) {
        case 'running':
            return 'status-badge connecting'
        case 'success':
            return 'status-badge connected'
        case 'error':
            return 'status-badge disconnected'
        case 'skipped':
            return 'status-badge'
        default:
            return 'status-badge'
    }
}

function runStatusLabel(status: string): string {
    const map: Record<string, string> = {
        running: 'Em curso',
        success: 'Sucesso',
        error: 'Erro',
        skipped: 'Ignorada'
    }
    return map[status] || status
}

function runSourceLabel(source: string): string {
    const map: Record<string, string> = {
        buffer: 'Buffer',
        http_process: 'API interna',
        schedule: 'Agendamento',
        unknown: '—'
    }
    return map[source] || source
}

function truncate(s: string | null | undefined, max: number): string {
    if (!s) return '—'
    const t = s.trim()
    if (t.length <= max) return t
    return `${t.slice(0, max - 1)}…`
}

export function AtividadeTab() {
    const d = useDashboard()
    const slug = d.selectedSlug
    const [entries, setEntries] = useState<LogEntry[]>([])
    const [runs, setRuns] = useState<RunRow[]>([])
    const [loading, setLoading] = useState(false)
    const [runsLoading, setRunsLoading] = useState(false)
    const [filter, setFilter] = useState<FilterType>('all')
    const [runFilter, setRunFilter] = useState<RunFilterType>('all')
    const [autoRefresh, setAutoRefresh] = useState(true)
    const [view, setView] = useState<ActivityView>('messages')

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

    const loadRuns = useCallback(async () => {
        if (!slug) {
            setRuns([])
            return
        }
        setRunsLoading(true)
        try {
            const res = await fetch(
                `/api/ai/runs/recent?workspace_slug=${encodeURIComponent(slug)}&limit=100`,
                { credentials: 'include' }
            )
            const j = await res.json().catch(() => ({}))
            if (Array.isArray(j.runs)) {
                setRuns(j.runs as RunRow[])
            }
        } finally {
            setRunsLoading(false)
        }
    }, [slug])

    useEffect(() => {
        void loadActivity()
        void loadRuns()
    }, [loadActivity, loadRuns])

    const hasRunningRuns = runs.some(r => r.status === 'running')
    const refreshMs = view === 'runs' && hasRunningRuns ? 2500 : 10000

    useEffect(() => {
        if (!autoRefresh || !slug) return
        const id = setInterval(() => {
            if (view === 'messages') void loadActivity()
            else void loadRuns()
        }, refreshMs)
        return () => clearInterval(id)
    }, [autoRefresh, slug, view, refreshMs, loadActivity, loadRuns])

    const filtered = filter === 'all'
        ? entries
        : entries.filter(e => {
            if (filter === 'contact') return e.sender_type === 'contact'
            if (filter === 'ai') return e.sender_type === 'ai'
            if (filter === 'user') return e.sender_type === 'user'
            if (filter === 'system') return e.sender_type === 'system'
            return true
        })

    const filteredRuns = useMemo(() => {
        if (runFilter === 'all') return runs
        return runs.filter(r => r.status === runFilter)
    }, [runs, runFilter])

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

    async function refreshAll() {
        await Promise.all([loadActivity(), loadRuns()])
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
                            {view === 'messages'
                                ? 'Eventos recentes do workspace em tempo real'
                                : 'Execuções do processamento IA (inclui geração e envio)'}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
                            disabled={loading || runsLoading}
                            onClick={() => void refreshAll()}
                        >
                            <RefreshCw size={14} />
                            Atualizar
                        </button>
                    </div>
                </div>
            </div>

            <div className="activity-view-toggle" role="tablist" aria-label="Vista de atividade">
                <button
                    type="button"
                    role="tab"
                    aria-selected={view === 'messages'}
                    className={`btn ${view === 'messages' ? 'btn-primary' : 'btn-secondary'} btn-compact`}
                    onClick={() => setView('messages')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                    <MessageCircle size={14} />
                    Mensagens
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={view === 'runs'}
                    className={`btn ${view === 'runs' ? 'btn-primary' : 'btn-secondary'} btn-compact`}
                    onClick={() => setView('runs')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                    <PlayCircle size={14} />
                    Execuções IA
                    {hasRunningRuns && (
                        <span className="activity-runs-live-dot" title="Há execuções em curso" />
                    )}
                </button>
            </div>

            {view === 'messages' ? (
                <>
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

                    <div className="card">
                        <div className="card-header">
                            <div className="card-header-left">
                                <div className="card-header-icon card-header-icon--blue">
                                    <Activity size={16} />
                                </div>
                                <span className="card-title">Eventos recentes</span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {filtered.length} evento(s)
                                {autoRefresh && ` · cada ${refreshMs / 1000}s`}
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
            ) : (
                <>
                    <div className="activity-filter-bar">
                        {([
                            { key: 'all', label: 'Todos', icon: ListTree },
                            { key: 'running', label: 'Em curso', icon: PlayCircle },
                            { key: 'success', label: 'Sucesso', icon: Activity },
                            { key: 'error', label: 'Erro', icon: AlertTriangle },
                            { key: 'skipped', label: 'Ignoradas', icon: MessageCircle },
                        ] as const).map(f => (
                            <button
                                key={f.key}
                                type="button"
                                className={`btn ${runFilter === f.key ? 'btn-primary' : 'btn-secondary'} btn-compact`}
                                onClick={() => setRunFilter(f.key)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                                <f.icon size={13} />
                                {f.label}
                            </button>
                        ))}
                    </div>

                    <div className="disparos-stats" style={{ marginBottom: 16 }}>
                        <div className="disparos-stat-item">
                            <span className="disparos-stat-value">{runs.length}</span>
                            <span className="disparos-stat-label">Total execuções</span>
                        </div>
                        <div className="disparos-stat-item">
                            <span className="disparos-stat-value" style={{ color: 'var(--orange)' }}>
                                {runs.filter(r => r.status === 'running').length}
                            </span>
                            <span className="disparos-stat-label">Em curso</span>
                        </div>
                        <div className="disparos-stat-item">
                            <span className="disparos-stat-value disparos-stat-value--green">
                                {runs.filter(r => r.status === 'success').length}
                            </span>
                            <span className="disparos-stat-label">Sucesso</span>
                        </div>
                        <div className="disparos-stat-item">
                            <span className="disparos-stat-value" style={{ color: 'var(--red)' }}>
                                {runs.filter(r => r.status === 'error').length}
                            </span>
                            <span className="disparos-stat-label">Erro</span>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <div className="card-header-left">
                                <div className="card-header-icon card-header-icon--blue">
                                    <ListTree size={16} />
                                </div>
                                <span className="card-title">Execuções IA</span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {filteredRuns.length} linha(s)
                                {autoRefresh && ` · ${hasRunningRuns ? 'atualização rápida' : 'cada 10s'}`}
                            </span>
                        </div>

                        <div className="activity-runs-wrap">
                            <table className="activity-runs-table">
                                <thead>
                                    <tr>
                                        <th>Estado</th>
                                        <th>Contacto</th>
                                        <th>Início</th>
                                        <th>Duração</th>
                                        <th>Origem</th>
                                        <th>Resumo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredRuns.map(r => (
                                        <tr key={r.id}>
                                            <td>
                                                <span className={runStatusBadgeClass(r.status)}>
                                                    {runStatusLabel(r.status)}
                                                </span>
                                            </td>
                                            <td>
                                                {r.contact_name || r.contact_phone || r.contact_id.slice(0, 8)}
                                            </td>
                                            <td title={new Date(r.started_at).toLocaleString()}>
                                                {formatRelativeTime(r.started_at)}
                                            </td>
                                            <td>{formatRunDuration(r.started_at, r.finished_at, r.status)}</td>
                                            <td>{runSourceLabel(r.source)}</td>
                                            <td className="activity-runs-summary">
                                                {truncate(r.reason || r.error_message, 72)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {filteredRuns.length === 0 && !runsLoading && (
                                <div className="disparos-empty" style={{ padding: 32 }}>
                                    <ListTree size={28} />
                                    <p>Sem execuções registadas.</p>
                                    <p>Aparecem aqui quando o agente processa mensagens (buffer, API ou agendamento).</p>
                                </div>
                            )}

                            {runsLoading && runs.length === 0 && (
                                <div className="disparos-empty" style={{ padding: 32 }}>
                                    <RefreshCw size={20} className="spin" />
                                    <p>A carregar execuções...</p>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </>
    )
}
