'use client'

import type { TokenUsagePayload } from '@/lib/dashboard/token-usage'

function shortDayLabel(isoDate: string): string {
    const d = new Date(`${isoDate}T12:00:00Z`)
    return d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric' })
}

function fmtTokens(n: number): string {
    return new Intl.NumberFormat('pt-PT').format(Math.round(n))
}

type Props = {
    tokenUsage: TokenUsagePayload | null
    tokenUsageLoadFailed: boolean
    tokenUsageForbidden: boolean
    tokenUsageDays: number
    onTokenUsageDaysChange: (d: 7 | 14 | 30 | 90) => void
    onRefresh: () => void
    busy: boolean
}

export function TokenUsageSection({
    tokenUsage,
    tokenUsageLoadFailed,
    tokenUsageForbidden,
    tokenUsageDays,
    onTokenUsageDaysChange,
    onRefresh,
    busy
}: Props) {
    if (tokenUsageForbidden) {
        return null
    }

    const maxDay = Math.max(1, ...(tokenUsage?.by_day.map(d => d.total_tokens) ?? [1]))

    return (
        <div className="card client-portal-stats">
            <div className="card-header client-portal-stats-header">
                <div>
                    <span className="card-title">Uso de tokens (LLM)</span>
                    <p className="client-portal-stats-sub">
                        Contagem reportada pelas APIs OpenAI / Google (por turno de resposta da IA). Apenas para a
                        equipa interna; não inclui custos ElevenLabs ou outros serviços.
                    </p>
                </div>
                <div className="client-portal-stats-actions">
                    <select
                        className="client-portal-select"
                        value={tokenUsageDays}
                        onChange={e => onTokenUsageDaysChange(Number(e.target.value) as 7 | 14 | 30 | 90)}
                        aria-label="Período de tokens"
                    >
                        <option value={7}>Últimos 7 dias</option>
                        <option value={14}>Últimos 14 dias</option>
                        <option value={30}>Últimos 30 dias</option>
                        <option value={90}>Últimos 90 dias</option>
                    </select>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={onRefresh}>
                        Atualizar
                    </button>
                </div>
            </div>

            {tokenUsageLoadFailed && (
                <p className="client-portal-muted">
                    Não foi possível carregar o uso de tokens. Confirma que a migração da base inclui a tabela
                    llm_usage ou tenta &quot;Atualizar&quot;.
                </p>
            )}

            {!tokenUsage && !tokenUsageLoadFailed && (
                <p className="client-portal-muted">A carregar uso de tokens…</p>
            )}

            {tokenUsage && (
                <>
                    <div className="stat-grid">
                        <div className="stat-card">
                            <span className="stat-card-label">Total de tokens (período)</span>
                            <span className="stat-card-value">{fmtTokens(tokenUsage.grand_total_tokens)}</span>
                            <span className="stat-card-hint">Soma de todos os modelos</span>
                        </div>
                    </div>

                    <div className="client-portal-chart-wrap" style={{ marginTop: 16 }}>
                        <p className="client-portal-chart-title">Tokens por dia (todos os modelos)</p>
                        <div className="client-portal-chart" role="img" aria-label="Gráfico de tokens por dia">
                            {tokenUsage.by_day.map(day => {
                                const total = day.total_tokens
                                const hPct = Math.round((total / maxDay) * 100)
                                return (
                                    <div key={day.date} className="client-portal-chart-col">
                                        <div
                                            className="client-portal-chart-bar"
                                            style={{ height: `${Math.max(hPct, total ? 8 : 4)}%` }}
                                            title={`${day.date}: ${fmtTokens(total)} tokens`}
                                        >
                                            {total > 0 && (
                                                <div className="client-portal-chart-stack">
                                                    <div
                                                        className="client-portal-chart-seg client-portal-chart-seg--ai"
                                                        style={{ flexGrow: 1 }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        <span className="client-portal-chart-x">{shortDayLabel(day.date)}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    <div style={{ marginTop: 20 }}>
                        <p className="client-portal-chart-title" style={{ marginBottom: 8 }}>
                            Por modelo
                        </p>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="token-usage-table">
                                <thead>
                                    <tr>
                                        <th>Fornecedor</th>
                                        <th>Modelo</th>
                                        <th className="token-usage-table-num">Prompt</th>
                                        <th className="token-usage-table-num">Conclusão</th>
                                        <th className="token-usage-table-num">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tokenUsage.by_model.length === 0 && (
                                        <tr>
                                            <td colSpan={5} style={{ color: 'var(--text-secondary)' }}>
                                                Sem registos de tokens neste período.
                                            </td>
                                        </tr>
                                    )}
                                    {tokenUsage.by_model.map(row => (
                                        <tr key={`${row.provider}-${row.model}`}>
                                            <td>{row.provider}</td>
                                            <td>
                                                <code style={{ fontSize: 13 }}>{row.model}</code>
                                            </td>
                                            <td className="token-usage-table-num">{fmtTokens(row.prompt_tokens)}</td>
                                            <td className="token-usage-table-num">
                                                {fmtTokens(row.completion_tokens)}
                                            </td>
                                            <td className="token-usage-table-num">
                                                <strong>{fmtTokens(row.total_tokens)}</strong>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div style={{ marginTop: 20 }}>
                        <p className="client-portal-chart-title" style={{ marginBottom: 8 }}>
                            Totais por mês (no período)
                        </p>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="token-usage-table">
                                <thead>
                                    <tr>
                                        <th>Mês</th>
                                        <th className="token-usage-table-num">Total</th>
                                        <th>Por modelo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tokenUsage.by_month.filter(m => m.total_tokens > 0).length === 0 && (
                                        <tr>
                                            <td colSpan={3} style={{ color: 'var(--text-secondary)' }}>
                                                Sem dados.
                                            </td>
                                        </tr>
                                    )}
                                    {tokenUsage.by_month
                                        .filter(m => m.total_tokens > 0)
                                        .map(m => (
                                            <tr key={m.month}>
                                                <td>{m.month}</td>
                                                <td className="token-usage-table-num">
                                                    <strong>{fmtTokens(m.total_tokens)}</strong>
                                                </td>
                                                <td style={{ fontSize: 13 }}>
                                                    {Object.entries(m.by_model)
                                                        .filter(([, v]) => v > 0)
                                                        .map(([model, v]) => `${model}: ${fmtTokens(v)}`)
                                                        .join(' · ') || '—'}
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div style={{ marginTop: 20 }}>
                        <p className="client-portal-chart-title" style={{ marginBottom: 8 }}>
                            Por conversa (contacto)
                        </p>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="token-usage-table">
                                <thead>
                                    <tr>
                                        <th>Contacto</th>
                                        <th>Telefone</th>
                                        <th className="token-usage-table-num">Tokens</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tokenUsage.by_conversation.length === 0 && (
                                        <tr>
                                            <td colSpan={3} style={{ color: 'var(--text-secondary)' }}>
                                                Sem conversas com tokens neste período.
                                            </td>
                                        </tr>
                                    )}
                                    {tokenUsage.by_conversation.map(row => (
                                        <tr key={row.ai_conversation_id}>
                                            <td>{row.contact_name || '—'}</td>
                                            <td>
                                                <code style={{ fontSize: 13 }}>{row.contact_phone || '—'}</code>
                                            </td>
                                            <td className="token-usage-table-num">
                                                <strong>{fmtTokens(row.total_tokens)}</strong>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
