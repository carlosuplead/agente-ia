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
    PlayCircle,
    X,
    FileText,
    MessageSquare,
    Wrench,
    Cpu,
    User,
    ChevronDown,
    ChevronRight
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

type RunStep = {
    step: string
    ts: number
    detail?: unknown
}

type RunExtras = {
    system_prompt?: string
    context_transcript?: string
    last_user_message?: string
    llm_response_full?: string
    llm_usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    model?: string
    provider?: string
    temperature?: number
    tools_called?: string[]
    handoff?: { triggered: boolean; reason?: string | null }
    chunks_sent?: string[]
}

type RunMeta = {
    steps?: RunStep[]
    extras?: RunExtras
    duration_ms?: number
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
    meta: RunMeta | null
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

const STEP_LABELS: Record<string, string> = {
    start: 'Execução iniciada',
    handoff_keywords_check: 'Verificação de palavras-chave de transferência',
    handoff_keyword_matched: 'Palavra-chave de transferência detectada',
    media_processed: 'Mídias processadas',
    media_processing_error: 'Erro ao processar mídias',
    context_built: 'Contexto da conversa montado',
    llm_calling: 'Chamando modelo de IA',
    llm_responded: 'Resposta da IA recebida',
    llm_error: 'Erro na chamada do modelo',
    response_chunked: 'Resposta dividida em mensagens',
    message_sent: 'Mensagem enviada',
    message_send_failed: 'Falha ao enviar mensagem',
    finish: 'Execução finalizada'
}

function stepLabel(step: string): string {
    return STEP_LABELS[step] || step
}

function CollapsibleSection({
    title,
    icon,
    defaultOpen = false,
    badge,
    children
}: {
    title: string
    icon: React.ReactNode
    defaultOpen?: boolean
    badge?: string | number
    children: React.ReactNode
}) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div className="run-detail-section">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="run-detail-section-header"
            >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {icon}
                <span className="run-detail-section-title">{title}</span>
                {badge !== undefined && (
                    <span className="run-detail-section-badge">{badge}</span>
                )}
            </button>
            {open && <div className="run-detail-section-body">{children}</div>}
        </div>
    )
}

function formatStepDetail(detail: unknown): string | null {
    if (!detail || typeof detail !== 'object') return null
    const d = detail as Record<string, unknown>
    const parts: string[] = []
    for (const [k, v] of Object.entries(d)) {
        if (v === undefined || v === null) continue
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v)
        parts.push(`${k}: ${val}`)
    }
    return parts.length > 0 ? parts.join('\n') : null
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
    const [selectedRun, setSelectedRun] = useState<RunRow | null>(null)

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
    // Tempo-real agressivo quando há execução em curso (1s), moderado quando selecionado run aberto (2s), padrão 5s
    const refreshMs = hasRunningRuns
        ? 1000
        : selectedRun
          ? 2000
          : 5000

    useEffect(() => {
        if (!autoRefresh || !slug) return
        const id = setInterval(() => {
            // Sempre recarrega runs (para detectar novos em curso) e recarrega msgs se está nessa view
            void loadRuns()
            if (view === 'messages') void loadActivity()
        }, refreshMs)
        return () => clearInterval(id)
    }, [autoRefresh, slug, view, refreshMs, loadActivity, loadRuns, selectedRun])

    // Se um run está aberto no painel e ele ainda está rodando, atualiza os dados do próprio run
    useEffect(() => {
        if (!selectedRun) return
        // Encontrar o run atualizado na lista (pode ter mudado de running → success/error)
        const updated = runs.find(r => r.id === selectedRun.id)
        if (updated && (
            updated.status !== selectedRun.status ||
            updated.finished_at !== selectedRun.finished_at ||
            JSON.stringify(updated.meta) !== JSON.stringify(selectedRun.meta)
        )) {
            setSelectedRun(updated)
        }
    }, [runs, selectedRun])

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
                                {autoRefresh && (
                                    <>
                                        {' · '}
                                        {hasRunningRuns
                                            ? <span style={{ color: 'var(--orange)' }}>ao vivo 1s</span>
                                            : selectedRun
                                              ? 'cada 2s'
                                              : 'cada 5s'}
                                    </>
                                )}
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
                                        <tr key={r.id} onClick={() => setSelectedRun(r)} style={{ cursor: 'pointer' }}>
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

            {/* ── Run Detail Side Panel ── */}
            {selectedRun && (
                <div className="run-detail-overlay" onClick={e => { if (e.target === e.currentTarget) setSelectedRun(null) }}>
                    <div className="run-detail-panel">
                        <div className="run-detail-header">
                            <h3>Execução #{selectedRun.id.slice(0, 8)}</h3>
                            <button
                                className="btn btn-secondary btn-compact"
                                onClick={() => setSelectedRun(null)}
                                style={{ padding: '4px 8px' }}
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="run-detail-body">
                            {/* Meta info */}
                            <div className="run-detail-meta">
                                <div className="run-detail-meta-item">
                                    <div className="label">Estado</div>
                                    <div className="value">
                                        <span className={runStatusBadgeClass(selectedRun.status)}>
                                            {runStatusLabel(selectedRun.status)}
                                        </span>
                                    </div>
                                </div>
                                <div className="run-detail-meta-item">
                                    <div className="label">Duração</div>
                                    <div className="value">{formatRunDuration(selectedRun.started_at, selectedRun.finished_at, selectedRun.status)}</div>
                                </div>
                                <div className="run-detail-meta-item">
                                    <div className="label">Contato</div>
                                    <div className="value">{selectedRun.contact_name || selectedRun.contact_phone || '—'}</div>
                                </div>
                                <div className="run-detail-meta-item">
                                    <div className="label">Origem</div>
                                    <div className="value">{runSourceLabel(selectedRun.source)}</div>
                                </div>
                                <div className="run-detail-meta-item">
                                    <div className="label">Início</div>
                                    <div className="value" style={{ fontSize: 12 }}>
                                        {new Date(selectedRun.started_at).toLocaleString('pt-BR')}
                                    </div>
                                </div>
                                <div className="run-detail-meta-item">
                                    <div className="label">Fim</div>
                                    <div className="value" style={{ fontSize: 12 }}>
                                        {selectedRun.finished_at
                                            ? new Date(selectedRun.finished_at).toLocaleString('pt-BR')
                                            : 'Em andamento...'}
                                    </div>
                                </div>
                            </div>

                            {selectedRun.reason && (
                                <div style={{ marginBottom: 16, padding: '8px 12px', background: 'var(--surface-secondary)', borderRadius: 8, fontSize: 13 }}>
                                    <strong>Resultado:</strong> {selectedRun.reason}
                                </div>
                            )}

                            {selectedRun.error_message && (
                                <div style={{ marginBottom: 16, padding: '8px 12px', background: 'color-mix(in srgb, var(--red, #ef4444) 8%, transparent)', borderRadius: 8, fontSize: 13, color: 'var(--red, #ef4444)' }}>
                                    <strong>Erro:</strong> {selectedRun.error_message}
                                </div>
                            )}

                            {/* ── Dados ricos (Onda 1) ── */}
                            {selectedRun.meta?.extras && (
                                <>
                                    {/* Modelo & Tokens */}
                                    {(selectedRun.meta.extras.model || selectedRun.meta.extras.llm_usage) && (
                                        <div className="run-detail-tokens-grid">
                                            {selectedRun.meta.extras.provider && (
                                                <div className="run-detail-token-item">
                                                    <div className="label">Provedor</div>
                                                    <div className="value">{selectedRun.meta.extras.provider}</div>
                                                </div>
                                            )}
                                            {selectedRun.meta.extras.model && (
                                                <div className="run-detail-token-item">
                                                    <div className="label">Modelo</div>
                                                    <div className="value" style={{ fontSize: 12 }}>{selectedRun.meta.extras.model}</div>
                                                </div>
                                            )}
                                            {typeof selectedRun.meta.extras.temperature === 'number' && (
                                                <div className="run-detail-token-item">
                                                    <div className="label">Temp.</div>
                                                    <div className="value">{selectedRun.meta.extras.temperature}</div>
                                                </div>
                                            )}
                                            {selectedRun.meta.extras.llm_usage && (
                                                <>
                                                    <div className="run-detail-token-item">
                                                        <div className="label">Tokens entrada</div>
                                                        <div className="value">{selectedRun.meta.extras.llm_usage.prompt_tokens}</div>
                                                    </div>
                                                    <div className="run-detail-token-item">
                                                        <div className="label">Tokens saída</div>
                                                        <div className="value">{selectedRun.meta.extras.llm_usage.completion_tokens}</div>
                                                    </div>
                                                    <div className="run-detail-token-item run-detail-token-item--total">
                                                        <div className="label">Total</div>
                                                        <div className="value">{selectedRun.meta.extras.llm_usage.total_tokens}</div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {/* Tools chamadas */}
                                    {selectedRun.meta.extras.tools_called && selectedRun.meta.extras.tools_called.length > 0 && (
                                        <CollapsibleSection
                                            title="Ferramentas utilizadas"
                                            icon={<Wrench size={14} />}
                                            badge={selectedRun.meta.extras.tools_called.length}
                                            defaultOpen={true}
                                        >
                                            <div className="run-detail-tools-list">
                                                {selectedRun.meta.extras.tools_called.map((tool, i) => (
                                                    <span key={i} className="run-detail-tool-badge">{tool}</span>
                                                ))}
                                            </div>
                                        </CollapsibleSection>
                                    )}

                                    {/* Última mensagem do usuário */}
                                    {selectedRun.meta.extras.last_user_message && (
                                        <CollapsibleSection
                                            title="Mensagem do contato"
                                            icon={<User size={14} />}
                                            defaultOpen={true}
                                        >
                                            <div className="run-detail-message-block run-detail-message-block--user">
                                                {selectedRun.meta.extras.last_user_message}
                                            </div>
                                        </CollapsibleSection>
                                    )}

                                    {/* Resposta da IA */}
                                    {selectedRun.meta.extras.llm_response_full && (
                                        <CollapsibleSection
                                            title="Resposta da IA"
                                            icon={<Bot size={14} />}
                                            badge={`${selectedRun.meta.extras.llm_response_full.length} chars`}
                                            defaultOpen={true}
                                        >
                                            <div className="run-detail-message-block run-detail-message-block--ai">
                                                {selectedRun.meta.extras.llm_response_full}
                                            </div>
                                        </CollapsibleSection>
                                    )}

                                    {/* Chunks enviados */}
                                    {selectedRun.meta.extras.chunks_sent && selectedRun.meta.extras.chunks_sent.length > 0 && (
                                        <CollapsibleSection
                                            title="Mensagens enviadas"
                                            icon={<Send size={14} />}
                                            badge={selectedRun.meta.extras.chunks_sent.length}
                                        >
                                            {selectedRun.meta.extras.chunks_sent.map((chunk, i) => (
                                                <div key={i} className="run-detail-chunk">
                                                    <div className="run-detail-chunk-label">#{i + 1}</div>
                                                    <div className="run-detail-chunk-body">{chunk}</div>
                                                </div>
                                            ))}
                                        </CollapsibleSection>
                                    )}

                                    {/* Contexto da conversa (transcript) */}
                                    {selectedRun.meta.extras.context_transcript && (
                                        <CollapsibleSection
                                            title="Contexto enviado ao modelo"
                                            icon={<MessageSquare size={14} />}
                                            badge={`${selectedRun.meta.extras.context_transcript.length} chars`}
                                        >
                                            <pre className="run-detail-message-block run-detail-message-block--transcript">
                                                {selectedRun.meta.extras.context_transcript}
                                            </pre>
                                        </CollapsibleSection>
                                    )}

                                    {/* System Prompt */}
                                    {selectedRun.meta.extras.system_prompt && (
                                        <CollapsibleSection
                                            title="System Prompt configurado"
                                            icon={<Cpu size={14} />}
                                            badge={`${selectedRun.meta.extras.system_prompt.length} chars`}
                                        >
                                            <pre className="run-detail-message-block run-detail-message-block--system">
                                                {selectedRun.meta.extras.system_prompt}
                                            </pre>
                                        </CollapsibleSection>
                                    )}

                                    {/* Handoff */}
                                    {selectedRun.meta.extras.handoff?.triggered && (
                                        <div style={{ marginBottom: 16, padding: '10px 12px', background: 'color-mix(in srgb, var(--orange, #f59e0b) 10%, transparent)', borderRadius: 8, fontSize: 13, color: 'var(--orange, #f59e0b)' }}>
                                            <strong>🔄 Handoff acionado</strong>
                                            {selectedRun.meta.extras.handoff.reason && (
                                                <div style={{ marginTop: 4, fontSize: 12 }}>
                                                    Motivo: {selectedRun.meta.extras.handoff.reason}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Steps timeline */}
                            {selectedRun.meta?.steps && selectedRun.meta.steps.length > 0 ? (
                                <>
                                    <div className="run-steps-title">Pipeline de execução</div>
                                    <div className="run-steps-timeline">
                                        {selectedRun.meta.steps.map((s, i) => {
                                            const isError = s.step.includes('error') || s.step.includes('failed')
                                            const isFinish = s.step === 'finish'
                                            const detailStr = formatStepDetail(s.detail)
                                            return (
                                                <div key={i} className={`run-step ${isError ? 'run-step--error' : ''} ${isFinish ? 'run-step--finish' : ''}`}>
                                                    <div className="run-step-dot" />
                                                    <div className="run-step-header">
                                                        <span className="run-step-name">{stepLabel(s.step)}</span>
                                                        <span className="run-step-time">+{formatMsDuration(s.ts)}</span>
                                                    </div>
                                                    {detailStr && (
                                                        <div className="run-step-detail">{detailStr}</div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </>
                            ) : (
                                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0', fontSize: 13 }}>
                                    <ListTree size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
                                    <p>Detalhes não disponíveis para esta execução.</p>
                                    <p style={{ fontSize: 12 }}>Execuções mais recentes incluem o pipeline completo.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
