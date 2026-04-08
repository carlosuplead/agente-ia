'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { Smartphone } from 'lucide-react'
import { ClientPortalStats } from '@/components/client-portal/ClientPortalStats'
import { TokenUsageSection } from '@/components/dashboard/TokenUsageSection'
import { formatRelativeTime } from '@/lib/dashboard/format-relative-time'
import { useDashboard } from './dashboard-context'
import { OfficialApiSetupSection } from './OfficialApiSetupSection'

function MetaTokenAgeNotice({ obtainedAt }: { obtainedAt: string }) {
    const days = useMemo(() => {
        const t = new Date(obtainedAt).getTime()
        if (!Number.isFinite(t)) return 0
        return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000))
    }, [obtainedAt])
    if (days < 50) return null
    return (
        <div className="card alert-card" role="status" style={{ marginBottom: 12 }}>
            <p className="alert-card-text" style={{ margin: 0 }}>
                O token Meta foi obtido há {days} dias. Tokens expiram por volta de 60 dias — atualize as credenciais antes de expirar.
            </p>
        </div>
    )
}

export function WhatsAppTab() {
    const d = useDashboard()

    const refreshWhatsAppData = useCallback(() => {
        if (!d.selectedSlug) return
        void d.loadInstance(d.selectedSlug, { syncUazapi: true })
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

    useEffect(() => {
        if (!d.selectedSlug || !d.instance || d.instance.provider === 'official') return
        if (d.instance.status !== 'connecting') return
        const slug = d.selectedSlug
        const id = window.setInterval(() => {
            void d.loadInstance(slug, { syncUazapi: true })
        }, 4000)
        return () => window.clearInterval(id)
    }, [d.selectedSlug, d.instance?.provider, d.instance?.status, d.loadInstance])

    const waStatusClass =
        d.instance?.status === 'connected'
            ? 'connected'
            : d.instance?.status === 'connecting'
              ? 'connecting'
              : 'disconnected'

    const isOfficial = d.instance?.provider === 'official'

    return (
        <>
            <div className="page-header">
                <h2>WhatsApp — {d.selectedWs?.name || '—'}</h2>
                <p>Conexão e mensagens do seu espaço de trabalho</p>
            </div>

            {!d.selectedSlug && (
                <p style={{ color: 'var(--text-secondary)' }}>Selecione um workspace na barra lateral.</p>
            )}

            {d.selectedSlug && (
                <>
                    {/* ── Conexão por QR Code (Uazapi) ── */}
                    <div className="card">
                        <div className="card-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <Smartphone size={20} />
                                <span className="card-title">
                                    {isOfficial ? 'WhatsApp (API Oficial)' : 'WhatsApp (QR Code)'}
                                </span>
                            </div>
                            <span className={`status-badge ${waStatusClass}`}>
                                <span className="status-dot" aria-hidden="true" />
                                {d.instance?.status === 'connected' ? 'Conectado' :
                                 d.instance?.status === 'connecting' ? 'Conectando' :
                                 !d.instance ? 'Sem instância' : 'Desconectado'}
                            </span>
                        </div>

                        {d.instance?.phone_number && (
                            <p style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
                                {d.instance.phone_number}
                            </p>
                        )}

                        {d.instance?.provider === 'official' && d.instance?.meta_token_obtained_at && (
                            <MetaTokenAgeNotice obtainedAt={d.instance.meta_token_obtained_at} />
                        )}

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {!d.instance && (
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={d.busy}
                                    onClick={d.provisionInstance}
                                >
                                    Conectar WhatsApp
                                </button>
                            )}
                            {d.instance && d.instance.status !== 'connected' && !isOfficial && (
                                <button
                                    type="button"
                                    className="btn btn-primary"
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
                                onClick={d.refreshInstanceWithFeedback}
                            >
                                Atualizar
                            </button>
                            {d.instance && !isOfficial && (
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    disabled={d.busy}
                                    onClick={() => d.removeUazapiInstance()}
                                    style={{ borderColor: 'rgba(255, 107, 107, 0.35)', color: 'var(--red)' }}
                                >
                                    Desconectar
                                </button>
                            )}
                        </div>

                        {/* QR Code */}
                        {d.qrSrc && (
                            <div style={{ marginTop: 20, padding: 20, background: 'var(--surface-secondary)', borderRadius: 12, textAlign: 'center' }}>
                                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                                    Escaneie o QR Code com o WhatsApp
                                </p>
                                <img
                                    src={d.qrSrc}
                                    alt="QR Code WhatsApp"
                                    style={{ maxWidth: 260, borderRadius: 8, margin: '0 auto' }}
                                />
                                {d.qrPayload?.pairingCode && (
                                    <p style={{ marginTop: 12, fontSize: 15 }}>
                                        Ou use o código: <strong style={{ letterSpacing: '0.08em', fontSize: 18 }}>{d.qrPayload.pairingCode}</strong>
                                    </p>
                                )}
                            </div>
                        )}

                        {d.metaPendingPhones.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                                <p style={{ fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}>
                                    Escolha o número oficial:
                                </p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {d.metaPendingPhones.map(p => (
                                        <button
                                            key={p.phone_number_id}
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => d.completeMetaPhonePick(p.phone_number_id)}
                                        >
                                            {p.display_phone_number || p.verified_name || p.phone_number_id}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── API Oficial WABA (separado, limpo) ── */}
                    <OfficialApiSetupSection />

                    {/* ── Estatísticas ── */}
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

                    {/* ── Mensagens recentes ── */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Mensagens recentes</span>
                            <button
                                type="button"
                                className="btn btn-secondary btn-compact"
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
                                <p style={{ color: 'var(--text-secondary)', fontSize: 14, padding: '16px 0' }}>
                                    Sem mensagens recentes.
                                </p>
                            )}
                        </div>
                    </div>
                </>
            )}
        </>
    )
}
