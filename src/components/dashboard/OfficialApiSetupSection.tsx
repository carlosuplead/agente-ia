'use client'

import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { useDashboard } from './dashboard-context'

const META_WA_CREDENTIALS_DOCS =
    'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started#get-access-tokens'

export function OfficialApiSetupSection() {
    const d = useDashboard()
    const slug = d.selectedSlug
    const [showForm, setShowForm] = useState(false)
    const [phoneId, setPhoneId] = useState('')
    const [wabaId, setWabaId] = useState('')
    const [token, setToken] = useState('')
    const [showToken, setShowToken] = useState(false)
    const [officialBusy, setOfficialBusy] = useState(false)

    const instance = d.instance
    const isOfficialOnline =
        instance?.provider === 'official' && instance?.status === 'connected'

    useEffect(() => {
        setShowForm(false)
        setPhoneId('')
        setWabaId('')
        setToken('')
        setShowToken(false)
    }, [slug])

    function openForm() {
        setShowForm(true)
        if (instance?.provider === 'official') {
            setPhoneId(instance.phone_number_id || '')
            setWabaId(instance.waba_id || '')
        } else {
            setPhoneId('')
            setWabaId('')
        }
        setToken('')
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!slug) return
        setOfficialBusy(true)
        const res = await fetch('/api/whatsapp/configure-official', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspace_slug: slug,
                phone_number_id: phoneId,
                waba_id: wabaId,
                meta_access_token: token
            })
        })
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setOfficialBusy(false)
        if (!res.ok) {
            d.setToast({
                message: j.error || 'Não foi possível verificar ou guardar as credenciais.',
                variant: 'error'
            })
            return
        }
        d.setToast({ message: 'API oficial verificada e guardada.', variant: 'success' })
        setShowForm(false)
        setToken('')
        await d.loadInstance(slug, { syncUazapi: true })
    }

    const disableActions = officialBusy || d.busy

    return (
        <div className="card" style={{ marginTop: 16 }}>
            <div
                className="card-header"
                style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div
                        aria-hidden
                        style={{
                            width: 44,
                            height: 44,
                            borderRadius: 12,
                            background: 'rgba(52, 199, 89, 0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 22
                        }}
                    >
                        <Smartphone size={20} />
                    </div>
                    <div>
                        <div className="card-title" style={{ margin: 0 }}>
                            API Oficial (WABA)
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                            WhatsApp Cloud API
                        </p>
                    </div>
                </div>
                <span
                    className={`status-badge ${isOfficialOnline ? 'connected' : 'disconnected'}`}
                    style={{ marginLeft: 'auto' }}
                >
                    <span className="status-dot" aria-hidden />
                    {isOfficialOnline ? 'Online' : 'Offline'}
                </span>
            </div>

            {!showForm && (
                <div style={{ marginTop: 8 }}>
                    <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                        Conecte com Phone Number ID, Access Token permanente e WABA ID.
                    </p>
                    <button
                        type="button"
                        className="btn btn-primary"
                        disabled={disableActions || !slug}
                        onClick={openForm}
                    >
                        Configurar API oficial
                    </button>
                </div>
            )}

            {showForm && (
                <form onSubmit={onSubmit} style={{ marginTop: 16 }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 8,
                            marginBottom: 14
                        }}
                    >
                        <span className="card-title" style={{ fontSize: 15, margin: 0 }}>
                            Configurar API oficial
                        </span>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 13, padding: '6px 12px' }}
                            disabled={disableActions}
                            onClick={() => {
                                setShowForm(false)
                                setToken('')
                            }}
                        >
                            Voltar
                        </button>
                    </div>

                    <div className="input-group" style={{ marginBottom: 12 }}>
                        <label className="input-label" htmlFor="official-phone-number-id">
                            Phone Number ID
                        </label>
                        <input
                            id="official-phone-number-id"
                            className="input"
                            value={phoneId}
                            onChange={e => setPhoneId(e.target.value)}
                            placeholder="Phone Number ID"
                            autoComplete="off"
                            required
                        />
                    </div>

                    <div className="input-group" style={{ marginBottom: 12 }}>
                        <label className="input-label" htmlFor="official-access-token">
                            Access token (permanente)
                        </label>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                            <input
                                id="official-access-token"
                                className="input"
                                style={{ flex: 1 }}
                                value={token}
                                onChange={e => setToken(e.target.value)}
                                placeholder="Access Token (permanente)"
                                type={showToken ? 'text' : 'password'}
                                autoComplete="off"
                                required
                            />
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ flexShrink: 0 }}
                                onClick={() => setShowToken(v => !v)}
                                aria-pressed={showToken}
                            >
                                {showToken ? 'Ocultar' : 'Mostrar'}
                            </button>
                        </div>
                    </div>

                    <div className="input-group" style={{ marginBottom: 12 }}>
                        <label className="input-label" htmlFor="official-waba-id">
                            WABA ID
                        </label>
                        <input
                            id="official-waba-id"
                            className="input"
                            value={wabaId}
                            onChange={e => setWabaId(e.target.value)}
                            placeholder="WABA ID"
                            autoComplete="off"
                            required
                        />
                    </div>

                    <p style={{ marginBottom: 12 }}>
                        <a
                            href={META_WA_CREDENTIALS_DOCS}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 14, color: 'var(--accent)' }}
                        >
                            Como obter as credenciais (documentação Meta)
                        </a>
                    </p>

                    <button type="submit" className="btn btn-primary" disabled={disableActions}>
                        Verificar e salvar
                    </button>
                </form>
            )}
        </div>
    )
}
