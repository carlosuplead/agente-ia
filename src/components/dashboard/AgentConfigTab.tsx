'use client'

import { useEffect } from 'react'
import {
    MODEL_CUSTOM,
    modelSelectValue,
    presetsForProvider
} from '@/lib/dashboard/model-presets'
import { useDashboard } from './dashboard-context'

function FieldError({ id, message }: { id?: string; message?: string | undefined }) {
    if (!message) return null
    return (
        <p id={id} className="field-error" role="alert">
            {message}
        </p>
    )
}

export function AgentConfigTab() {
    const d = useDashboard()
    const err = d.cfgFieldErrors

    const { selectedSlug, googleCalendar, loadGoogleCalendarCalendars } = d
    useEffect(() => {
        if (!selectedSlug || !googleCalendar?.connected) return
        void loadGoogleCalendarCalendars(selectedSlug)
    }, [selectedSlug, googleCalendar?.connected, loadGoogleCalendarCalendars])
    const presets = presetsForProvider(d.cfgProvider) as readonly string[]
    const modelSel = modelSelectValue(d.cfgProvider, d.cfgModel)

    return (
        <>
            <div className="page-header">
                <div className="page-header-row">
                    <div>
                        <h2>Agente IA — {d.selectedWs?.name || '—'}</h2>
                        <p>Configuração no schema {d.selectedSlug || '—'}</p>
                        {d.isConfigDirty && (
                            <p className="unsaved-hint" role="status">
                                Alterações por guardar
                            </p>
                        )}
                    </div>
                    <div className="page-header-actions">
                        <button
                            type="button"
                            className="btn btn-primary"
                            disabled={d.busy || !d.selectedSlug}
                            onClick={d.saveAiConfig}
                        >
                            {d.busy ? 'A guardar…' : 'Guardar'}
                        </button>
                    </div>
                </div>
            </div>

            {!d.selectedSlug ? (
                <p style={{ color: 'var(--text-secondary)' }}>Escolha um workspace primeiro.</p>
            ) : !d.aiConfig ? (
                <p className="config-loading" role="status">
                    <span className="config-loading-spinner" aria-hidden="true" />
                    A carregar configuração…
                </p>
            ) : (
                <>
                    <div className="card">
                        <div className="card-title" style={{ marginBottom: 20 }}>
                            Modelo
                        </div>
                        <div className="checkbox-row">
                            <input
                                id="cfg-ia-ativa"
                                type="checkbox"
                                checked={d.cfgEnabled}
                                onChange={e => d.setCfgEnabled(e.target.checked)}
                            />
                            <label htmlFor="cfg-ia-ativa">IA ativa</label>
                        </div>
                        <div className="two-cols">
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-provider">
                                    Provedor
                                </label>
                                <select
                                    id="cfg-provider"
                                    className="input select"
                                    value={d.cfgProvider}
                                    onChange={e => {
                                        const p = e.target.value
                                        d.setCfgProvider(p)
                                        const list = presetsForProvider(p) as string[]
                                        if (!list.includes(d.cfgModel)) d.setCfgModel(list[0] ?? d.cfgModel)
                                    }}
                                >
                                    <option value="gemini">Google Gemini</option>
                                    <option value="openai">OpenAI</option>
                                </select>
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-model-preset">
                                    Modelo
                                </label>
                                <select
                                    id="cfg-model-preset"
                                    className="input select"
                                    value={modelSel}
                                    onChange={e => {
                                        const v = e.target.value
                                        if (v === MODEL_CUSTOM) return
                                        d.setCfgModel(v)
                                    }}
                                    aria-describedby={err.cfgModel ? 'err-cfg-model' : undefined}
                                >
                                    {presets.map(m => (
                                        <option key={m} value={m}>
                                            {m}
                                        </option>
                                    ))}
                                    <option value={MODEL_CUSTOM}>Outro (personalizado)</option>
                                </select>
                                {modelSel === MODEL_CUSTOM && (
                                    <input
                                        id="cfg-model-custom"
                                        className="input"
                                        style={{ marginTop: 8 }}
                                        value={d.cfgModel}
                                        onChange={e => d.setCfgModel(e.target.value)}
                                        placeholder="ID do modelo"
                                        aria-describedby={err.cfgModel ? 'err-cfg-model' : undefined}
                                    />
                                )}
                                <FieldError id="err-cfg-model" message={err.cfgModel} />
                            </div>
                        </div>
                        <div className="two-cols">
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-temp">
                                    Temperatura
                                </label>
                                <div className="slider-container">
                                    <input
                                        id="cfg-temp"
                                        type="range"
                                        className="slider"
                                        min={0}
                                        max={1}
                                        step={0.1}
                                        value={d.cfgTemp}
                                        onChange={e => d.setCfgTemp(Number(e.target.value))}
                                    />
                                    <span className="slider-value" aria-live="polite">
                                        {d.cfgTemp}
                                    </span>
                                </div>
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-max-msg">
                                    Máx. mensagens / conversa (antes de handoff)
                                </label>
                                <input
                                    id="cfg-max-msg"
                                    type="number"
                                    className="input"
                                    min={1}
                                    value={d.cfgMax}
                                    onChange={e => d.setCfgMax(Number(e.target.value))}
                                    aria-invalid={!!err.cfgMax}
                                    aria-describedby={err.cfgMax ? 'err-cfg-max' : undefined}
                                />
                                <FieldError id="err-cfg-max" message={err.cfgMax} />
                            </div>
                        </div>
                        <p
                            style={{
                                color: 'var(--text-secondary)',
                                fontSize: 13,
                                marginTop: 16,
                                marginBottom: 8
                            }}
                        >
                            Chaves de API por workspace (opcional). Se vazias, usam-se{' '}
                            <code className="inline-code">OPENAI_API_KEY</code> e{' '}
                            <code className="inline-code">GOOGLE_API_KEY</code> do servidor. As chaves
                            guardadas não são mostradas de novo; só indicador &quot;configurada&quot;.
                        </p>
                        <div className="two-cols" style={{ marginTop: 8 }}>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-openai-key">
                                    OpenAI API key
                                </label>
                                <input
                                    id="cfg-openai-key"
                                    type="password"
                                    className="input"
                                    autoComplete="off"
                                    value={d.cfgOpenaiKeyInput}
                                    onChange={e => {
                                        d.setCfgOpenaiKeyInput(e.target.value)
                                        if (e.target.value.trim()) d.setCfgClearOpenaiKey(false)
                                    }}
                                    placeholder={
                                        d.aiConfig?.openai_api_key_set
                                            ? 'Nova chave (deixa vazio para manter a atual)'
                                            : 'sk-…'
                                    }
                                />
                                <div className="checkbox-row" style={{ marginTop: 8 }}>
                                    <input
                                        id="cfg-clear-openai"
                                        type="checkbox"
                                        checked={d.cfgClearOpenaiKey}
                                        onChange={e => {
                                            d.setCfgClearOpenaiKey(e.target.checked)
                                            if (e.target.checked) d.setCfgOpenaiKeyInput('')
                                        }}
                                    />
                                    <label htmlFor="cfg-clear-openai">
                                        Remover chave do workspace (passar a usar só o .env)
                                    </label>
                                </div>
                                {d.aiConfig?.openai_api_key_set && !d.cfgClearOpenaiKey && (
                                    <p style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                                        Chave do workspace ativa.
                                    </p>
                                )}
                                {d.cfgClearOpenaiKey && (
                                    <p style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                                        Será removida ao guardar.
                                    </p>
                                )}
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-google-key">
                                    Google AI (Gemini) API key
                                </label>
                                <input
                                    id="cfg-google-key"
                                    type="password"
                                    className="input"
                                    autoComplete="off"
                                    value={d.cfgGoogleKeyInput}
                                    onChange={e => {
                                        d.setCfgGoogleKeyInput(e.target.value)
                                        if (e.target.value.trim()) d.setCfgClearGoogleKey(false)
                                    }}
                                    placeholder={
                                        d.aiConfig?.google_api_key_set
                                            ? 'Nova chave (deixa vazio para manter a atual)'
                                            : 'AIza…'
                                    }
                                />
                                <div className="checkbox-row" style={{ marginTop: 8 }}>
                                    <input
                                        id="cfg-clear-google"
                                        type="checkbox"
                                        checked={d.cfgClearGoogleKey}
                                        onChange={e => {
                                            d.setCfgClearGoogleKey(e.target.checked)
                                            if (e.target.checked) d.setCfgGoogleKeyInput('')
                                        }}
                                    />
                                    <label htmlFor="cfg-clear-google">
                                        Remover chave do workspace (passar a usar só o .env)
                                    </label>
                                </div>
                                {d.aiConfig?.google_api_key_set && !d.cfgClearGoogleKey && (
                                    <p style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                                        Chave do workspace ativa.
                                    </p>
                                )}
                                {d.cfgClearGoogleKey && (
                                    <p style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                                        Será removida ao guardar.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-title" style={{ marginBottom: 16 }}>
                            Contexto enviado ao modelo
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
                            Quantas mensagens recentes entram no histórico e como aparecem no transcript (como no CR Pro:
                            cliente vs equipe vs IA).
                        </p>
                        <div className="two-cols">
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-ctx-max">
                                    Mensagens no contexto (1–100)
                                </label>
                                <input
                                    id="cfg-ctx-max"
                                    type="number"
                                    className="input"
                                    min={1}
                                    max={100}
                                    value={d.cfgContextMax}
                                    onChange={e => d.setCfgContextMax(Number(e.target.value))}
                                    aria-invalid={!!err.cfgContextMax}
                                    aria-describedby={err.cfgContextMax ? 'err-cfg-ctx' : undefined}
                                />
                                <FieldError id="err-cfg-ctx" message={err.cfgContextMax} />
                            </div>
                        </div>
                        <div className="two-cols" style={{ marginTop: 12 }}>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-label-team">
                                    Rótulo mensagens da equipe (sender interno)
                                </label>
                                <input
                                    id="cfg-label-team"
                                    className="input"
                                    value={d.cfgLabelTeam}
                                    onChange={e => d.setCfgLabelTeam(e.target.value)}
                                    placeholder="Equipe"
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-label-asst">
                                    Rótulo respostas da IA
                                </label>
                                <input
                                    id="cfg-label-asst"
                                    className="input"
                                    value={d.cfgLabelAssistant}
                                    onChange={e => d.setCfgLabelAssistant(e.target.value)}
                                    placeholder="Assistente"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-title" style={{ marginBottom: 16 }}>
                            Envio WhatsApp (Uazapi)
                        </div>
                        <div className="two-cols">
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-send-delay">
                                    Atraso antes de enviar (ms)
                                </label>
                                <input
                                    id="cfg-send-delay"
                                    type="number"
                                    className="input"
                                    min={0}
                                    max={120000}
                                    value={d.cfgSendDelay}
                                    onChange={e => d.setCfgSendDelay(Number(e.target.value))}
                                    aria-invalid={!!err.cfgSendDelay}
                                    aria-describedby={err.cfgSendDelay ? 'err-send-delay' : undefined}
                                />
                                <FieldError id="err-send-delay" message={err.cfgSendDelay} />
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-presence">
                                    Presença
                                </label>
                                <select
                                    id="cfg-presence"
                                    className="input select"
                                    value={d.cfgSendPresence}
                                    onChange={e => d.setCfgSendPresence(e.target.value)}
                                >
                                    <option value="composing">Digitando (composing)</option>
                                    <option value="recording">Gravando áudio</option>
                                    <option value="paused">Pausado</option>
                                    <option value="none">Nenhum</option>
                                </select>
                            </div>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 12 }}>
                            Várias bolhas: divide a resposta do modelo em várias mensagens WhatsApp. O atraso acima
                            aplica-se também entre cada bolha. Com &quot;Parágrafos&quot;, o modelo deve separar blocos
                            com uma linha em branco.
                        </p>
                        <div className="checkbox-row" style={{ marginTop: 12 }}>
                            <input
                                id="cfg-chunk-messages"
                                type="checkbox"
                                checked={d.cfgChunkMessages}
                                onChange={e => d.setCfgChunkMessages(e.target.checked)}
                            />
                            <label htmlFor="cfg-chunk-messages">Enviar resposta em várias mensagens</label>
                        </div>
                        {d.cfgChunkMessages && (
                            <div className="two-cols" style={{ marginTop: 12 }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="cfg-chunk-mode">
                                        Como dividir
                                    </label>
                                    <select
                                        id="cfg-chunk-mode"
                                        className="input select"
                                        value={d.cfgChunkSplitMode}
                                        onChange={e => d.setCfgChunkSplitMode(e.target.value)}
                                    >
                                        <option value="paragraph">Parágrafos (linha em branco)</option>
                                        <option value="lines">Cada linha = uma mensagem</option>
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="cfg-chunk-max">
                                        Máx. mensagens por turno
                                    </label>
                                    <input
                                        id="cfg-chunk-max"
                                        type="number"
                                        className="input"
                                        min={1}
                                        max={20}
                                        value={d.cfgChunkMaxParts}
                                        onChange={e => d.setCfgChunkMaxParts(Number(e.target.value))}
                                        aria-invalid={!!err.cfgChunkMax}
                                        aria-describedby={err.cfgChunkMax ? 'err-chunk-max' : undefined}
                                    />
                                    <FieldError id="err-chunk-max" message={err.cfgChunkMax} />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="card">
                        <div className="card-title" style={{ marginBottom: 16 }}>
                            Buffer e sessão (como no CR Pro)
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
                            O atraso do buffer é aplicado antes de o modelo responder (debounce após mensagens no webhook).
                            Inatividade reinicia a conversa IA no Postgres (estado <code className="inline-code">expired</code>{' '}
                            + nova sessão).
                        </p>
                        <div className="two-cols">
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-buffer">
                                    Atraso do buffer (seg)
                                </label>
                                <input
                                    id="cfg-buffer"
                                    type="number"
                                    className="input"
                                    min={5}
                                    max={120}
                                    value={d.cfgBufferDelay}
                                    onChange={e => d.setCfgBufferDelay(Number(e.target.value))}
                                    aria-invalid={!!err.cfgBufferDelay}
                                    aria-describedby={err.cfgBufferDelay ? 'err-buffer' : undefined}
                                />
                                <FieldError id="err-buffer" message={err.cfgBufferDelay} />
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-inactivity">
                                    Inatividade (horas)
                                </label>
                                <input
                                    id="cfg-inactivity"
                                    type="number"
                                    className="input"
                                    min={1}
                                    max={720}
                                    value={d.cfgInactivity}
                                    onChange={e => d.setCfgInactivity(Number(e.target.value))}
                                    aria-invalid={!!err.cfgInactivity}
                                    aria-describedby={err.cfgInactivity ? 'err-inactivity' : undefined}
                                />
                                <FieldError id="err-inactivity" message={err.cfgInactivity} />
                            </div>
                        </div>
                        <div className="input-group" style={{ marginTop: 12 }}>
                            <label className="input-label" htmlFor="cfg-greeting">
                                Mensagem de saudação (primeira mensagem do contacto)
                            </label>
                            <textarea
                                id="cfg-greeting"
                                className="input textarea"
                                rows={3}
                                value={d.cfgGreeting}
                                onChange={e => d.setCfgGreeting(e.target.value)}
                                placeholder="Opcional. Enviada automaticamente na primeira mensagem do cliente."
                            />
                        </div>
                        <div className="checkbox-row" style={{ marginTop: 12 }}>
                            <input
                                id="cfg-followup"
                                type="checkbox"
                                checked={d.cfgFollowup}
                                onChange={e => {
                                    const on = e.target.checked
                                    d.setCfgFollowup(on)
                                    if (on && d.cfgFollowupSteps.length === 0) {
                                        d.setCfgFollowupSteps([d.newFollowupStepRow()])
                                    }
                                }}
                            />
                            <label htmlFor="cfg-followup">Follow-up automático (vários passos após silêncio do cliente)</label>
                        </div>
                        <FieldError id="err-followup" message={err.followupSteps} />
                        {d.cfgFollowup && (
                            <>
                                <p
                                    style={{
                                        color: 'var(--text-secondary)',
                                        fontSize: 13,
                                        marginTop: 10,
                                        marginBottom: 12
                                    }}
                                >
                                    Cada passo é enviado quando passou o tempo indicado desde a <strong>última mensagem nossa</strong>{' '}
                                    (IA, equipe ou WhatsApp) sem resposta do contacto. Os tempos são cumulativos a partir dessa
                                    âncora (ex.: 15 min, depois 2 h, depois 24 h). Agenda um pedido periódico para{' '}
                                    <code className="inline-code">/api/ai/followup-cron</code> com{' '}
                                    <code className="inline-code">Authorization: Bearer INTERNAL_AI_SECRET</code>.
                                </p>
                                {d.cfgFollowupSteps.map((row, idx) => (
                                    <div key={row.id} className="subcard">
                                        <div className="subcard-header">
                                            <span style={{ fontSize: 13, fontWeight: 600 }}>Passo {idx + 1}</span>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-compact"
                                                onClick={() => d.setCfgFollowupSteps(prev => prev.filter(r => r.id !== row.id))}
                                            >
                                                Remover
                                            </button>
                                        </div>
                                        <div className="two-cols" style={{ marginBottom: 12, gap: 12 }}>
                                            <div className="input-group">
                                                <label className="input-label">Após (quantidade)</label>
                                                <input
                                                    type="number"
                                                    className="input"
                                                    min={1}
                                                    max={9999}
                                                    value={row.amount}
                                                    onChange={e =>
                                                        d.setCfgFollowupSteps(prev =>
                                                            prev.map(r =>
                                                                r.id === row.id
                                                                    ? {
                                                                          ...r,
                                                                          amount: Math.max(
                                                                              1,
                                                                              Number(e.target.value) || 1
                                                                          )
                                                                      }
                                                                    : r
                                                            )
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="input-group">
                                                <label className="input-label">Unidade</label>
                                                <select
                                                    className="input select"
                                                    value={row.unit}
                                                    onChange={e =>
                                                        d.setCfgFollowupSteps(prev =>
                                                            prev.map(r =>
                                                                r.id === row.id
                                                                    ? {
                                                                          ...r,
                                                                          unit: e.target.value as
                                                                              | 'minutes'
                                                                              | 'hours'
                                                                              | 'days'
                                                                      }
                                                                    : r
                                                            )
                                                        )
                                                    }
                                                >
                                                    <option value="minutes">Minutos</option>
                                                    <option value="hours">Horas</option>
                                                    <option value="days">Dias</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">Mensagem (WhatsApp)</label>
                                            <textarea
                                                className="input textarea"
                                                rows={3}
                                                value={row.message}
                                                onChange={e =>
                                                    d.setCfgFollowupSteps(prev =>
                                                        prev.map(r =>
                                                            r.id === row.id ? { ...r, message: e.target.value } : r
                                                        )
                                                    )
                                                }
                                                placeholder="Texto deste passo…"
                                            />
                                        </div>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ marginTop: 4 }}
                                    onClick={() => d.setCfgFollowupSteps(prev => [...prev, d.newFollowupStepRow()])}
                                >
                                    Adicionar passo
                                </button>
                            </>
                        )}
                    </div>

                    <div className="card">
                        <div className="card-title" style={{ marginBottom: 16 }}>
                            Google Agenda
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
                            Liga uma conta Google para o agente consultar disponibilidade (
                            <code className="inline-code">google_calendar_suggest_slots</code>) e criar eventos (
                            <code className="inline-code">google_calendar_create_event</code>) após o cliente
                            confirmar. Requer variáveis OAuth no servidor (ver <code className="inline-code">.env.example</code>
                            ).
                        </p>
                        {d.googleCalendar === null ? (
                            <p className="config-loading" role="status" style={{ fontSize: 13 }}>
                                <span className="config-loading-spinner" aria-hidden="true" />A carregar estado da
                                agenda…
                            </p>
                        ) : (
                            <>
                                {!d.googleCalendar.oauth_configured && (
                                    <p className="field-error" role="status">
                                        OAuth Google não configurado: define{' '}
                                        <code className="inline-code">GOOGLE_CALENDAR_CLIENT_ID</code> e{' '}
                                        <code className="inline-code">GOOGLE_CALENDAR_CLIENT_SECRET</code> no .env.
                                    </p>
                                )}
                                {d.googleCalendar.connected ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        <div
                                            style={{
                                                display: 'flex',
                                                flexWrap: 'wrap',
                                                gap: 12,
                                                alignItems: 'center'
                                            }}
                                        >
                                            <p style={{ margin: 0, fontSize: 14 }}>
                                                Ligado como{' '}
                                                <strong>{d.googleCalendar.account_email || 'conta Google'}</strong>
                                                {d.googleCalendar.default_timezone ? (
                                                    <>
                                                        {' '}
                                                        · fuso{' '}
                                                        <code className="inline-code">
                                                            {d.googleCalendar.default_timezone}
                                                        </code>
                                                    </>
                                                ) : null}
                                            </p>
                                            {d.canGoogleCalendarConnect && (
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary"
                                                    disabled={d.busy}
                                                    onClick={() => void d.disconnectGoogleCalendar()}
                                                >
                                                    Desligar
                                                </button>
                                            )}
                                        </div>
                                        <div className="input-group" style={{ maxWidth: 420 }}>
                                            <label className="input-label" htmlFor="google-agent-calendar">
                                                Agenda usada pelo agente
                                            </label>
                                            <p
                                                style={{
                                                    fontSize: 12,
                                                    color: 'var(--text-secondary)',
                                                    margin: '0 0 8px'
                                                }}
                                            >
                                                Disponibilidade e novos eventos usam esta agenda (só calendários com
                                                permissão de edição).
                                            </p>
                                            {d.googleCalendarCalendarsLoading ? (
                                                <p className="config-loading" role="status" style={{ fontSize: 13 }}>
                                                    <span className="config-loading-spinner" aria-hidden="true" />A
                                                    carregar agendas…
                                                </p>
                                            ) : d.googleCalendarCalendarsError ? (
                                                <p className="field-error" role="alert">
                                                    {d.googleCalendarCalendarsError}
                                                </p>
                                            ) : (
                                                <select
                                                    id="google-agent-calendar"
                                                    className="input"
                                                    disabled={
                                                        d.busy ||
                                                        !d.canGoogleCalendarConnect ||
                                                        d.googleCalendarCalendarsLoading
                                                    }
                                                    value={d.googleCalendar?.calendar_id || 'primary'}
                                                    onChange={e => {
                                                        const v = e.target.value
                                                        const cur = d.googleCalendar?.calendar_id || 'primary'
                                                        if (!d.selectedSlug || v === cur) return
                                                        void d.updateGoogleCalendarId(d.selectedSlug, v)
                                                    }}
                                                >
                                                    <option value="primary">Principal (primary)</option>
                                                    {(d.googleCalendarCalendars || []).map(c => {
                                                        if (c.id === 'primary') return null
                                                        const label = c.primary ? `${c.summary} (principal)` : c.summary
                                                        return (
                                                            <option key={c.id} value={c.id}>
                                                                {label}
                                                            </option>
                                                        )
                                                    })}
                                                </select>
                                            )}
                                            {d.googleCalendar?.calendar_id &&
                                                d.googleCalendarCalendars &&
                                                !d.googleCalendarCalendars.some(
                                                    x => x.id === d.googleCalendar?.calendar_id
                                                ) &&
                                                d.googleCalendar?.calendar_id !== 'primary' && (
                                                    <p className="field-error" role="status" style={{ marginTop: 8 }}>
                                                        A agenda guardada (
                                                        <code className="inline-code">{d.googleCalendar?.calendar_id}</code>)
                                                        não aparece na lista — pode ter sido removida ou revogada.
                                                        Escolhe outra.
                                                    </p>
                                                )}
                                        </div>
                                    </div>
                                ) : (
                                    <div
                                        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
                                    >
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            disabled={
                                                d.busy ||
                                                !d.selectedSlug ||
                                                !d.canGoogleCalendarConnect ||
                                                !d.googleCalendar.oauth_configured
                                            }
                                            onClick={d.startGoogleCalendarOAuth}
                                        >
                                            Ligar Google Agenda
                                        </button>
                                        {!d.canGoogleCalendarConnect && (
                                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                                Só owner ou admin do workspace pode ligar.
                                            </span>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div className="card">
                        <div className="card-title" style={{ marginBottom: 16 }}>
                            Voz ElevenLabs (WhatsApp)
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
                            Expõe a ferramenta <code className="inline-code">send_voice_message</code> ao modelo. Requer{' '}
                            <code className="inline-code">ELEVENLABS_API_KEY</code> no servidor (.env). Opcional: voz por defeito
                            em <code className="inline-code">ELEVENLABS_DEFAULT_VOICE_ID</code>.
                        </p>
                        <div className="checkbox-row" style={{ marginBottom: 16 }}>
                            <input
                                id="cfg-eleven"
                                type="checkbox"
                                checked={d.cfgElevenVoice}
                                onChange={e => d.setCfgElevenVoice(e.target.checked)}
                            />
                            <label htmlFor="cfg-eleven">Ativar envio de áudio pela IA</label>
                        </div>
                        {d.cfgElevenVoice && (
                            <>
                                <div className="input-group" style={{ marginBottom: 12 }}>
                                    <label className="input-label" htmlFor="cfg-eleven-voice">
                                        Voice ID (ElevenLabs)
                                    </label>
                                    <input
                                        id="cfg-eleven-voice"
                                        type="text"
                                        className="input"
                                        value={d.cfgElevenVoiceId}
                                        onChange={e => d.setCfgElevenVoiceId(e.target.value)}
                                        placeholder="ex.: do dashboard ElevenLabs (ou usa só a env)"
                                    />
                                </div>
                                <div className="input-group" style={{ marginBottom: 12 }}>
                                    <label className="input-label" htmlFor="cfg-eleven-model">
                                        Model ID (opcional)
                                    </label>
                                    <input
                                        id="cfg-eleven-model"
                                        type="text"
                                        className="input"
                                        value={d.cfgElevenModelId}
                                        onChange={e => d.setCfgElevenModelId(e.target.value)}
                                        placeholder="ex.: eleven_multilingual_v2"
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="cfg-eleven-desc">
                                        Descrição da tool para a IA (opcional)
                                    </label>
                                    <textarea
                                        id="cfg-eleven-desc"
                                        className="input textarea"
                                        rows={3}
                                        value={d.cfgElevenVoiceDesc}
                                        onChange={e => d.setCfgElevenVoiceDesc(e.target.value)}
                                        placeholder="Quando usar áudio em vez de texto…"
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <div className="card">
                        <div className="card-title" style={{ marginBottom: 16 }}>
                            Integração N8N
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
                            Expõe uma ou mais ferramentas ao modelo (nome técnico único por workflow, ex.{' '}
                            <code className="inline-code">n8n_agendar</code> ou <code className="inline-code">call_n8n_webhook</code>{' '}
                            para compatibilidade com o CR Pro). O body inclui <code className="inline-code">workspace_slug</code>,{' '}
                            <code className="inline-code">organization_id</code> e <code className="inline-code">n8n_tool</code>{' '}
                            (nome da função chamada).
                        </p>
                        <FieldError id="err-n8n" message={err.n8nTools} />
                        <div className="checkbox-row" style={{ marginBottom: 16 }}>
                            <input
                                id="cfg-n8n"
                                type="checkbox"
                                checked={d.cfgN8nOn}
                                onChange={e => {
                                    const on = e.target.checked
                                    d.setCfgN8nOn(on)
                                    if (on && d.cfgN8nTools.length === 0) {
                                        d.setCfgN8nTools([d.newN8nToolRow()])
                                    }
                                }}
                            />
                            <label htmlFor="cfg-n8n">Ativar webhooks N8N</label>
                        </div>
                        {d.cfgN8nOn && (
                            <>
                                {d.cfgN8nTools.map((row, idx) => (
                                    <div key={row.id} className="subcard">
                                        <div className="subcard-header">
                                            <span style={{ fontSize: 13, fontWeight: 600 }}>Workflow {idx + 1}</span>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-compact"
                                                onClick={() => d.setCfgN8nTools(prev => prev.filter(r => r.id !== row.id))}
                                            >
                                                Remover
                                            </button>
                                        </div>
                                        <div className="input-group" style={{ marginBottom: 12 }}>
                                            <label className="input-label">
                                                Nome / slug (vira função no modelo; vazio = nome automático)
                                            </label>
                                            <input
                                                type="text"
                                                className="input"
                                                value={row.slug}
                                                onChange={e =>
                                                    d.setCfgN8nTools(prev =>
                                                        prev.map(r =>
                                                            r.id === row.id ? { ...r, slug: e.target.value } : r
                                                        )
                                                    )
                                                }
                                                placeholder="ex.: agendar ou call_n8n_webhook"
                                            />
                                        </div>
                                        <div className="input-group" style={{ marginBottom: 12 }}>
                                            <label className="input-label">URL do webhook</label>
                                            <input
                                                type="url"
                                                className="input"
                                                value={row.url}
                                                onChange={e =>
                                                    d.setCfgN8nTools(prev =>
                                                        prev.map(r =>
                                                            r.id === row.id ? { ...r, url: e.target.value } : r
                                                        )
                                                    )
                                                }
                                                placeholder="https://…"
                                            />
                                        </div>
                                        <div className="input-group" style={{ marginBottom: 12 }}>
                                            <label className="input-label">Timeout (segundos)</label>
                                            <input
                                                type="number"
                                                className="input"
                                                min={5}
                                                max={120}
                                                value={row.timeout_seconds}
                                                onChange={e =>
                                                    d.setCfgN8nTools(prev =>
                                                        prev.map(r =>
                                                            r.id === row.id
                                                                ? { ...r, timeout_seconds: Number(e.target.value) }
                                                                : r
                                                        )
                                                    )
                                                }
                                            />
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">Descrição (para a IA)</label>
                                            <textarea
                                                className="input textarea"
                                                rows={3}
                                                value={row.description}
                                                onChange={e =>
                                                    d.setCfgN8nTools(prev =>
                                                        prev.map(r =>
                                                            r.id === row.id ? { ...r, description: e.target.value } : r
                                                        )
                                                    )
                                                }
                                                placeholder="Quando chamar este workflow e o que enviar no payload."
                                            />
                                        </div>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ marginTop: 4 }}
                                    onClick={() => d.setCfgN8nTools(prev => [...prev, d.newN8nToolRow()])}
                                >
                                    Adicionar ferramenta N8N
                                </button>
                            </>
                        )}
                    </div>

                    <div className="card">
                        <div className="card-title" style={{ marginBottom: 20 }}>
                            Prompt do sistema
                        </div>
                        <label className="sr-only" htmlFor="cfg-prompt">
                            Prompt do sistema
                        </label>
                        <textarea
                            id="cfg-prompt"
                            className="input textarea"
                            rows={10}
                            value={d.cfgPrompt}
                            onChange={e => d.setCfgPrompt(e.target.value)}
                        />
                        <div className="input-group" style={{ marginTop: 16 }}>
                            <label className="input-label" htmlFor="cfg-wa-extra">
                                Instruções extra de formatação (WhatsApp)
                            </label>
                            <textarea
                                id="cfg-wa-extra"
                                className="input textarea"
                                rows={4}
                                value={d.cfgWaExtra}
                                onChange={e => d.setCfgWaExtra(e.target.value)}
                                placeholder="Ex.: use emojis com moderação; cite preços sempre em BRL; não use markdown exceto *negrito*."
                            />
                        </div>
                    </div>
                </>
            )}
        </>
    )
}
