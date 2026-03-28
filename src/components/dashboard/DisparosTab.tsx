'use client'

import { useCallback, useEffect, useState } from 'react'
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
}

export function DisparosTab() {
    const d = useDashboard()
    const slug = d.selectedSlug
    const canManage = d.canEditWorkspaceIdentity(slug)
    const isOfficial = d.instance?.provider === 'official' && d.instance?.status === 'connected'

    const [templates, setTemplates] = useState<MetaTpl[]>([])
    const [contacts, setContacts] = useState<ContactRow[]>([])
    const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([])
    const [loading, setLoading] = useState(false)
    const [tplLoading, setTplLoading] = useState(false)
    const [name, setName] = useState('')
    const [tplKey, setTplKey] = useState('')
    const [componentsJson, setComponentsJson] = useState('[]')
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [contactFilter, setContactFilter] = useState('')

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
            return
        }
        const res = await fetch(
            `/api/workspace/contacts?workspace_slug=${encodeURIComponent(slug)}&limit=500`,
            { credentials: 'include' }
        )
        const j = await res.json().catch(() => ({}))
        setContacts(Array.isArray(j.contacts) ? j.contacts : [])
    }, [slug])

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

    function toggleContact(id: string) {
        setSelectedIds(prev => {
            const n = new Set(prev)
            if (n.has(id)) n.delete(id)
            else n.add(id)
            return n
        })
    }

    function selectAllFiltered() {
        const f = contactFilter.trim().toLowerCase()
        const subset = contacts.filter(
            c => !f || c.name.toLowerCase().includes(f) || c.phone.replace(/\D/g, '').includes(f.replace(/\D/g, ''))
        )
        setSelectedIds(prev => {
            const n = new Set(prev)
            for (const c of subset) n.add(c.id)
            return n
        })
    }

    async function submit(start: boolean) {
        if (!slug || !canManage) return
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
            d.setToast({ message: 'JSON dos componentes inválido (usa [] se o template não tiver variáveis).', variant: 'error' })
            return
        }
        const contact_ids = [...selectedIds]
        if (contact_ids.length === 0) {
            d.setToast({ message: 'Seleciona pelo menos um contacto.', variant: 'error' })
            return
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
                    start
                })
            })
            const j = await res.json().catch(() => ({}))
            if (!res.ok) {
                d.setToast({ message: (j as { error?: string }).error || 'Falha ao criar', variant: 'error' })
                return
            }
            d.setToast({
                message: start ? 'Campanha criada e em execução.' : 'Campanha criada (rascunho). Inicia quando quiseres.',
                variant: 'success'
            })
            setName('')
            setSelectedIds(new Set())
            await loadBroadcasts()
        } finally {
            setLoading(false)
        }
    }

    async function patchBroadcast(id: string, action: 'start' | 'pause' | 'resume') {
        if (!slug) return
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

    const approvedOptions = templates.filter(t => String(t.status || '').toUpperCase() === 'APPROVED')
    const filteredContacts = contacts.filter(c => {
        const f = contactFilter.trim().toLowerCase()
        if (!f) return true
        return c.name.toLowerCase().includes(f) || c.phone.replace(/\D/g, '').includes(f.replace(/\D/g, ''))
    })

    return (
        <>
            <div className="page-header">
                <h2>Disparos (Meta oficial)</h2>
                <p>Campanhas com templates aprovados pela Meta e fila de envio.</p>
            </div>

            {!slug && (
                <p style={{ color: 'var(--text-secondary)' }}>Seleciona um workspace para gerir disparos.</p>
            )}

            {slug && !isOfficial && (
                <div className="card alert-card" role="alert">
                    <p className="alert-card-text">
                        Os disparos em massa usam só a API oficial. Liga o WhatsApp com &quot;Conectar Meta Oficial&quot; no
                        separador WhatsApp.
                    </p>
                </div>
            )}

            {slug && isOfficial && (
                <>
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
                        <div className="input-group" style={{ marginBottom: 8 }}>
                            <label className="input-label" htmlFor="bc-filter">
                                Filtrar contactos
                            </label>
                            <input
                                id="bc-filter"
                                className="input"
                                value={contactFilter}
                                onChange={e => setContactFilter(e.target.value)}
                                placeholder="Nome ou telefone"
                                disabled={!canManage || loading}
                            />
                        </div>
                        <div style={{ marginBottom: 8 }}>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: 13 }}
                                disabled={!canManage || loading}
                                onClick={selectAllFiltered}
                            >
                                Selecionar filtrados ({filteredContacts.length})
                            </button>
                            <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                                Selecionados: {selectedIds.size}
                            </span>
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
                            {filteredContacts.map(c => (
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
                            {filteredContacts.length === 0 && (
                                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Sem contactos.</p>
                            )}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={!canManage || loading}
                                onClick={() => submit(false)}
                            >
                                Criar rascunho
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                disabled={!canManage || loading}
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
                                    {templates.map((t, i) => {
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
                            {templates.length === 0 && !tplLoading && (
                                <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>Nenhum template devolvido pela Meta.</p>
                            )}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Campanhas</span>
                        </div>
                        {broadcasts.length === 0 && (
                            <p style={{ color: 'var(--text-secondary)' }}>Ainda não há campanhas.</p>
                        )}
                        {broadcasts.map(b => (
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
                                </div>
                                <div style={{ fontSize: 13, marginTop: 4 }}>
                                    Enviados: {b.sent_count} · Falhas: {b.failed_count} · Pendentes: {b.pending_count}
                                </div>
                                {canManage && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                                        {(b.status === 'draft' || b.status === 'paused') && (
                                            <button
                                                type="button"
                                                className="btn btn-primary"
                                                style={{ fontSize: 13 }}
                                                disabled={loading}
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
                                                disabled={loading}
                                                onClick={() => patchBroadcast(b.id, 'pause')}
                                            >
                                                Pausar
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
                        Agenda o cron <code>GET /api/cron/whatsapp-broadcast-queue</code> com o header{' '}
                        <code>Authorization: Bearer INTERNAL_AI_SECRET</code> (igual ao follow-up).
                    </p>
                </>
            )}
        </>
    )
}
