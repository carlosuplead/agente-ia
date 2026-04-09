'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDashboard } from './dashboard-context'
import {
    Upload,
    Download,
    Search,
    Users,
    Send,
    FileText,
    CheckSquare,
    Megaphone,
    Clock,
    ChevronLeft,
    ChevronRight,
    RefreshCw,
    Play,
    Pause,
    XCircle,
    Zap
} from 'lucide-react'

type MetaTpl = {
    id?: string
    name: string
    language?: string
    status?: string
    category?: string
}

type ContactRow = { id: string; phone: string; name: string; avatar_url?: string | null }

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
            <div className="broadcast-day-stat">
                Hoje ({tz || 'Europe/Lisbon'}): … / {maxDay}
            </div>
        )
    }
    return (
        <div className="broadcast-day-stat">
            Enviados hoje ({tz || 'Europe/Lisbon'}): <strong>{sentToday}</strong> / {maxDay}
        </div>
    )
}

function statusBadgeClass(status: string): string {
    switch (status) {
        case 'running': return 'status-badge connected'
        case 'completed': return 'status-badge connected'
        case 'paused': return 'status-badge connecting'
        case 'draft': return 'status-badge'
        case 'scheduled': return 'status-badge connecting'
        case 'cancelled':
        case 'failed': return 'status-badge disconnected'
        default: return 'status-badge'
    }
}

function statusLabel(status: string): string {
    const map: Record<string, string> = {
        draft: 'Rascunho',
        scheduled: 'Agendado',
        running: 'Em execução',
        paused: 'Pausado',
        completed: 'Concluído',
        cancelled: 'Cancelado',
        failed: 'Falhou'
    }
    return map[status] || status
}

export function DisparosTab() {
    const d = useDashboard()
    const slug = d.selectedSlug
    const canManage = d.canEditWorkspaceIdentity(slug)
    const isOfficial = d.instance?.provider === 'official' && d.instance?.status === 'connected'
    const isConnected = d.instance?.status === 'connected'
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

    // Campaign form
    const [name, setName] = useState('')
    const [tplKey, setTplKey] = useState('')
    const [componentsJson, setComponentsJson] = useState('[]')
    const [scheduledLocal, setScheduledLocal] = useState('')
    const [maxSendsPerDay, setMaxSendsPerDay] = useState('')
    const [sendTimezone, setSendTimezone] = useState('Europe/Lisbon')

    // Quick send form
    const [quickMessage, setQuickMessage] = useState('')
    const [quickSending, setQuickSending] = useState(false)

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    // Active section tab
    const [activeSection, setActiveSection] = useState<'contacts' | 'quick' | 'campaign' | 'history'>('contacts')

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
        try {
            const res = await fetch(`/api/workspace/contacts?${q}`, { credentials: 'include' })
            if (!res.ok) { setContacts([]); setContactsTotal(0); return }
            const j = await res.json().catch(() => ({}))
            setContacts(Array.isArray(j.contacts) ? j.contacts : [])
            setContactsTotal(typeof j.total === 'number' ? j.total : 0)
        } catch {
            setContacts([])
            setContactsTotal(0)
        }
    }, [slug, contactOffset, contactSearchDebounced])

    const loadBroadcasts = useCallback(async () => {
        if (!slug) {
            setBroadcasts([])
            return
        }
        try {
            const res = await fetch(
                `/api/whatsapp/broadcasts?workspace_slug=${encodeURIComponent(slug)}`,
                { credentials: 'include' }
            )
            if (!res.ok) { setBroadcasts([]); return }
            const j = await res.json().catch(() => ({}))
            setBroadcasts(Array.isArray(j.broadcasts) ? j.broadcasts : [])
        } catch {
            setBroadcasts([])
        }
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

    // Re-load contacts when offset/search changes (without full refresh)
    useEffect(() => {
        if (slug) void loadContacts()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contactOffset, contactSearchDebounced])

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

    function selectAllOnPage() {
        setSelectedIds(prev => {
            const n = new Set(prev)
            for (const c of contacts) {
                if (!c.id.startsWith('preview-')) n.add(c.id)
            }
            return n
        })
    }

    function deselectAll() {
        setSelectedIds(new Set())
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
                message: `${list.length} contacto(s) selecionados.`,
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
                message: `Importação concluída: ${up} contacto(s) guardados.${errN ? ` ${errN} avisos.` : ''}`,
                variant: errN ? 'error' : 'success'
            })
            await loadContacts()
        } finally {
            setImporting(false)
        }
    }

    // ── Quick Send (Uazapi or any provider) ──
    async function quickSend() {
        if (!slug || !canManage || !isConnected) return
        const ids = [...selectedIds].filter(id => !id.startsWith('preview-'))
        if (ids.length === 0) {
            d.setToast({ message: 'Selecione pelo menos um contacto.', variant: 'error' })
            return
        }
        if (!quickMessage.trim()) {
            d.setToast({ message: 'Escreva uma mensagem.', variant: 'error' })
            return
        }
        if (ids.length > 50) {
            d.setToast({ message: 'Envio rápido suporta até 50 contactos. Para mais, use campanhas.', variant: 'error' })
            return
        }

        setQuickSending(true)
        try {
            const res = await fetch('/api/whatsapp/broadcast-quick', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspace_slug: slug,
                    contact_ids: ids,
                    message: quickMessage.trim()
                })
            })
            const j = await res.json().catch(() => ({}))
            if (!res.ok) {
                d.setToast({ message: (j as { error?: string }).error || 'Falha no envio', variant: 'error' })
                return
            }
            const sent = (j as { sent?: number }).sent ?? 0
            const failed = (j as { failed?: number }).failed ?? 0
            d.setToast({
                message: `Envio rápido: ${sent} enviados${failed > 0 ? `, ${failed} falharam` : ''}.`,
                variant: failed > 0 ? 'error' : 'success'
            })
            setQuickMessage('')
            setSelectedIds(new Set())
        } finally {
            setQuickSending(false)
        }
    }

    // ── Template Campaign Submit ──
    async function submit(start: boolean) {
        if (!slug || !canManage) return
        if (!isOfficial) {
            d.setToast({
                message: 'Conecte o WhatsApp Meta oficial para criar campanhas com templates.',
                variant: 'error'
            })
            return
        }
        const parts = tplKey.split('||')
        const template_name = parts[0]
        const template_language = parts[1] || 'pt_BR'
        if (!template_name) {
            d.setToast({ message: 'Escolha um template aprovado.', variant: 'error' })
            return
        }
        let template_components: unknown = []
        try {
            template_components = JSON.parse(componentsJson || '[]')
            if (!Array.isArray(template_components)) throw new Error('must be array')
        } catch {
            d.setToast({
                message: 'JSON dos componentes inválido (use [] se o template não tiver variáveis).',
                variant: 'error'
            })
            return
        }
        const contact_ids = [...selectedIds].filter(id => !id.startsWith('preview-'))
        if (contact_ids.length === 0) {
            d.setToast({ message: 'Selecione pelo menos um contacto.', variant: 'error' })
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
            if (st === 'scheduled') msg = 'Campanha agendada com sucesso.'
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
                message: 'Conecte o WhatsApp Meta oficial para controlar campanhas.',
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
            d.setToast({ message: `Campanha ${action === 'start' ? 'iniciada' : action === 'pause' ? 'pausada' : action === 'resume' ? 'retomada' : 'cancelada'}.`, variant: 'success' })
            await loadBroadcasts()
        } finally {
            setLoading(false)
        }
    }

    const displayTemplates = isOfficial ? templates : layoutPreview ? PREVIEW_TEMPLATES : []
    const displayContacts = contacts.length > 0 ? contacts : layoutPreview ? PREVIEW_CONTACTS : []
    const displayBroadcasts = broadcasts.length > 0 ? broadcasts : layoutPreview ? PREVIEW_BROADCASTS : []

    const approvedOptions = displayTemplates.filter(t => String(t.status || '').toUpperCase() === 'APPROVED')
    const actionsLive = isOfficial && canManage

    const contactPages = Math.max(1, Math.ceil(contactsTotal / CONTACT_PAGE) || 1)
    const contactPageIndex = Math.floor(contactOffset / CONTACT_PAGE) + 1

    // Stats for campaign summary
    const totalSent = displayBroadcasts.reduce((s, b) => s + b.sent_count, 0)
    const totalFailed = displayBroadcasts.reduce((s, b) => s + b.failed_count, 0)
    const totalPending = displayBroadcasts.reduce((s, b) => s + b.pending_count, 0)
    const successRate = totalSent + totalFailed > 0
        ? ((totalSent / (totalSent + totalFailed)) * 100).toFixed(1)
        : '—'

    if (!slug) {
        return (
            <>
                <div className="page-header">
                    <h2>Disparos</h2>
                    <p className="page-subtitle">Selecione um workspace para gerir contactos e disparos.</p>
                </div>
            </>
        )
    }

    return (
        <>
            <div className="page-header">
                <div className="page-header-row">
                    <div>
                        <h2>Disparos</h2>
                        <p className="page-subtitle">
                            Gerir contactos, envios rápidos e campanhas em massa
                        </p>
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        disabled={loading}
                        onClick={() => refreshAll()}
                    >
                        <RefreshCw size={14} />
                        Atualizar
                    </button>
                </div>
            </div>

            {/* ── Stats Summary ── */}
            <div className="disparos-stats">
                <div className="disparos-stat-item">
                    <span className="disparos-stat-value">{contactsTotal}</span>
                    <span className="disparos-stat-label">Contactos</span>
                </div>
                <div className="disparos-stat-item">
                    <span className="disparos-stat-value">{selectedIds.size}</span>
                    <span className="disparos-stat-label">Selecionados</span>
                </div>
                <div className="disparos-stat-item">
                    <span className="disparos-stat-value">{displayBroadcasts.length}</span>
                    <span className="disparos-stat-label">Campanhas</span>
                </div>
                <div className="disparos-stat-item">
                    <span className="disparos-stat-value disparos-stat-value--green">{totalSent.toLocaleString()}</span>
                    <span className="disparos-stat-label">Enviados</span>
                </div>
                <div className="disparos-stat-item">
                    <span className="disparos-stat-value disparos-stat-value--orange">{totalPending.toLocaleString()}</span>
                    <span className="disparos-stat-label">Pendentes</span>
                </div>
                <div className="disparos-stat-item">
                    <span className="disparos-stat-value">{successRate}{successRate !== '—' ? '%' : ''}</span>
                    <span className="disparos-stat-label">Taxa sucesso</span>
                </div>
            </div>

            {/* ── Section Tabs ── */}
            <div className="disparos-tabs">
                <button
                    type="button"
                    className={`disparos-tab ${activeSection === 'contacts' ? 'disparos-tab--active' : ''}`}
                    onClick={() => setActiveSection('contacts')}
                >
                    <Users size={15} />
                    Contactos
                </button>
                <button
                    type="button"
                    className={`disparos-tab ${activeSection === 'quick' ? 'disparos-tab--active' : ''}`}
                    onClick={() => setActiveSection('quick')}
                >
                    <Zap size={15} />
                    Envio Rápido
                </button>
                <button
                    type="button"
                    className={`disparos-tab ${activeSection === 'campaign' ? 'disparos-tab--active' : ''}`}
                    onClick={() => setActiveSection('campaign')}
                >
                    <Megaphone size={15} />
                    Campanhas
                </button>
                <button
                    type="button"
                    className={`disparos-tab ${activeSection === 'history' ? 'disparos-tab--active' : ''}`}
                    onClick={() => setActiveSection('history')}
                >
                    <Clock size={15} />
                    Histórico
                </button>
            </div>

            {/* ════════════════════════════════════════════════
                Section: CONTACTS MANAGEMENT (always visible)
               ════════════════════════════════════════════════ */}
            {activeSection === 'contacts' && (
                <div className="card">
                    <div className="card-header">
                        <div className="card-header-left">
                            <div className="card-header-icon card-header-icon--blue">
                                <Users size={16} />
                            </div>
                            <span className="card-title">Gestão de Contactos</span>
                        </div>
                    </div>

                    {/* Import actions */}
                    <div className="disparos-actions-bar">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                            style={{ display: 'none' }}
                            onChange={onPickImportFile}
                        />
                        <button
                            type="button"
                            className="btn btn-primary"
                            disabled={!canManage || importing}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload size={15} />
                            {importing ? 'A importar…' : 'Importar CSV/Excel'}
                        </button>
                        <a
                            href="/examples/contacts-import-sample.csv"
                            download="contacts-import-sample.csv"
                            className="btn btn-secondary"
                        >
                            <Download size={15} />
                            Modelo CSV
                        </a>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={!canManage || loading}
                            onClick={selectAllOnPage}
                        >
                            <CheckSquare size={15} />
                            Selecionar página ({contacts.length})
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={!canManage || loading}
                            onClick={selectAllMatchingFilter}
                        >
                            Selecionar todos (até 2000)
                        </button>
                        {selectedIds.size > 0 && (
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={deselectAll}
                            >
                                Limpar seleção
                            </button>
                        )}
                    </div>

                    {/* Search */}
                    <div className="disparos-search">
                        <Search size={16} className="disparos-search-icon" />
                        <input
                            className="input disparos-search-input"
                            value={contactSearchInput}
                            onChange={e => setContactSearchInput(e.target.value)}
                            placeholder="Pesquisar por nome ou telefone…"
                            disabled={!canManage || loading}
                        />
                    </div>

                    {/* Contacts list */}
                    <div className="disparos-contact-list">
                        {displayContacts.map(c => {
                            const isPreview = c.id.startsWith('preview-')
                            return (
                                <label
                                    key={c.id}
                                    className={`disparos-contact-row ${selectedIds.has(c.id) ? 'disparos-contact-row--selected' : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(c.id)}
                                        onChange={() => toggleContact(c.id)}
                                        disabled={!canManage || loading || isPreview}
                                    />
                                    <div className="disparos-contact-avatar">
                                        {c.avatar_url
                                            ? <img src={c.avatar_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                                            : (c.name?.[0]?.toUpperCase() || '?')
                                        }
                                    </div>
                                    <div className="disparos-contact-info">
                                        <span className="disparos-contact-name">{c.name || 'Sem nome'}</span>
                                        <span className="disparos-contact-phone">{c.phone}</span>
                                    </div>
                                </label>
                            )
                        })}
                        {displayContacts.length === 0 && !loading && (
                            <div className="disparos-empty">
                                <FileText size={24} />
                                <p>Nenhum contacto encontrado.</p>
                                <p>Importe um ficheiro CSV para adicionar contactos.</p>
                            </div>
                        )}
                    </div>

                    {/* Pagination */}
                    <div className="disparos-pagination">
                        <span className="disparos-pagination-info">
                            Página {contactPageIndex} de {contactPages} — {contactsTotal} contacto(s)
                        </span>
                        <div className="disparos-pagination-btns">
                            <button
                                type="button"
                                className="btn btn-secondary btn-compact"
                                disabled={contactOffset <= 0 || loading}
                                onClick={() => setContactOffset(o => Math.max(0, o - CONTACT_PAGE))}
                            >
                                <ChevronLeft size={14} />
                                Anterior
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary btn-compact"
                                disabled={loading || contactOffset + CONTACT_PAGE >= contactsTotal}
                                onClick={() => setContactOffset(o => o + CONTACT_PAGE)}
                            >
                                Seguinte
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>

                    <div className="disparos-import-hint">
                        <FileText size={14} />
                        <span>
                            O ficheiro CSV deve ter colunas <code className="inline-code">phone</code> e opcionalmente <code className="inline-code">name</code>.
                            Separador: vírgula ou ponto-e-vírgula. Máx 5000 linhas.
                        </span>
                    </div>
                </div>
            )}

            {/* ════════════════════════════════════════════════
                Section: QUICK SEND (any connected provider)
               ════════════════════════════════════════════════ */}
            {activeSection === 'quick' && (
                <div className="card">
                    <div className="card-header">
                        <div className="card-header-left">
                            <div className="card-header-icon card-header-icon--green">
                                <Zap size={16} />
                            </div>
                            <span className="card-title">Envio Rápido</span>
                        </div>
                    </div>

                    {!isConnected ? (
                        <div className="disparos-empty">
                            <Send size={24} />
                            <p>Conecte o WhatsApp para enviar mensagens.</p>
                            <p>Vá ao separador WhatsApp e conecte via QR Code ou API oficial.</p>
                        </div>
                    ) : (
                        <>
                            <p className="disparos-section-desc">
                                Envie uma mensagem de texto para os contactos selecionados (máx. 50 por vez).
                                Selecione contactos no separador &quot;Contactos&quot; e escreva a mensagem abaixo.
                            </p>

                            <div className="disparos-quick-selected">
                                <Users size={15} />
                                <span>
                                    {selectedIds.size === 0
                                        ? 'Nenhum contacto selecionado — vá a "Contactos" para selecionar'
                                        : `${selectedIds.size} contacto(s) selecionado(s)`
                                    }
                                </span>
                                {selectedIds.size > 0 && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-compact"
                                        onClick={deselectAll}
                                    >
                                        Limpar
                                    </button>
                                )}
                            </div>

                            <div className="input-group" style={{ marginBottom: 16 }}>
                                <label className="input-label" htmlFor="quick-msg">
                                    Mensagem
                                </label>
                                <textarea
                                    id="quick-msg"
                                    className="input textarea"
                                    rows={4}
                                    value={quickMessage}
                                    onChange={e => setQuickMessage(e.target.value)}
                                    placeholder="Escreva a mensagem para enviar a todos os contactos selecionados…"
                                    disabled={!canManage || quickSending}
                                    style={{ minHeight: 100 }}
                                />
                            </div>

                            <button
                                type="button"
                                className="btn btn-primary"
                                disabled={!canManage || quickSending || selectedIds.size === 0 || !quickMessage.trim()}
                                onClick={quickSend}
                            >
                                <Send size={15} />
                                {quickSending ? 'Enviando…' : `Enviar para ${selectedIds.size} contacto(s)`}
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* ════════════════════════════════════════════════
                Section: TEMPLATE CAMPAIGNS (Meta Official)
               ════════════════════════════════════════════════ */}
            {activeSection === 'campaign' && (
                <>
                    {!isOfficial && !layoutPreview && (
                        <div className="card">
                            <div className="card-header">
                                <div className="card-header-left">
                                    <div className="card-header-icon card-header-icon--purple">
                                        <Megaphone size={16} />
                                    </div>
                                    <span className="card-title">Campanhas com Templates</span>
                                </div>
                            </div>
                            <div className="disparos-empty">
                                <Megaphone size={24} />
                                <p>As campanhas em massa usam templates aprovados pela Meta.</p>
                                <p>
                                    Conecte o WhatsApp com &quot;Conectar Meta Oficial&quot; no separador WhatsApp
                                    para criar campanhas com templates.
                                </p>
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setLayoutPreview(true)}
                                    style={{ marginTop: 8 }}
                                >
                                    Pré-visualizar interface
                                </button>
                            </div>
                        </div>
                    )}

                    {(isOfficial || layoutPreview) && (
                        <>
                            {layoutPreview && !isOfficial && (
                                <div className="card disparos-preview-banner">
                                    <p>
                                        <strong>Modo pré-visualização.</strong> Templates e dados de exemplo. Envios reais
                                        só após ligar a API oficial.
                                    </p>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-compact"
                                        onClick={() => setLayoutPreview(false)}
                                    >
                                        Sair
                                    </button>
                                </div>
                            )}

                            <div className="card">
                                <div className="card-header">
                                    <div className="card-header-left">
                                        <div className="card-header-icon card-header-icon--purple">
                                            <Megaphone size={16} />
                                        </div>
                                        <span className="card-title">Nova Campanha</span>
                                    </div>
                                </div>

                                {!canManage && (
                                    <p className="disparos-section-desc">
                                        Só owner/admin podem criar ou controlar campanhas.
                                    </p>
                                )}

                                <div className="input-group" style={{ marginBottom: 12 }}>
                                    <label className="input-label" htmlFor="bc-name">Nome</label>
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
                                    <label className="input-label" htmlFor="bc-tpl">Template aprovado</label>
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
                                        Componentes (JSON)
                                    </label>
                                    <textarea
                                        id="bc-comp"
                                        className="input"
                                        rows={3}
                                        value={componentsJson}
                                        onChange={e => setComponentsJson(e.target.value)}
                                        disabled={!canManage || loading}
                                        placeholder='[{"type":"body","parameters":[{"type":"text","text":"João"}]}]'
                                    />
                                    <p className="input-hint">
                                        Se o template não tiver variáveis, deixe <code className="inline-code">[]</code>.
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
                                    <p className="input-hint">
                                        Vazio = inicia imediatamente ou manualmente.
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
                                </div>

                                <div className="input-group" style={{ marginBottom: 16 }}>
                                    <label className="input-label" htmlFor="bc-tz">
                                        Timezone
                                    </label>
                                    <select
                                        id="bc-tz"
                                        className="input select"
                                        value={TIMEZONE_PRESETS.includes(sendTimezone) ? sendTimezone : 'Europe/Lisbon'}
                                        onChange={e => setSendTimezone(e.target.value)}
                                        disabled={!canManage || loading}
                                    >
                                        {TIMEZONE_PRESETS.map(tz => (
                                            <option key={tz} value={tz}>{tz}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="disparos-quick-selected" style={{ marginBottom: 16 }}>
                                    <Users size={15} />
                                    <span>
                                        {selectedIds.size === 0
                                            ? 'Selecione contactos no separador "Contactos"'
                                            : `${selectedIds.size} contacto(s) selecionado(s)`
                                        }
                                    </span>
                                </div>

                                <div className="disparos-actions-bar">
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
                                        <Play size={15} />
                                        Criar e iniciar
                                    </button>
                                </div>
                            </div>

                            {/* Templates Table */}
                            <div className="card">
                                <div className="card-header">
                                    <div className="card-header-left">
                                        <div className="card-header-icon card-header-icon--blue">
                                            <FileText size={16} />
                                        </div>
                                        <span className="card-title">Templates na Meta</span>
                                    </div>
                                </div>
                                <div className="disparos-table-wrap">
                                    <table className="disparos-table">
                                        <thead>
                                            <tr>
                                                <th>Nome</th>
                                                <th>Idioma</th>
                                                <th>Estado</th>
                                                <th>Categoria</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {displayTemplates.map((t, i) => {
                                                const key = t.id || `${t.name}-${t.language}-${i}`
                                                return (
                                                    <tr key={key}>
                                                        <td>{t.name}</td>
                                                        <td>{t.language}</td>
                                                        <td>
                                                            <span className={`disparos-tpl-badge ${t.status === 'APPROVED' ? 'disparos-tpl-badge--approved' : t.status === 'PENDING' ? 'disparos-tpl-badge--pending' : 'disparos-tpl-badge--rejected'}`}>
                                                                {t.status}
                                                            </span>
                                                        </td>
                                                        <td>{t.category}</td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                    {displayTemplates.length === 0 && !tplLoading && (
                                        <p className="disparos-section-desc">
                                            Nenhum template devolvido pela Meta.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </>
            )}

            {/* ════════════════════════════════════════════════
                Section: CAMPAIGN HISTORY
               ════════════════════════════════════════════════ */}
            {activeSection === 'history' && (
                <div className="card">
                    <div className="card-header">
                        <div className="card-header-left">
                            <div className="card-header-icon card-header-icon--orange">
                                <Clock size={16} />
                            </div>
                            <span className="card-title">Histórico de Campanhas</span>
                        </div>
                    </div>

                    {displayBroadcasts.length === 0 && (
                        <div className="disparos-empty">
                            <Megaphone size={24} />
                            <p>Ainda não há campanhas criadas.</p>
                        </div>
                    )}

                    {displayBroadcasts.map(b => (
                        <div key={b.id} className="disparos-campaign-card">
                            <div className="disparos-campaign-header">
                                <div className="disparos-campaign-title">{b.name}</div>
                                <span className={statusBadgeClass(b.status)}>
                                    <span className="status-dot" aria-hidden="true" />
                                    {statusLabel(b.status)}
                                </span>
                            </div>

                            <div className="disparos-campaign-meta">
                                Template: {b.template_name} ({b.template_language})
                                {b.scheduled_at && (
                                    <>
                                        {' · '}Agendado: {new Date(b.scheduled_at).toLocaleString()}
                                    </>
                                )}
                            </div>

                            <div className="disparos-campaign-stats">
                                <div className="disparos-campaign-stat">
                                    <span className="disparos-campaign-stat-val disparos-campaign-stat-val--green">{b.sent_count}</span>
                                    <span className="disparos-campaign-stat-lbl">Enviados</span>
                                </div>
                                <div className="disparos-campaign-stat">
                                    <span className="disparos-campaign-stat-val disparos-campaign-stat-val--red">{b.failed_count}</span>
                                    <span className="disparos-campaign-stat-lbl">Falhas</span>
                                </div>
                                <div className="disparos-campaign-stat">
                                    <span className="disparos-campaign-stat-val disparos-campaign-stat-val--orange">{b.pending_count}</span>
                                    <span className="disparos-campaign-stat-lbl">Pendentes</span>
                                </div>
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
                                <div className="disparos-campaign-actions">
                                    {(b.status === 'draft' || b.status === 'paused') && (
                                        <button
                                            type="button"
                                            className="btn btn-primary btn-compact"
                                            disabled={loading || !isOfficial}
                                            title={!isOfficial ? 'Disponível após conectar Meta oficial' : undefined}
                                            onClick={() => patchBroadcast(b.id, b.status === 'paused' ? 'resume' : 'start')}
                                        >
                                            <Play size={13} />
                                            {b.status === 'paused' ? 'Retomar' : 'Iniciar'}
                                        </button>
                                    )}
                                    {b.status === 'running' && (
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-compact"
                                            disabled={loading || !isOfficial}
                                            onClick={() => patchBroadcast(b.id, 'pause')}
                                        >
                                            <Pause size={13} />
                                            Pausar
                                        </button>
                                    )}
                                    {['draft', 'scheduled', 'running', 'paused'].includes(b.status) && (
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-compact"
                                            disabled={loading || !isOfficial}
                                            onClick={() => patchBroadcast(b.id, 'cancel')}
                                            style={{ color: 'var(--red)' }}
                                        >
                                            <XCircle size={13} />
                                            Cancelar
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}

                    {d.isPlatformAdmin && (
                        <div className="disparos-cron-hint">
                            Cron N8N: <code className="inline-code">GET /api/cron/whatsapp-broadcast-queue</code> a cada 3 min
                            com header <code className="inline-code">Authorization: Bearer INTERNAL_AI_SECRET</code>.
                        </div>
                    )}
                </div>
            )}
        </>
    )
}
