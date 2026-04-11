'use client'

import { useEffect } from 'react'
import {
    MODEL_CUSTOM,
    modelSelectValue,
    presetsForProvider
} from '@/lib/dashboard/model-presets'
import { useDashboard } from './dashboard-context'
import {
    Cpu,
    Key,
    FileText,
    Sliders,
    Clock,
    Calendar,
    Bell,
    Webhook
} from 'lucide-react'

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
                        <p>Configuração do agente para {d.selectedWs?.name || 'o seu espaço de trabalho'}</p>
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
                            disabled={d.busy || !d.selectedSlug || !d.aiConfig}
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
                    {/* ── Card 1: Provedor e Modelo ── */}
                    <div className="card">
                        <div className="card-header-with-icon" style={{ marginBottom: 20 }}>
                            <span className="card-header-icon card-header-icon--blue" aria-hidden="true"><Cpu size={18} /></span>
                            <span className="card-title">Provedor e Modelo</span>
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
                        <div className="checkbox-row" style={{ marginTop: 12 }}>
                            <input
                                id="cfg-test-mode"
                                type="checkbox"
                                checked={d.cfgTestMode}
                                onChange={e => d.setCfgTestMode(e.target.checked)}
                            />
                            <label htmlFor="cfg-test-mode">Modo testes (só números permitidos)</label>
                        </div>
                        {d.cfgTestMode && (
                            <div className="input-group" style={{ marginTop: 12 }}>
                                <label className="input-label" htmlFor="cfg-test-allowlist">
                                    Números permitidos
                                </label>
                                <textarea
                                    id="cfg-test-allowlist"
                                    className="input"
                                    rows={3}
                                    value={d.cfgTestAllowlist}
                                    onChange={e => d.setCfgTestAllowlist(e.target.value)}
                                    placeholder="Um número por linha ou separados por vírgula (ex. +5511999999999)"
                                    aria-invalid={!!err.cfgTestAllowlist}
                                    aria-describedby={err.cfgTestAllowlist ? 'err-cfg-test-allowlist' : undefined}
                                />
                                <FieldError id="err-cfg-test-allowlist" message={err.cfgTestAllowlist} />
                            </div>
                        )}
                        <div className="two-cols" style={{ marginTop: 16 }}>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-provider">Provedor</label>
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
                                    <option value="anthropic">Anthropic (Claude)</option>
                                </select>
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-model-preset">Modelo</label>
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
                                        <option key={m} value={m}>{m}</option>
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
                                <label className="input-label" htmlFor="cfg-temp">Temperatura</label>
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
                                    <span className="slider-value" aria-live="polite">{d.cfgTemp}</span>
                                </div>
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-max-msg">Máx. mensagens / conversa</label>
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
                        <div className="two-cols" style={{ marginTop: 8 }}>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-fallback">Provedor de fallback</label>
                                <select
                                    id="cfg-fallback"
                                    className="input select"
                                    value={d.cfgFallbackProvider ?? ''}
                                    onChange={e => d.setCfgFallbackProvider(e.target.value || null)}
                                >
                                    <option value="">Sem fallback</option>
                                    {d.cfgProvider !== 'gemini' && <option value="gemini">Google Gemini</option>}
                                    {d.cfgProvider !== 'openai' && <option value="openai">OpenAI</option>}
                                    {d.cfgProvider !== 'anthropic' && <option value="anthropic">Anthropic (Claude)</option>}
                                </select>
                                <p style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                                    Se o provedor principal falhar, tenta automaticamente com este.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* ── Card 2: Chaves de API ── */}
                    <div className="card">
                        <div className="card-header-with-icon" style={{ marginBottom: 16 }}>
                            <span className="card-header-icon card-header-icon--orange" aria-hidden="true"><Key size={18} /></span>
                            <span className="card-title">Chaves de API</span>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
                            Chaves por workspace (opcional). Se vazias, usa as variáveis globais do servidor.
                            As chaves guardadas não são exibidas — só o indicador &quot;configurada&quot;.
                        </p>
                        <div className="two-cols">
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-openai-key">OpenAI API key</label>
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
                                    placeholder={d.aiConfig?.openai_api_key_set ? 'Nova chave (vazio = manter)' : 'sk-…'}
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
                                    <label htmlFor="cfg-clear-openai">Remover chave</label>
                                </div>
                                {d.aiConfig?.openai_api_key_set && !d.cfgClearOpenaiKey && (
                                    <p style={{ marginTop: 4, fontSize: 12, color: 'var(--green)' }}>Configurada</p>
                                )}
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-google-key">Google AI (Gemini) API key</label>
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
                                    placeholder={d.aiConfig?.google_api_key_set ? 'Nova chave (vazio = manter)' : 'AIza…'}
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
                                    <label htmlFor="cfg-clear-google">Remover chave</label>
                                </div>
                                {d.aiConfig?.google_api_key_set && !d.cfgClearGoogleKey && (
                                    <p style={{ marginTop: 4, fontSize: 12, color: 'var(--green)' }}>Configurada</p>
                                )}
                            </div>
                        </div>
                        <div className="two-cols" style={{ marginTop: 12 }}>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-anthropic-key">Anthropic (Claude) API key</label>
                                <input
                                    id="cfg-anthropic-key"
                                    type="password"
                                    className="input"
                                    autoComplete="off"
                                    value={d.cfgAnthropicKeyInput ?? ''}
                                    onChange={e => {
                                        d.setCfgAnthropicKeyInput(e.target.value)
                                        if (e.target.value.trim()) d.setCfgClearAnthropicKey(false)
                                    }}
                                    placeholder={d.aiConfig?.anthropic_api_key_set ? 'Nova chave (vazio = manter)' : 'sk-ant-…'}
                                />
                                <div className="checkbox-row" style={{ marginTop: 8 }}>
                                    <input
                                        id="cfg-clear-anthropic"
                                        type="checkbox"
                                        checked={d.cfgClearAnthropicKey ?? false}
                                        onChange={e => {
                                            d.setCfgClearAnthropicKey(e.target.checked)
                                            if (e.target.checked) d.setCfgAnthropicKeyInput('')
                                        }}
                                    />
                                    <label htmlFor="cfg-clear-anthropic">Remover chave</label>
                                </div>
                                {d.aiConfig?.anthropic_api_key_set && !d.cfgClearAnthropicKey && (
                                    <p style={{ marginTop: 4, fontSize: 12, color: 'var(--green)' }}>Configurada</p>
                                )}
                            </div>
                        </div>

                        {/* Vertex AI (opcional) */}
                        {d.cfgProvider === 'gemini' && (
                            <details style={{ marginTop: 12 }}>
                                <summary style={{ cursor: 'pointer', fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600 }}>
                                    Vertex AI (opcional — limites enterprise)
                                </summary>
                                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                                        Configure para usar Vertex AI em vez do Google AI Studio. Se vazio, usa a chave AI Studio acima.
                                    </p>
                                    <div className="two-cols">
                                        <div className="input-group">
                                            <label className="input-label" htmlFor="cfg-vertex-project">Project ID</label>
                                            <input
                                                id="cfg-vertex-project"
                                                className="input"
                                                value={d.cfgVertexProject}
                                                onChange={e => d.setCfgVertexProject(e.target.value)}
                                                placeholder="meu-projeto-gcp"
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label" htmlFor="cfg-vertex-location">Location</label>
                                            <input
                                                id="cfg-vertex-location"
                                                className="input"
                                                value={d.cfgVertexLocation}
                                                onChange={e => d.setCfgVertexLocation(e.target.value)}
                                                placeholder="us-central1"
                                                autoComplete="off"
                                            />
                                        </div>
                                    </div>
                                    <div className="input-group">
                                        <label className="input-label" htmlFor="cfg-vertex-sa">Service Account JSON</label>
                                        <textarea
                                            id="cfg-vertex-sa"
                                            className="input"
                                            rows={3}
                                            value={d.cfgVertexSaJson}
                                            onChange={e => d.setCfgVertexSaJson(e.target.value)}
                                            placeholder={d.aiConfig?.google_service_account_json_set ? 'Novo JSON (vazio = manter)' : '{"type":"service_account","project_id":"..."}'}
                                            style={{ fontFamily: 'monospace', fontSize: 12 }}
                                        />
                                        {d.aiConfig?.google_service_account_json_set && (
                                            <p style={{ marginTop: 4, fontSize: 12, color: 'var(--green)' }}>Configurada</p>
                                        )}
                                    </div>
                                </div>
                            </details>
                        )}
                    </div>

                    {/* ── Card 3: Prompt do Sistema ── */}
                    <div className="card">
                        <div className="card-header-with-icon" style={{ marginBottom: 16 }}>
                            <span className="card-header-icon card-header-icon--purple" aria-hidden="true"><FileText size={18} /></span>
                            <span className="card-title">Prompt do Sistema</span>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
                            Instruções completas para o agente: personalidade, regras, tom, formatação, tudo aqui.
                        </p>
                        <label className="sr-only" htmlFor="cfg-prompt">Prompt do sistema</label>
                        <textarea
                            id="cfg-prompt"
                            className="input textarea"
                            rows={12}
                            value={d.cfgPrompt}
                            onChange={e => d.setCfgPrompt(e.target.value)}
                            placeholder="Defina a personalidade, regras, estilo de resposta e qualquer instrução para o agente..."
                            aria-invalid={!!err.cfgPrompt}
                            aria-describedby={err.cfgPrompt ? 'err-cfg-prompt' : undefined}
                        />
                        <FieldError id="err-cfg-prompt" message={err.cfgPrompt} />
                    </div>

                    {/* ── Card 4: Comportamento ── */}
                    <div className="card">
                        <div className="card-header-with-icon" style={{ marginBottom: 16 }}>
                            <span className="card-header-icon card-header-icon--green" aria-hidden="true"><Sliders size={18} /></span>
                            <span className="card-title">Comportamento</span>
                        </div>
                        <div className="two-cols">
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-buffer">
                                    Atraso antes de responder (seg)
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
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                                    Aguarda mensagens adicionais antes de processar (debounce).
                                </p>
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-inactivity">
                                    Inatividade para nova sessão (horas)
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
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-send-delay">
                                    Atraso de envio (ms)
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
                        </div>
                        <div className="two-cols">
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-presence">Presença (digitando)</label>
                                <select
                                    id="cfg-presence"
                                    className="input select"
                                    value={d.cfgSendPresence}
                                    onChange={e => d.setCfgSendPresence(e.target.value)}
                                >
                                    <option value="composing">Digitando</option>
                                    <option value="recording">Gravando áudio</option>
                                    <option value="paused">Pausado</option>
                                    <option value="none">Nenhum</option>
                                </select>
                            </div>
                        </div>
                        <div className="two-cols" style={{ marginTop: 12 }}>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-label-team">Rótulo equipe</label>
                                <input
                                    id="cfg-label-team"
                                    className="input"
                                    value={d.cfgLabelTeam}
                                    onChange={e => d.setCfgLabelTeam(e.target.value)}
                                    placeholder="Equipe"
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="cfg-label-asst">Rótulo IA</label>
                                <input
                                    id="cfg-label-asst"
                                    className="input"
                                    value={d.cfgLabelAssistant}
                                    onChange={e => d.setCfgLabelAssistant(e.target.value)}
                                    placeholder="Assistente"
                                />
                            </div>
                        </div>

                        <div className="checkbox-row" style={{ marginTop: 16 }}>
                            <input
                                id="cfg-chunk-messages"
                                type="checkbox"
                                checked={d.cfgChunkMessages}
                                onChange={e => d.setCfgChunkMessages(e.target.checked)}
                            />
                            <label htmlFor="cfg-chunk-messages">Dividir resposta em várias mensagens</label>
                        </div>
                        {d.cfgChunkMessages && (
                            <div className="two-cols" style={{ marginTop: 8 }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="cfg-chunk-mode">Modo de divisão</label>
                                    <select
                                        id="cfg-chunk-mode"
                                        className="input select"
                                        value={d.cfgChunkSplitMode}
                                        onChange={e => d.setCfgChunkSplitMode(e.target.value)}
                                    >
                                        <option value="paragraph">Parágrafos</option>
                                        <option value="lines">Cada linha</option>
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="cfg-chunk-max">Máx. partes</label>
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

                    {/* ── Card 5: Follow-up Automático ── */}
                    <div className="card">
                        <div className="card-header-with-icon" style={{ marginBottom: 16 }}>
                            <span className="card-header-icon card-header-icon--orange" aria-hidden="true"><Clock size={18} /></span>
                            <span className="card-title">Follow-up Automático</span>
                        </div>
                        <div className="checkbox-row">
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
                            <label htmlFor="cfg-followup">Enviar follow-up após silêncio do cliente</label>
                        </div>
                        <FieldError id="err-followup" message={err.followupSteps} />
                        {d.cfgFollowup && (
                            <>
                                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 10, marginBottom: 12 }}>
                                    Cada passo é enviado quando passa o tempo indicado desde a última mensagem sem resposta do contacto.
                                </p>

                                <div className="input-group" style={{ marginBottom: 16 }}>
                                    <label className="input-label" htmlFor="cfg-followup-prompt">
                                        Prompt de follow-up (opcional)
                                    </label>
                                    <textarea
                                        id="cfg-followup-prompt"
                                        className="input textarea"
                                        rows={4}
                                        value={d.cfgFollowupPrompt ?? ''}
                                        onChange={e => d.setCfgFollowupPrompt(e.target.value)}
                                        placeholder={'Se preenchido, a IA usa este prompt + histórico da conversa para gerar a mensagem de follow-up.\nSe vazio, usa a mensagem fixa de cada passo abaixo.'}
                                    />
                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                                        Quando preenchido, a IA analisa o histórico da conversa e gera uma mensagem personalizada.
                                        A mensagem fixa do passo é usada como fallback se a IA falhar.
                                    </p>
                                </div>

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
                                                                    ? { ...r, amount: Math.max(1, Number(e.target.value) || 1) }
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
                                                                    ? { ...r, unit: e.target.value as 'minutes' | 'hours' | 'days' }
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
                                            <label className="input-label">Mensagem</label>
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

                    {/* ── Card 6: Google Agenda ── */}
                    <div className="card">
                        <div className="card-header-with-icon" style={{ marginBottom: 16 }}>
                            <span className="card-header-icon card-header-icon--blue" aria-hidden="true"><Calendar size={18} /></span>
                            <span className="card-title">Google Agenda</span>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
                            Permite ao agente consultar disponibilidade e criar eventos na agenda do Google.
                        </p>
                        {d.googleCalendar === null ? (
                            <p className="config-loading" role="status" style={{ fontSize: 13 }}>
                                <span className="config-loading-spinner" aria-hidden="true" />A carregar…
                            </p>
                        ) : (
                            <>
                                {!d.googleCalendar.oauth_configured && (
                                    <p className="field-error" role="status">
                                        OAuth não configurado no servidor. Defina{' '}
                                        <code className="inline-code">GOOGLE_CALENDAR_CLIENT_ID</code> e{' '}
                                        <code className="inline-code">GOOGLE_CALENDAR_CLIENT_SECRET</code>.
                                    </p>
                                )}
                                {d.googleCalendar.connected ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                        <div className="subcard" style={{ marginBottom: 0 }}>
                                            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                                                Ligado como <strong>{d.googleCalendar.account_email || 'conta Google'}</strong>
                                                {d.googleCalendar.default_timezone && (
                                                    <>
                                                        <br />
                                                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                                            Fuso: <code className="inline-code">{d.googleCalendar.default_timezone}</code>
                                                        </span>
                                                    </>
                                                )}
                                            </p>
                                            {d.canGoogleCalendarConnect && (
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-compact"
                                                    style={{ marginTop: 10, borderColor: 'rgba(239, 68, 68, 0.3)', color: 'var(--red)' }}
                                                    disabled={d.busy}
                                                    onClick={() => void d.disconnectGoogleCalendar()}
                                                >
                                                    Desligar
                                                </button>
                                            )}
                                        </div>
                                        <div className="input-group" style={{ maxWidth: 420, marginBottom: 0 }}>
                                            <label className="input-label" htmlFor="google-agent-calendar">Agenda do agente</label>
                                            {d.googleCalendarCalendarsLoading ? (
                                                <p className="config-loading" role="status" style={{ fontSize: 13 }}>
                                                    <span className="config-loading-spinner" aria-hidden="true" />
                                                    A carregar agendas…
                                                </p>
                                            ) : d.googleCalendarCalendarsError ? (
                                                <p className="field-error" role="alert">{d.googleCalendarCalendarsError}</p>
                                            ) : (
                                                <select
                                                    id="google-agent-calendar"
                                                    className="input select"
                                                    disabled={d.busy || !d.canGoogleCalendarConnect || d.googleCalendarCalendarsLoading}
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
                                                        return <option key={c.id} value={c.id}>{label}</option>
                                                    })}
                                                </select>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            style={{ alignSelf: 'flex-start' }}
                                            disabled={d.busy || !d.selectedSlug || !d.canGoogleCalendarConnect || !d.googleCalendar.oauth_configured}
                                            onClick={d.startGoogleCalendarOAuth}
                                        >
                                            Conectar Google Agenda
                                        </button>
                                        {!d.canGoogleCalendarConnect && (
                                            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                                                Só owner ou admin pode conectar.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* ── Card 7: Notificações à Equipa ── */}
                    <div className="card">
                        <div className="card-header-with-icon" style={{ marginBottom: 16 }}>
                            <span className="card-header-icon card-header-icon--green" aria-hidden="true"><Bell size={18} /></span>
                            <span className="card-title">Notificações à Equipa</span>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
                            O agente pode enviar alertas por WhatsApp para a equipa quando necessário.
                        </p>
                        <div className="checkbox-row" style={{ marginBottom: 16 }}>
                            <input
                                id="cfg-team-notify"
                                type="checkbox"
                                checked={d.cfgTeamNotify}
                                onChange={e => d.setCfgTeamNotify(e.target.checked)}
                            />
                            <label htmlFor="cfg-team-notify">Ativar notificações</label>
                        </div>
                        {d.cfgTeamNotify && (
                            <>
                                <div className="input-group" style={{ marginBottom: 12 }}>
                                    <label className="input-label" htmlFor="cfg-team-notify-allow">Números da equipa</label>
                                    <textarea
                                        id="cfg-team-notify-allow"
                                        className="input"
                                        rows={3}
                                        value={d.cfgTeamNotifyAllowlist}
                                        onChange={e => d.setCfgTeamNotifyAllowlist(e.target.value)}
                                        placeholder="Um número por linha (ex. +5511999999999)"
                                        aria-invalid={!!err.cfgTeamNotifyAllowlist}
                                        aria-describedby={err.cfgTeamNotifyAllowlist ? 'err-cfg-team-notify-allow' : undefined}
                                    />
                                    <FieldError id="err-cfg-team-notify-allow" message={err.cfgTeamNotifyAllowlist} />
                                </div>
                                <div className="checkbox-row" style={{ marginBottom: 12 }}>
                                    <input
                                        id="cfg-team-notify-transcript"
                                        type="checkbox"
                                        checked={d.cfgTeamNotifyAppendTranscript}
                                        onChange={e => d.setCfgTeamNotifyAppendTranscript(e.target.checked)}
                                    />
                                    <label htmlFor="cfg-team-notify-transcript">Incluir trecho da conversa na notificação</label>
                                </div>
                                <div className="input-group" style={{ marginBottom: 12 }}>
                                    <label className="input-label" htmlFor="cfg-team-notify-desc">Quando notificar (instrução para a IA)</label>
                                    <textarea
                                        id="cfg-team-notify-desc"
                                        className="input"
                                        rows={2}
                                        value={d.cfgTeamNotifyDesc}
                                        onChange={e => d.setCfgTeamNotifyDesc(e.target.value)}
                                        placeholder="Ex.: notificar quando o cliente pedir para falar com humano..."
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="cfg-team-notify-template">
                                        Modelo da mensagem (template)
                                    </label>
                                    <textarea
                                        id="cfg-team-notify-template"
                                        className="input textarea"
                                        rows={6}
                                        value={d.cfgTeamNotifyTemplate ?? ''}
                                        onChange={e => d.setCfgTeamNotifyTemplate(e.target.value)}
                                        placeholder={'Exemplo de formato:\n\nNovo lead qualificado:\nNome: {nome}\nTelefone: {telefone}\nInteresse: {interesse}\nResumo: {resumo_conversa}'}
                                    />
                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                                        Instrua a IA sobre como formatar a notificação. Use campos como {'{nome}'}, {'{telefone}'}, etc.
                                        A IA preencherá os dados automaticamente a partir da conversa.
                                    </p>
                                </div>
                            </>
                        )}
                    </div>

                    {/* ── Card 9: Integração N8N ── */}
                    <div className="card">
                        <div className="card-header-with-icon" style={{ marginBottom: 16 }}>
                            <span className="card-header-icon card-header-icon--purple" aria-hidden="true"><Webhook size={18} /></span>
                            <span className="card-title">Webhooks N8N</span>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
                            Conecte workflows N8N que o agente pode acionar como ferramentas.
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
                                        <div className="two-cols" style={{ marginBottom: 12 }}>
                                            <div className="input-group">
                                                <label className="input-label">Nome da ferramenta</label>
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
                                                    placeholder="ex.: agendar"
                                                />
                                            </div>
                                            <div className="input-group">
                                                <label className="input-label">Timeout (seg)</label>
                                                <input
                                                    type="number"
                                                    className="input"
                                                    min={5}
                                                    max={120}
                                                    value={row.timeout_seconds}
                                                    onChange={e =>
                                                        d.setCfgN8nTools(prev =>
                                                            prev.map(r =>
                                                                r.id === row.id ? { ...r, timeout_seconds: Number(e.target.value) } : r
                                                            )
                                                        )
                                                    }
                                                />
                                            </div>
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
                                        <div className="input-group">
                                            <label className="input-label">Descrição (para a IA)</label>
                                            <textarea
                                                className="input"
                                                rows={2}
                                                value={row.description}
                                                onChange={e =>
                                                    d.setCfgN8nTools(prev =>
                                                        prev.map(r =>
                                                            r.id === row.id ? { ...r, description: e.target.value } : r
                                                        )
                                                    )
                                                }
                                                placeholder="Quando chamar este workflow…"
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
                                    Adicionar workflow
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}
        </>
    )
}
