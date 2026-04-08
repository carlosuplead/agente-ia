'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDashboard } from './dashboard-context'
import {
    BarChart3,
    Users,
    MessageCircle,
    ArrowRightLeft,
    Clock,
    Bot,
    TrendingUp,
    UserPlus,
    Send
} from 'lucide-react'
import type { ConversationStatsPayload } from '@/app/api/messages/conversation-stats/route'
import type { MessageStatsPayload } from '@/lib/dashboard/message-stats'

function StatCard({
    icon: Icon,
    label,
    value,
    subtitle,
    color
}: {
    icon: typeof BarChart3
    label: string
    value: string | number
    subtitle?: string
    color: string
}) {
    return (
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div
                    className="card-header-icon"
                    style={{ '--icon-bg': `${color}18`, '--icon-color': color } as React.CSSProperties}
                >
                    <Icon size={16} />
                </div>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {value}
            </div>
            {subtitle && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{subtitle}</div>
            )}
        </div>
    )
}

function MiniBar({ data, maxVal, color }: { data: number[]; maxVal: number; color: string }) {
    const h = 48
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: h }}>
            {data.map((v, i) => {
                const barH = maxVal > 0 ? Math.max(2, (v / maxVal) * h) : 2
                return (
                    <div
                        key={i}
                        style={{
                            width: `${100 / data.length}%`,
                            maxWidth: 12,
                            height: barH,
                            background: color,
                            borderRadius: '2px 2px 0 0',
                            opacity: 0.8
                        }}
                    />
                )
            })}
        </div>
    )
}

export function RelatoriosTab() {
    const d = useDashboard()
    const slug = d.selectedSlug
    const [days, setDays] = useState(30)
    const [convStats, setConvStats] = useState<ConversationStatsPayload | null>(null)
    const [msgStats, setMsgStats] = useState<MessageStatsPayload | null>(null)
    const [loading, setLoading] = useState(false)

    const loadStats = useCallback(async () => {
        if (!slug) return
        setLoading(true)
        try {
            const [convRes, msgRes] = await Promise.all([
                fetch(`/api/messages/conversation-stats?workspace_slug=${encodeURIComponent(slug)}&days=${days}`, {
                    credentials: 'include'
                }),
                fetch(`/api/messages/stats?workspace_slug=${encodeURIComponent(slug)}&days=${days}`, {
                    credentials: 'include'
                })
            ])
            const convData = await convRes.json().catch(() => null)
            const msgData = await msgRes.json().catch(() => null)
            if (convData && !convData.error) setConvStats(convData as ConversationStatsPayload)
            if (msgData && !msgData.error) setMsgStats(msgData as MessageStatsPayload)
        } finally {
            setLoading(false)
        }
    }, [slug, days])

    useEffect(() => {
        void loadStats()
    }, [loadStats])

    if (!slug) {
        return (
            <div className="page-header">
                <h2>Relatorios</h2>
                <p style={{ color: 'var(--text-secondary)' }}>Selecione um workspace na sidebar.</p>
            </div>
        )
    }

    const totalMsgs = msgStats
        ? msgStats.totals.ai_messages + msgStats.totals.contact_messages + msgStats.totals.team_messages
        : 0

    const aiRate = convStats && convStats.total_conversations > 0
        ? Math.round(((convStats.total_conversations - convStats.handed_off_conversations) / convStats.total_conversations) * 100)
        : 0

    return (
        <>
            <div className="page-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                        <h2>Relatorios</h2>
                        <p>Metricas e desempenho do agente IA</p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {[7, 14, 30, 60].map(n => (
                            <button
                                key={n}
                                type="button"
                                className={`btn ${days === n ? 'btn-primary' : 'btn-secondary'} btn-compact`}
                                onClick={() => setDays(n)}
                            >
                                {n}d
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {loading && !convStats && (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    Carregando dados...
                </div>
            )}

            {/* KPI Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 12,
                marginBottom: 20
            }}>
                <StatCard
                    icon={MessageCircle}
                    label="Total de Mensagens"
                    value={totalMsgs.toLocaleString('pt-BR')}
                    subtitle={`${msgStats?.totals.ai_messages ?? 0} IA / ${msgStats?.totals.contact_messages ?? 0} clientes`}
                    color="#2563eb"
                />
                <StatCard
                    icon={Users}
                    label="Contatos"
                    value={convStats?.total_contacts ?? 0}
                    subtitle={`+${convStats?.new_contacts_period ?? 0} novos no periodo`}
                    color="#059669"
                />
                <StatCard
                    icon={Bot}
                    label="Conversas IA"
                    value={convStats?.total_conversations ?? 0}
                    subtitle={`${convStats?.active_conversations ?? 0} ativas agora`}
                    color="#7c3aed"
                />
                <StatCard
                    icon={ArrowRightLeft}
                    label="Handoffs"
                    value={convStats?.handed_off_conversations ?? 0}
                    subtitle="Transferidas para humano"
                    color="#ea580c"
                />
                <StatCard
                    icon={TrendingUp}
                    label="Resolucao pela IA"
                    value={`${aiRate}%`}
                    subtitle={`${convStats?.ai_resolved_conversations ?? 0} resolvidas sem humano`}
                    color="#0891b2"
                />
                <StatCard
                    icon={Clock}
                    label="Msgs por Conversa"
                    value={convStats?.avg_messages_per_conversation ?? 0}
                    subtitle="Media de mensagens"
                    color="#d97706"
                />
                <StatCard
                    icon={Send}
                    label="Follow-ups Enviados"
                    value={convStats?.followups_sent ?? 0}
                    subtitle="Mensagens de follow-up"
                    color="#dc2626"
                />
                <StatCard
                    icon={UserPlus}
                    label="Contatos Unicos"
                    value={msgStats?.totals.unique_contacts ?? 0}
                    subtitle={`No periodo de ${days} dias`}
                    color="#4f46e5"
                />
            </div>

            {/* Activity Chart */}
            {msgStats && msgStats.daily.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                        <div
                            className="card-header-icon"
                            style={{ '--icon-bg': '#2563eb18', '--icon-color': '#2563eb' } as React.CSSProperties}
                        >
                            <BarChart3 size={16} />
                        </div>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>Atividade Diaria — Mensagens</span>
                    </div>
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>IA</div>
                            <MiniBar
                                data={msgStats.daily.map(d => d.ai)}
                                maxVal={Math.max(...msgStats.daily.map(d => Math.max(d.ai, d.contact, d.team)), 1)}
                                color="#2563eb"
                            />
                        </div>
                        <div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Clientes</div>
                            <MiniBar
                                data={msgStats.daily.map(d => d.contact)}
                                maxVal={Math.max(...msgStats.daily.map(d => Math.max(d.ai, d.contact, d.team)), 1)}
                                color="#059669"
                            />
                        </div>
                        <div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Equipa</div>
                            <MiniBar
                                data={msgStats.daily.map(d => d.team)}
                                maxVal={Math.max(...msgStats.daily.map(d => Math.max(d.ai, d.contact, d.team)), 1)}
                                color="#ea580c"
                            />
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8, justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {msgStats.daily[0]?.date ?? ''}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {msgStats.daily[msgStats.daily.length - 1]?.date ?? ''}
                        </span>
                    </div>
                </div>
            )}

            {/* Conversations Chart */}
            {convStats && convStats.daily.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                        <div
                            className="card-header-icon"
                            style={{ '--icon-bg': '#7c3aed18', '--icon-color': '#7c3aed' } as React.CSSProperties}
                        >
                            <BarChart3 size={16} />
                        </div>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>Atividade Diaria — Conversas</span>
                    </div>
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Conversas</div>
                            <MiniBar
                                data={convStats.daily.map(d => d.conversations)}
                                maxVal={Math.max(...convStats.daily.map(d => Math.max(d.conversations, d.handoffs, d.new_contacts)), 1)}
                                color="#7c3aed"
                            />
                        </div>
                        <div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Handoffs</div>
                            <MiniBar
                                data={convStats.daily.map(d => d.handoffs)}
                                maxVal={Math.max(...convStats.daily.map(d => Math.max(d.conversations, d.handoffs, d.new_contacts)), 1)}
                                color="#ea580c"
                            />
                        </div>
                        <div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Novos Contatos</div>
                            <MiniBar
                                data={convStats.daily.map(d => d.new_contacts)}
                                maxVal={Math.max(...convStats.daily.map(d => Math.max(d.conversations, d.handoffs, d.new_contacts)), 1)}
                                color="#059669"
                            />
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8, justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {convStats.daily[0]?.date ?? ''}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {convStats.daily[convStats.daily.length - 1]?.date ?? ''}
                        </span>
                    </div>
                </div>
            )}

            {/* Previous period comparison */}
            {msgStats && (
                <div className="card" style={{ padding: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <div
                            className="card-header-icon"
                            style={{ '--icon-bg': '#05966918', '--icon-color': '#059669' } as React.CSSProperties}
                        >
                            <TrendingUp size={16} />
                        </div>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>Comparativo com Periodo Anterior</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>Msgs IA (periodo atual)</div>
                            <div style={{ fontSize: 20, fontWeight: 700 }}>{msgStats.totals.ai_messages}</div>
                            {msgStats.previous_totals.ai_messages > 0 && (
                                <div style={{
                                    fontSize: 12,
                                    color: msgStats.totals.ai_messages >= msgStats.previous_totals.ai_messages ? '#059669' : '#dc2626'
                                }}>
                                    {msgStats.totals.ai_messages >= msgStats.previous_totals.ai_messages ? '+' : ''}
                                    {Math.round(((msgStats.totals.ai_messages - msgStats.previous_totals.ai_messages) / msgStats.previous_totals.ai_messages) * 100)}% vs anterior
                                </div>
                            )}
                        </div>
                        <div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>Msgs Clientes (periodo atual)</div>
                            <div style={{ fontSize: 20, fontWeight: 700 }}>{msgStats.totals.contact_messages}</div>
                            {msgStats.previous_totals.contact_messages > 0 && (
                                <div style={{
                                    fontSize: 12,
                                    color: msgStats.totals.contact_messages >= msgStats.previous_totals.contact_messages ? '#059669' : '#dc2626'
                                }}>
                                    {msgStats.totals.contact_messages >= msgStats.previous_totals.contact_messages ? '+' : ''}
                                    {Math.round(((msgStats.totals.contact_messages - msgStats.previous_totals.contact_messages) / msgStats.previous_totals.contact_messages) * 100)}% vs anterior
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
