'use client'

import { useCallback } from 'react'
import { ClientPortalStats } from '@/components/client-portal/ClientPortalStats'
import { TokenUsageSection } from '@/components/dashboard/TokenUsageSection'
import { formatRelativeTime } from '@/lib/dashboard/format-relative-time'
import { useDashboard } from './dashboard-context'

export function WhatsAppTab() {
    const d = useDashboard()

    const refreshWhatsAppData = useCallback(() => {
        if (!d.selectedSlug) return
        void d.loadInstance(d.selectedSlug)
        void d.loadMessages(d.selectedSlug)
        void d.loadStats(d.selectedSlug, d.statsDays)
        void d.loadTokenUsage(d.selectedSlug, d.tokenUsageDays)
    }, [
        d.selectedSlug,
        d.statsDays,
        d.tokenUsageDays,
        d.loadInstance,
        d.loadMessages,
        d.loadStats,
        d.loadTokenUsage
    ])

    return (
        <>
            <div className="page-header">
                <h2>WhatsApp — {d.selectedWs?.name || '—'}</h2>
                <p>Ligação e mensagens recentes do schema {d.selectedSlug || '—'}</p>
            </div>

            {!d.selectedSlug && (
                <p style={{ color: 'var(--text-secondary)' }}>Selecione um workspace na grelha ou no menu.</p>
            )}

            {d.selectedSlug && (
                <>
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Estado</span>
                            <span
                                className={`status-badge ${d.instance?.status === 'connected' ? 'connected' : 'disconnected'}`}
                            >
                                <span className="status-dot" aria-hidden="true" />
                                {d.instance?.status || 'sem instância'}
                            </span>
                        </div>
                        {d.instance?.phone_number && (
                            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
                                {d.instance.phone_number}
                            </p>
                        )}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {!d.instance && (
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={d.busy}
                                    onClick={d.provisionInstance}
                                >
                                    Criar instância (Uazapi)
                                </button>
                            )}
                            {d.instance && d.instance.status !== 'connected' && (
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    disabled={d.busy}
                                    onClick={d.connectWhatsapp}
                                >
                                    Gerar QR Code
                                </button>
                            )}
                            <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={d.busy || !d.instance}
                                onClick={() => d.selectedSlug && d.loadInstance(d.selectedSlug)}
                            >
                                Atualizar estado
                            </button>
                        </div>
                        {d.qrSrc && (
                            <div style={{ marginTop: 16 }}>
                                <img src={d.qrSrc} alt="QR Code para ligar o WhatsApp" style={{ maxWidth: 280, borderRadius: 8 }} />
                                {d.qrPayload?.pairingCode && (
                                    <p style={{ marginTop: 8, fontSize: 14 }}>
                                        Código: <strong>{d.qrPayload.pairingCode}</strong>
                                    </p>
                                )}
                            </div>
                        )}
                        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
                            Webhook (Uazapi):{' '}
                            <code style={{ wordBreak: 'break-all' }}>
                                {typeof window !== 'undefined' ? window.location.origin : ''}
                                /api/whatsapp/webhook?token=INSTANCE_TOKEN
                            </code>
                        </p>
                    </div>

                    <ClientPortalStats
                        stats={d.stats}
                        statsLoadFailed={d.statsLoadFailed}
                        statsDays={d.statsDays}
                        onStatsDaysChange={d.setStatsDays}
                        onRefresh={refreshWhatsAppData}
                        busy={d.busy}
                    />

                    <TokenUsageSection
                        tokenUsage={d.tokenUsage}
                        tokenUsageLoadFailed={d.tokenUsageLoadFailed}
                        tokenUsageForbidden={d.tokenUsageForbidden}
                        tokenUsageDays={d.tokenUsageDays}
                        onTokenUsageDaysChange={d.setTokenUsageDays}
                        onRefresh={refreshWhatsAppData}
                        busy={d.busy}
                    />

                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Mensagens recentes</span>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: 12 }}
                                onClick={() => d.selectedSlug && d.loadMessages(d.selectedSlug)}
                            >
                                Atualizar
                            </button>
                        </div>
                        <div className="message-list">
                            {d.messages.map(msg => (
                                <div key={msg.id} className="message-item">
                                    <div className="message-avatar" aria-hidden="true">
                                        {msg.sender_type[0]?.toUpperCase()}
                                    </div>
                                    <div className="message-content">
                                        <div className="message-name">{msg.sender_type}</div>
                                        <div className="message-text message-text--multiline">{msg.body || '[vazio]'}</div>
                                    </div>
                                    <span className="message-time" title={new Date(msg.created_at).toLocaleString()}>
                                        <span className="message-time-relative">{formatRelativeTime(msg.created_at)}</span>
                                        <span className="message-time-full">{new Date(msg.created_at).toLocaleString()}</span>
                                    </span>
                                </div>
                            ))}
                            {d.messages.length === 0 && (
                                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Sem mensagens.</p>
                            )}
                        </div>
                    </div>
                </>
            )}
        </>
    )
}
