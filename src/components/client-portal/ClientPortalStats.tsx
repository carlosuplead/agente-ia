'use client'

import type { MessageStatsPayload } from '@/lib/dashboard/message-stats'

function pctVsPrevious(current: number, previous: number): string | null {
    if (previous <= 0) {
        if (current <= 0) return null
        return 'Primeira atividade neste intervalo'
    }
    const raw = Math.round(((current - previous) / previous) * 100)
    const sign = raw > 0 ? '+' : ''
    return `${sign}${raw}% vs. período anterior`
}

function shortDayLabel(isoDate: string): string {
    const d = new Date(`${isoDate}T12:00:00Z`)
    return d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric' })
}

type Props = {
    stats: MessageStatsPayload | null
    statsLoadFailed: boolean
    statsDays: number
    onStatsDaysChange: (d: 7 | 14 | 30) => void
    onRefresh: () => void
    busy: boolean
}

export function ClientPortalStats({
    stats,
    statsLoadFailed,
    statsDays,
    onStatsDaysChange,
    onRefresh,
    busy
}: Props) {
    const maxDay = Math.max(
        1,
        ...(stats?.daily.map(day => day.ai + day.contact + day.team) ?? [1])
    )

    return (
        <div className="card client-portal-stats">
            <div className="card-header client-portal-stats-header">
                <div>
                    <span className="card-title">Atividade da IA no WhatsApp</span>
                    <p className="client-portal-stats-sub">
                        Resumo anónimo: contagens de mensagens guardadas no seu espaço (não inclui conversas
                        pessoais fora desta ligação).
                    </p>
                </div>
                <div className="client-portal-stats-actions">
                    <select
                        className="client-portal-select"
                        value={statsDays}
                        onChange={e => onStatsDaysChange(Number(e.target.value) as 7 | 14 | 30)}
                        aria-label="Período das estatísticas"
                    >
                        <option value={7}>Últimos 7 dias</option>
                        <option value={14}>Últimos 14 dias</option>
                        <option value={30}>Últimos 30 dias</option>
                    </select>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={onRefresh}>
                        Atualizar
                    </button>
                </div>
            </div>

            {!stats && statsLoadFailed && (
                <p className="client-portal-muted">
                    Não foi possível carregar as estatísticas. Tenta &quot;Atualizar&quot; ou aguarda alguns
                    instantes.
                </p>
            )}
            {!stats && !statsLoadFailed && (
                <p className="client-portal-muted">A carregar estatísticas…</p>
            )}

            {stats && (
                <>
                    <div className="stat-grid">
                        <div className="stat-card">
                            <span className="stat-card-label">Respostas do assistente</span>
                            <span className="stat-card-value">{stats.totals.ai_messages}</span>
                            <span className="stat-card-hint">
                                {pctVsPrevious(
                                    stats.totals.ai_messages,
                                    stats.previous_totals.ai_messages
                                ) ?? '—'}
                            </span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-card-label">Mensagens dos clientes</span>
                            <span className="stat-card-value">{stats.totals.contact_messages}</span>
                            <span className="stat-card-hint">
                                {pctVsPrevious(
                                    stats.totals.contact_messages,
                                    stats.previous_totals.contact_messages
                                ) ?? '—'}
                            </span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-card-label">Contactos com atividade</span>
                            <span className="stat-card-value">{stats.totals.unique_contacts}</span>
                            <span className="stat-card-hint">Pessoas diferentes no período</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-card-label">Mensagens da equipa (WhatsApp)</span>
                            <span className="stat-card-value">{stats.totals.team_messages}</span>
                            <span className="stat-card-hint">Enviadas a partir do número ligado</span>
                        </div>
                    </div>

                    <div className="client-portal-agent-pill">
                        <span className="client-portal-agent-pill-label">Agente automático</span>
                        <span
                            className={
                                stats.agent_enabled === false
                                    ? 'status-badge disconnected'
                                    : 'status-badge connected'
                            }
                        >
                            <span className="status-dot" aria-hidden="true" />
                            {stats.agent_enabled === null
                                ? '—'
                                : stats.agent_enabled
                                  ? 'Ativo'
                                  : 'Desativado'}
                        </span>
                    </div>

                    <div className="client-portal-chart-wrap">
                        <p className="client-portal-chart-title">Volume por dia (IA · clientes · equipa)</p>
                        <div className="client-portal-chart" role="img" aria-label="Gráfico de mensagens por dia">
                            {stats.daily.map(day => {
                                const total = day.ai + day.contact + day.team
                                const hPct = Math.round((total / maxDay) * 100)
                                const aiPct = total ? day.ai / total : 0
                                const contactPct = total ? day.contact / total : 0
                                const teamPct = total ? day.team / total : 0
                                return (
                                    <div key={day.date} className="client-portal-chart-col">
                                        <div
                                            className="client-portal-chart-bar"
                                            style={{ height: `${Math.max(hPct, total ? 8 : 4)}%` }}
                                            title={`${day.date}: ${total} mensagens`}
                                        >
                                            {total > 0 && (
                                                <div className="client-portal-chart-stack">
                                                    <div
                                                        className="client-portal-chart-seg client-portal-chart-seg--contact"
                                                        style={{ flexGrow: contactPct || 0.001 }}
                                                    />
                                                    <div
                                                        className="client-portal-chart-seg client-portal-chart-seg--team"
                                                        style={{ flexGrow: teamPct || 0.001 }}
                                                    />
                                                    <div
                                                        className="client-portal-chart-seg client-portal-chart-seg--ai"
                                                        style={{ flexGrow: aiPct || 0.001 }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        <span className="client-portal-chart-x">{shortDayLabel(day.date)}</span>
                                    </div>
                                )
                            })}
                        </div>
                        <div className="client-portal-chart-legend">
                            <span>
                                <i className="client-portal-legend-dot client-portal-legend-dot--ai" /> IA
                            </span>
                            <span>
                                <i className="client-portal-legend-dot client-portal-legend-dot--contact" />{' '}
                                Clientes
                            </span>
                            <span>
                                <i className="client-portal-legend-dot client-portal-legend-dot--team" /> Equipa
                            </span>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
