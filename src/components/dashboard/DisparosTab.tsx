'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDashboard } from './dashboard-context'

type MetaTpl = {
    id?: string
    name: string
    language?: string
    status?: string
    category?: string
}

type ContactRow = { id: string; phone: string; name: string }

type BroadcastRow = {
    id: string
    name: string
    template_name: string
    template_language: string
    status: string
    sent_count: number
    failed_count: number
    pending_count: number
    created_at: string
    scheduled_at?: string | null
    max_sends_per_day?: number | null
    send_timezone?: string | null
}

const CONTACT_PAGE = 150
const TIMEZONE_PRESETS = [
    'Europe/Lisbon',
    'Atlantic/Azores',
    'Europe/Madrid',
    'America/Sao_Paulo',
    'UTC'
]

/** Dados fictícios só para compor o ecrã quando ainda não há WABA ligada. */
const PREVIEW_TEMPLATES: MetaTpl[] = [
    { name: 'boas_vindas', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY' },
    { name: 'promo_marco', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING' },
    { name: 'lembrete_agenda', language: 'pt_BR', status: 'PENDING', category: 'UTILITY' }
]

const PREVIEW_CONTACTS: ContactRow[] = [
    { id: 'preview-c1', phone: '+351912345678', name: 'Exemplo — Maria Silva' },
    { id: 'preview-c2', phone: '+351923456789', name: 'Exemplo — João Costa' },
    { id: 'preview-c3', phone: '+351934567890', name: 'Exemplo — Loja Norte' }
]

const PREVIEW_BROADCASTS: BroadcastRow[] = [
    {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Exemplo — Campanha em pausa',
        template_name: 'boas_vindas',
        template_language: 'pt_BR',
        status: 'paused',
        sent_count: 120,
        failed_count: 3,
        pending_count: 45,
        created_at: new Date().toISOString(),
        scheduled_at: null,
        max_sends_per_day: 200,
        send_timezone: 'Europe/Lisbon'
    }
]

function BroadcastDayStats({
    slug,
    broadcastId,
    maxDay,
    tz
}: {
    slug: string
    broadcastId: string
    maxDay: number | null | undefined
    tz: string | null | undefined
}) {
    const [sentToday, setSentToday] = useState<number | null>(null)

    useEffect(() => {
        if (!slug || broadcastId.startsWith('00000000-0000')) {
            setSentToday(null)
            return
        }
        let cancelled = false
        void (async () => {
            const res = await fetch(
                `/api/whatsapp/broadcasts/${broadcastId}/stats?workspace_slug=${encodeURIComponent(slug)}`,
                { credentials: 'include' }
            )
            const j = await res.json().catch(() => ({}))
            if (!cancelled && typeof (j as { sent_today?: number }).sent_today === 'number') {
                setSentToday((j as { sent_today: number }).sent_today)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [slug, broadcastId])

    if (maxDay == null || broadcastId.startsWith('00000000-0000')) return null
    if (sentToday === null) {
        return (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                Hoje ({tz || 'Europe/Lisbon'}): … / {maxDay}
            </div>
        )
    }
    return (
        <div style={{ fontSize: 13, marginTop: 4 }}>
            Enviados hoje ({tz || 'Europe/Lisbon'}): <strong>{sentToday}</strong> / {maxDay}
        </div>
    )
}

export function DisparosTab() {
    const d = useDashboard()
    const slug = d.selectedSlug
    const canManage = d.canEditWorkspaceIdentity(slug)
    const isOfficial = d.instance?.provider === 'official' && d.instance?.status === 'connected'
    const [layoutPreview, setLayoutPreview] = useState(false)
    const showCampaignUi = isOfficial || layoutPreview

    const [templates, setTemplates] = useState<MetaTpl[]>([])
    const [contacts, setContacts] = useState<ContactRow[]>([])
    const [contactsTotal, setContactsTotal] = useState(0)
    const [contactOffset, setContactOffset] = useState(0)
    const [contactSearchInput, setContactSearchInput] = useState('')
    const [contactSearchDebounced, setContactSearchDebounced] = useState('')
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([])
    const [loading, setLoading] = useState(false)
    const [tplLoading, setTplLoading] = useState(false)
    const [importing, setImporting] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [name, setName] = useState('')
    const [tplKey, setTplKey] = useState('')
    const [componentsJson, setComponentsJson] = useState('[]')
    const [scheduledLocal, setScheduledLocal] = useState('')
    const [maxSendsPerDay, setMaxSendsPerDay] = useState('')
    const [sendTimezone, setSendTimezone] = useState('Europe/Lisbon')

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    useEffect(() => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
        searchDebounceRef.current = setTimeout(() => {
            setContactSearchDebounced(contactSearchInput.trim())
            setContactOffset(0)
        }, 350)
        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
        }
    }, [contactSearchInput])

    const loadTemplates = useCallback(async () => {
        if (!slug || !isOfficial) {
            setTemplates([])
            return
        }
        setTplLoading(true)
        try {
            const res = await fetch(
                `/api/whatsapp/meta/templates?workspace_slug=${encodeURIComponent(slug)}`,
                { credentials: 'include' }
            )
            const j = await res.json().catch(() => ({}))
            setTemplates(Array.isArray(j.templates) ? j.templates : [])
        } finally {
            setTplLoading(false)
        }
    }, [slug, isOfficial])

    const loadContacts = useCallback(async () => {
        if (!slug) {
            setContacts([])
            setContactsTotal(0)
            return
        }
        const q = new URLSearchParams({
            workspace_slug: slug,
            limit: String(CONTACT_PAGE),
            offset: String(contactOffset)
        })
        if (contactSearchDebounced) q.set('q', contactSearchDebounced)
        const res = await fetch(`/api/workspace/contacts?${q}`, { credentials: 'include' })
        const j = await res.json().catch(() => ({}))
        setContacts(Array.isArray(j.contacts) ? j.contacts : [])
        setContactsTotal(typeof j.total === 'number' ? j.total : 0)
    }, [slug, contactOffset, contactSearchDebounced])

    const loadBroadcasts = useCallback(async () => {
        if (!slug) {
            setBroadcasts([])
            return
        }
        const res = await fetch(
            `/api/whatsapp/broadcasts?workspace_slug=${encodeURIComponent(slug)}`,
            { credentials: 'include' }
        )
        const j = await res.json().catch(() => ({}))
        setBroadcasts(Array.isArray(j.broadcasts) ? j.broadcasts : [])
    }, [slug])

    const refreshAll = useCallback(async () => {
        setLoading(true)
        try {
            await Promise.all([loadTemplates(), loadContacts(), loadBroadcasts()])
        } finally {
            setLoading(false)
        }
    }, [loadTemplates, loadContacts, loadBroadcasts])

    useEffect(() => {
        void refreshAll()
    }, [refreshAll])

    useEffect(() => {
        if (slug && showCampaignUi && !layoutPreview) {
            void loadContacts()
        }
    }, [slug, showCampaignUi, layoutPreview, loadContacts])

    useEffect(() => {
        if (isOfficial) setLayoutPreview(false)
    }, [isOfficial])

    function toggleContact(id: string) {
        setSelectedIds(prev => {
            const n = new Set(prev)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            return n
        })
    }

    async function selectAllMatchingFilter() {
        if (!slug || !canManage) return
        setLoading(true)
        try {
            const q = new URLSearchParams({
                workspace_slug: slug,
                limit: '2000',
                offset: '0'
            })
            if (contactSearchDebounced) q.set('q', contactSearchDebounced)
            const res = await fetch(`/api/workspace/contacts?${q}`, { credentials: 'include' })
            const j = await res.json().catch(() => ({}))
            const list = Array.isArray(j.contacts) ? (j.contacts as ContactRow[]) : []
            setSelectedIds(prev => {
                const n = new Set(prev)
                for (const c of list) n.add(c.id)
                return n
            })
            d.setToast({
                message: `Selecionados ${list.length} contacto(s) com o filtro actual.`,
                variant: 'success'
            })
        } finally {
            setLoading(false)
        }
    }

    async function onPickImportFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file || !slug || !canManage) return
        setImporting(true)
        try {
            const fd = new FormData()
            fd.set('workspace_slug', slug)
            fd.set('file', file)
            const res = await fetch('/api/workspace/contacts/import', {
                method: 'POST',
                credentials: 'include',
                body: fd
            })
            const j = await res.json().catch(() => ({}))
            if (!res.ok) {
                d.setToast({ message: (j as { error?: string }).error || 'Falha no import', variant: 'error' })
                return
            }
            const up = (j as { upserted?: number }).upserted ?? 0
            const errN = ((j as { errors?: string[] }).errors || []).length
            d.setToast({
                message: `Importação: ${up} guardados.${errN ? ` ${errN} avisos.` : ''}`,
                variant: errN ? 'error' : 'success'
            })
            await loadContacts()
        } finally {
            setImporting(false)
        }
    }

    async function submit(start: boolean) {
        if (!slug || !canManage) return
        if (!isOfficial) {
            d.setToast({
                message: 'Conecta WhatsApp Meta oficial (separador WhatsApp) para criar campanhas reais.',
                variant: 'error'
            })
            return
        }
        const parts = tplKey.split('||')
        const template_name = parts[0]
        const template_language = parts[1] || 'pt_BR'
        if (!template_name) {
            d.setToast({ message: 'Escolhe um template aprovado.', variant: 'error' })
            return
        }
        let template_components: unknown = []
        try {
            template_components = JSON.parse(componentsJson || '[]')
            if (!Array.isArray(template_components)) throw new Error('components must be array')
        } catch {
            d.setToast({
                message: 'JSON dos componentes inválido (usa [] se o template não tiver variáveis).',
                variant: 'error'
            })
            return
        }
        const contact_ids = [...selectedIds].filter(id => !id.startsWith('preview-'))
        if (contact_ids.length === 0) {
            d.setToast({ message: 'Seleciona pelo menos um contacto.', variant: 'error' })
            return
        }

        let scheduled_at: string | null = null
        if (scheduledLocal.trim()) {
            const t = new Date(scheduledLocal)
            if (Number.isNaN(t.getTime())) {
                d.setToast({ message: 'Data/hora de agendamento inválida.', variant: 'error' })
                return
            }
            scheduled_at = t.toISOString()
        }

        let max_sends_per_day: number | null = null
        if (maxSendsPerDay.trim()) {
            const n = parseInt(maxSendsPerDay, 10)
            if (!Number.isFinite(n) || n < 1) {
                d.setToast({ message: 'Máx. por dia deve ser um inteiro ≥ 1.', variant: 'error' })
                return
            }
            max_sends_per_day = n
        }

        setLoading(true)
        try {
            const res = await fetch('/api/whatsapp/broadcasts', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspace_slug: slug,
                    name: name.trim() || `Campanha ${new Date().toLocaleString()}`,
                    template_name,
                    template_language,
                    template_components,
                    contact_ids,
                    start,
                    scheduled_at,
                    max_sends_per_day,
                    send_timezone: sendTimezone
                })
            })
            const j = await res.json().catch(() => ({}))
            if (!res.ok) {
                d.setToast({ message: (j as { error?: string }).error || 'Falha ao criar', variant: 'error' })
                return
            }
            const st = (j as { status?: string }).status
            let msg = 'Campanha criada (rascunho).'
            if (st === 'running') msg = 'Campanha criada e em execução.'
            if (st === 'scheduled') msg = 'Campanha agendada; os envios começam na data indicada.'
            d.setToast({ message: msg, variant: 'success' })
            setName('')
            setScheduledLocal('')
            setMaxSendsPerDay('')
            setSelectedIds(new Set())
            await loadBroadcasts()
        } finally {
            setLoading(false)
        }
    }

    async function patchBroadcast(id: string, action: 'start' | 'pause' | 'resume' | 'cancel') {
        if (!slug) return
        if (!isOfficial) {
            d.setToast({
                message: 'Conecta WhatsApp Meta oficial para controlar campanhas reais.',
                variant: 'error'
            })
            return
        }
        setLoading(true)
        try {
            const res = await fetch(`/api/whatsapp/broadcasts/${id}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspace_slug: slug, action })
            })
            const j = await res.json().catch(() => ({}))
            if (!res.ok) {
                d.setToast({ message: (j as { error?: string }).error || 'Falha', variant: 'error' })
                return
            }
            await loadBroadcasts()
        } finally {
            setLoading(false)
        }
    }

    const displayTemplates = isOfficial ? templates : layoutPreview ? PREVIEW_TEMPLATES : []
    const displayContacts =
        isOfficial ? contacts : layoutPreview ? (contacts.length > 0 ? contacts : PREVIEW_CONTACTS) : []
    const displayBroadcasts =
        isOfficial ? broadcasts : layoutPreview ? (broadcasts.length > 0 ? broadcasts : PREVIEW_BROADCASTS) : []

    const approvedOptions = displayTemplates.filter(t => String(t.status || '').toUpperCase() === 'APPROVED')
    const actionsLive = isOfficial && canManage

    function selectAllOnPage() {
        setSelectedIds(prev => {
            const n = new Set(prev)
            for (const c of displayContacts) {
                if (!c.id.startsWith('preview-')) n.add(c.id)
            }
            return n
        })
    }

    const contactPages = Math.max(1, Math.ceil(contactsTotal / CONTACT_PAGE) || 1)
    const contactPageIndex = Math.floor(contactOffset / CONTACT_PAGE) + 1

    return (
        <>
            <div className="page-header">
                <h2>Disparos (Meta oficial)</h2>
                <p>Campanhas com templates aprovados pela Meta e fila de envio.</p>
            </div>

            {!slug && (
                <p style={{ color: 'var(--text-secondary)' }}>Seleciona um workspace para gerir disparos.</p>
            )}

            {slug && !showCampaignUi && (
                <div className="card alert-card" role="alert">
                    <p className="alert-card-text" style={{ marginBottom: 12 }}>
                        Os disparos em massa usam só a API oficial. Liga o WhatsApp com &quot;Conectar Meta Oficial&quot; no
                        separador WhatsApp.
                    </p>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setLayoutPreview(true)}
                    >
                        Pré-visualizar interface (sem chip)
                    </button>
                </div>
            )}

            {slug && showCampaignUi && (
                <>
                    {layoutPreview && !isOfficial && (
                        <div
                            className="card"
                            role="status"
                            style={{
                                marginBottom: 16,
                                borderColor: 'rgba(217, 119, 6, 0.45)'
                            }}
                        >
                            <p style={{ fontSize: 14, margin: 0, color: 'var(--text-secondary)' }}>
                                <strong>Modo pré-visualização.</strong> Templates e campanha de exemplo mostram o layout; dados
                                reais de contactos e campanhas aparecem se já existirem neste workspace. Envios só após ligar a
                                API oficial.
                            </p>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ marginTop: 12 }}
                                onClick={() => setLayoutPreview(false)}
                            >
                                Sair da pré-visualização
                            </button>
                        </div>
                    )}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Nova campanha</span>
                            <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => refreshAll()}>
                                Atualizar listas
                            </button>
                        </div>
                        {!canManage && (
                            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                                Só owner/admin podem criar ou controlar campanhas.
                            </p>
                        )}
                        <div className="input-group" style={{ marginBottom: 12 }}>
                            <label className="input-label" htmlFor="bc-name">
                                Nome
                            </label>
                            <input
                                id="bc-name"
                                className="input"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Ex.: Promoção março"
                                disabled={!canManage || loading}
                            />
                        </div>
                        <div className="input-group" style={{ marginBottom: 12 }}>
                            <label className="input-label" htmlFor="bc-tpl">
                                Template aprovado
                            </label>
                            <select
                                id="bc-tpl"
                                className="input select"
                                value={tplKey}
                                onChange={e => setTplKey(e.target.value)}
                                disabled={!canManage || loading || tplLoading}
                            >
                                <option value="">{tplLoading ? 'A carregar…' : '— escolher —'}</option>
                                {approvedOptions.map(t => {
                                    const key = `${t.name}||${t.language || 'pt_BR'}`
                                    return (
                                        <option key={key} value={key}>
                                            {t.name} ({t.language}) — {t.status}
                                        </option>
                                    )
                                })}
                            </select>
                        </div>
                        <div className="input-group" style={{ marginBottom: 12 }}>
                            <label className="input-label" htmlFor="bc-comp">
                                Componentes (JSON Graph API)
                            </label>
                            <textarea
                                id="bc-comp"
                                className="input"
                                rows={4}
                                value={componentsJson}
                                onChange={e => setComponentsJson(e.target.value)}
                                disabled={!canManage || loading}
                                placeholder='Ex.: [{"type":"body","parameters":[{"type":"text","text":"João"}]}]'
                            />
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                                Se o template não tiver variáveis, deixa <code>[]</code>.
                            </p>
                        </div>
                        <div className="input-group" style={{ marginBottom: 12 }}>
                            <label className="input-label" htmlFor="bc-sched">
                                Início dos envios (opcional)
                            </label>
                            <input
                                id="bc-sched"
                                type="datetime-local"
                                className="input"
                                value={scheduledLocal}
                                onChange={e => setScheduledLocal(e.target.value)}
                                disabled={!canManage || loading}
                            />
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                                Vazio = já (ou quando iniciares manualmente). Com data futura e &quot;Criar e iniciar&quot;, a
                                campanha fica agendada.
                            </p>
                        </div>
                        <div className="input-group" style={{ marginBottom: 12 }}>
                            <label className="input-label" htmlFor="bc-cap">
                                Máximo de envios por dia (opcional)
                            </label>
                            <input
                                id="bc-cap"
                                type="number"
                                min={1}
                                className="input"
                                value={maxSendsPerDay}
                                onChange={e => setMaxSendsPerDay(e.target.value)}
                                placeholder="Ex.: 200"
                                disabled={!canManage || loading}
                            />
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                                Limite por dia civil no timezone abaixo. Vazio = sem limite.
                            </p>
                        </div>
                        <div className="input-group" style={{ marginBottom: 12 }}>
                            <label className="input-label" htmlFor="bc-tz">
                                Timezone do limite diário
                            </label>
                            <select
                                id="bc-tz"
                                className="input select"
                                value={TIMEZONE_PRESETS.includes(sendTimezone) ? sendTimezone : 'Europe/Lisbon'}
                                onChange={e => setSendTimezone(e.target.value)}
                                disabled={!canManage || loading}
                            >
                                {TIMEZONE_PRESETS.map(tz => (
                                    <option key={tz} value={tz}>
                                        {tz}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="input-group" style={{ marginBottom: 8 }}>
                            <label className="input-label" htmlFor="bc-filter">
                                Pesquisar contactos (servidor)
                            </label>
                            <input
                                id="bc-filter"
                                className="input"
                                value={contactSearchInput}
                                onChange={e => setContactSearchInput(e.target.value)}
                                placeholder="Nome ou telefone"
                                disabled={!canManage || loading}
                            />
                        </div>
                        <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv,text/csv"
                                style={{ display: 'none' }}
                                onChange={onPickImportFile}
                            />
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: 13 }}
                                disabled={!canManage || loading || importing}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {importing ? 'A importar…' : 'Importar CSV'}
                            </button>
                            <a
                                href="/examples/contacts-import-sample.csv"
                                download="contacts-import-sample.csv"
                                className="btn btn-secondary"
                                style={{
                                    fontSize: 13,
                                    textDecoration: 'none',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    lineHeight: 1.2
                                }}
                            >
                                Descarregar modelo CSV
                            </a>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: 13 }}
                                disabled={!canManage || loading}
                                onClick={() => selectAllOnPage()}
                            >
                                Selecionar página ({displayContacts.length})
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: 13 }}
                                disabled={!canManage || loading}
                                onClick={() => selectAllMatchingFilter()}
                            >
                                Selecionar até 2000 (filtro actual)
                            </button>
                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                Selecionados: {selectedIds.size} · Total contactos: {contactsTotal || displayContacts.length}
                            </span>
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 8,
                                alignItems: 'center',
                                marginBottom: 8,
                                fontSize: 13,
                                color: 'var(--text-secondary)'
                            }}
                        >
                            <span>
                                Página {contactPageIndex} / {contactPages}
                            </span>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: 12 }}
                                disabled={contactOffset <= 0 || loading || layoutPreview}
                                onClick={() => setContactOffset(o => Math.max(0, o - CONTACT_PAGE))}
                            >
                                Anterior
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: 12 }}
                                disabled={
                                    layoutPreview ||
                                    loading ||
                                    contactOffset + CONTACT_PAGE >= contactsTotal
                                }
                                onClick={() => setContactOffset(o => o + CONTACT_PAGE)}
                            >
                                Seguinte
                            </button>
                        </div>
                        <div
                            style={{
                                maxHeight: 220,
                                overflowY: 'auto',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                padding: 8,
                                marginBottom: 12
                            }}
                        >
                            {displayContacts.map(c => (
                                <label
                                    key={c.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        fontSize: 14,
                                        padding: '4px 0',
                                        cursor: canManage ? 'pointer' : 'default'
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(c.id)}
                                        onChange={() => toggleContact(c.id)}
                                        disabled={!canManage || loading}
                                    />
                                    <span>
                                        {c.name} — {c.phone}
                                    </span>
                                </label>
                            ))}
                            {displayContacts.length === 0 && (
                                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Sem contactos.</p>
                            )}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={!actionsLive || loading}
                                onClick={() => submit(false)}
                            >
                                Criar rascunho
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                disabled={!actionsLive || loading}
                                onClick={() => submit(true)}
                            >
                                Criar e iniciar
                            </button>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Templates na Meta</span>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                                        <th style={{ padding: '8px 4px' }}>Nome</th>
                                        <th style={{ padding: '8px 4px' }}>Idioma</th>
                                        <th style={{ padding: '8px 4px' }}>Estado</th>
                                        <th style={{ padding: '8px 4px' }}>Categoria</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayTemplates.map((t, i) => {
                                        const key = t.id || `${t.name}-${t.language}-${i}`
                                        return (
                                            <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ padding: '8px 4px' }}>{t.name}</td>
                                                <td style={{ padding: '8px 4px' }}>{t.language}</td>
                                                <td style={{ padding: '8px 4px' }}>{t.status}</td>
                                                <td style={{ padding: '8px 4px' }}>{t.category}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                            {displayTemplates.length === 0 && !tplLoading && (
                                <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>Nenhum template devolvido pela Meta.</p>
                            )}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Campanhas</span>
                        </div>
                        {displayBroadcasts.length === 0 && (
                            <p style={{ color: 'var(--text-secondary)' }}>Ainda não há campanhas.</p>
                        )}
                        {displayBroadcasts.map(b => (
                            <div
                                key={b.id}
                                style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: 12,
                                    marginBottom: 10
                                }}
                            >
                                <div style={{ fontWeight: 600 }}>{b.name}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                                    Template: {b.template_name} ({b.template_language}) · Estado: <strong>{b.status}</strong>
                                    {b.scheduled_at && (
                                        <>
                                            {' '}
                                            · Agendado: {new Date(b.scheduled_at).toLocaleString()}
                                        </>
                                    )}
                                </div>
                                <div style={{ fontSize: 13, marginTop: 4 }}>
                                    Enviados: {b.sent_count} · Falhas: {b.failed_count} · Pendentes: {b.pending_count}
                                </div>
                                {slug && (
                                    <BroadcastDayStats
                                        slug={slug}
                                        broadcastId={b.id}
                                        maxDay={b.max_sends_per_day}
                                        tz={b.send_timezone}
                                    />
                                )}
                                {canManage && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                                        {(b.status === 'draft' || b.status === 'paused') && (
                                            <button
                                                type="button"
                                                className="btn btn-primary"
                                                style={{ fontSize: 13 }}
                                                disabled={loading || !isOfficial}
                                                title={!isOfficial ? 'Disponível após conectar Meta oficial' : undefined}
                                                onClick={() => patchBroadcast(b.id, b.status === 'paused' ? 'resume' : 'start')}
                                            >
                                                {b.status === 'paused' ? 'Retomar' : 'Iniciar'}
                                            </button>
                                        )}
                                        {b.status === 'running' && (
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                style={{ fontSize: 13 }}
                                                disabled={loading || !isOfficial}
                                                title={!isOfficial ? 'Disponível após conectar Meta oficial' : undefined}
                                                onClick={() => patchBroadcast(b.id, 'pause')}
                                            >
                                                Pausar
                                            </button>
                                        )}
                                        {['draft', 'scheduled', 'running', 'paused'].includes(b.status) && (
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                style={{ fontSize: 13 }}
                                                disabled={loading || !isOfficial}
                                                title={!isOfficial ? 'Disponível após conectar Meta oficial' : undefined}
                                                onClick={() => patchBroadcast(b.id, 'cancel')}
                                            >
                                                Cancelar
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
                        Agenda o cron <code>GET /api/cron/whatsapp-broadcast-queue</code> com o header{' '}
                        <code>Authorization: Bearer INTERNAL_AI_SECRET</code> (ou <code>INTERNAL_BROADCAST_SECRET</code>). Para
                        tetos diários suaves, corre o job a cada 1–5 minutos.
                    </p>
                </>
            )}
        </>
    )
}
