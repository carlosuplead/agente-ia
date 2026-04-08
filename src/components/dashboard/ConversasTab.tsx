'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDashboard } from './dashboard-context'
import {
    MessageSquare,
    Send,
    Pause,
    Play,
    StickyNote,
    Image,
    Video,
    Mic,
    Paperclip,
    ArrowLeft,
    Bot,
    User,
    Phone,
    Search,
    X
} from 'lucide-react'
import type { ConversationListItem } from '@/app/api/workspace/conversations/route'

type ChatMsg = {
    id: string
    body: string | null
    sender_type: string
    status: string
    media_url: string | null
    media_type: string | null
    created_at: string
}

type ContactInfo = {
    id: string
    phone: string
    name: string
    avatar_url: string | null
}

type ConvInfo = {
    id: string
    status: string
    handoff_reason: string | null
    internal_notes: string | null
    messages_count: number
}

function senderLabel(t: string): string {
    if (t === 'ai') return 'IA'
    if (t === 'contact') return 'Cliente'
    if (t === 'user') return 'Voce'
    return t
}

function senderColor(t: string): string {
    if (t === 'ai') return '#7c3aed'
    if (t === 'contact') return '#059669'
    if (t === 'user') return '#2563eb'
    return '#6b7280'
}

function timeLabel(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'agora'
    if (diffMin < 60) return `${diffMin}m`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h`
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function statusBadge(status: string) {
    if (status === 'active') return { label: 'IA Ativa', color: '#059669', bg: '#05966918' }
    if (status === 'handed_off') return { label: 'Pausado', color: '#ea580c', bg: '#ea580c18' }
    if (status === 'ended') return { label: 'Finalizado', color: '#6b7280', bg: '#6b728018' }
    return { label: 'Sem conversa', color: '#6b7280', bg: '#6b728018' }
}

export function ConversasTab() {
    const d = useDashboard()
    const slug = d.selectedSlug

    const [conversations, setConversations] = useState<ConversationListItem[]>([])
    const [loading, setLoading] = useState(false)
    const [searchQ, setSearchQ] = useState('')

    // Chat state
    const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
    const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
    const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null)
    const [convInfo, setConvInfo] = useState<ConvInfo | null>(null)
    const [chatLoading, setChatLoading] = useState(false)

    // Compose
    const [composeText, setComposeText] = useState('')
    const [sending, setSending] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const chatEndRef = useRef<HTMLDivElement>(null)

    // Notes
    const [showNotes, setShowNotes] = useState(false)
    const [notesText, setNotesText] = useState('')
    const [savingNotes, setSavingNotes] = useState(false)

    // Load conversation list
    const loadConversations = useCallback(async () => {
        if (!slug) return
        setLoading(true)
        try {
            const res = await fetch(`/api/workspace/conversations?workspace_slug=${encodeURIComponent(slug)}`, {
                credentials: 'include'
            })
            const json = await res.json().catch(() => ({}))
            setConversations(Array.isArray(json.conversations) ? json.conversations : [])
        } finally {
            setLoading(false)
        }
    }, [slug])

    useEffect(() => {
        void loadConversations()
    }, [loadConversations])

    // Load chat for selected contact
    const loadChat = useCallback(async (contactId: string) => {
        if (!slug) return
        setChatLoading(true)
        try {
            const res = await fetch(
                `/api/workspace/conversations/${contactId}?workspace_slug=${encodeURIComponent(slug)}`,
                { credentials: 'include' }
            )
            const json = await res.json().catch(() => ({}))
            setChatMessages(Array.isArray(json.messages) ? json.messages : [])
            setContactInfo(json.contact || null)
            setConvInfo(json.conversation || null)
            setNotesText(json.conversation?.internal_notes || '')
        } finally {
            setChatLoading(false)
        }
    }, [slug])

    useEffect(() => {
        if (selectedContactId) {
            void loadChat(selectedContactId)
        }
    }, [selectedContactId, loadChat])

    // Auto-scroll to bottom
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [chatMessages])

    // Auto-refresh chat every 5s
    useEffect(() => {
        if (!selectedContactId || !slug) return
        const id = setInterval(() => {
            void loadChat(selectedContactId)
        }, 5000)
        return () => clearInterval(id)
    }, [selectedContactId, slug, loadChat])

    // Send text message
    async function handleSendText(e: React.FormEvent) {
        e.preventDefault()
        if (!slug || !selectedContactId || !composeText.trim() || sending) return
        setSending(true)
        try {
            const res = await fetch('/api/whatsapp/send', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspace_slug: slug,
                    contact_id: selectedContactId,
                    message: composeText.trim()
                })
            })
            if (res.ok) {
                setComposeText('')
                await loadChat(selectedContactId)
                await loadConversations()
            } else {
                const err = await res.json().catch(() => ({}))
                d.setToast({ message: (err as { error?: string }).error || 'Erro ao enviar', variant: 'error' })
            }
        } finally {
            setSending(false)
        }
    }

    // Send media
    async function handleSendMedia(file: File) {
        if (!slug || !selectedContactId || sending) return
        setSending(true)

        let media_type = 'document'
        if (file.type.startsWith('image/')) media_type = 'image'
        else if (file.type.startsWith('video/')) media_type = 'video'
        else if (file.type.startsWith('audio/')) media_type = 'audio'

        try {
            const formData = new FormData()
            formData.append('workspace_slug', slug)
            formData.append('contact_id', selectedContactId)
            formData.append('media_type', media_type)
            formData.append('file', file)
            formData.append('filename', file.name)

            const res = await fetch('/api/whatsapp/send-media', {
                method: 'POST',
                credentials: 'include',
                body: formData
            })
            if (res.ok) {
                await loadChat(selectedContactId)
                await loadConversations()
            } else {
                d.setToast({ message: 'Erro ao enviar midia', variant: 'error' })
            }
        } finally {
            setSending(false)
        }
    }

    // Pause / Resume AI
    async function handleToggleAI(action: 'pause_ai' | 'resume_ai') {
        if (!slug || !selectedContactId) return
        const res = await fetch(`/api/workspace/conversations/${selectedContactId}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace_slug: slug, action })
        })
        if (res.ok) {
            await loadChat(selectedContactId)
            await loadConversations()
            d.setToast({
                message: action === 'pause_ai' ? 'IA pausada para este contato' : 'IA reativada para este contato',
                variant: 'success'
            })
        }
    }

    // Save notes
    async function handleSaveNotes() {
        if (!slug || !selectedContactId) return
        setSavingNotes(true)
        try {
            await fetch(`/api/workspace/conversations/${selectedContactId}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspace_slug: slug, internal_notes: notesText })
            })
            d.setToast({ message: 'Notas salvas', variant: 'success' })
        } finally {
            setSavingNotes(false)
        }
    }

    // Filter
    const filtered = conversations.filter(c => {
        if (!searchQ.trim()) return true
        const q = searchQ.toLowerCase()
        return c.name.toLowerCase().includes(q) || c.phone.includes(q)
    })

    const aiStatus = convInfo ? statusBadge(convInfo.status) : statusBadge('none')

    if (!slug) {
        return (
            <div className="page-header">
                <h2>Conversas</h2>
                <p style={{ color: 'var(--text-secondary)' }}>Selecione um workspace na sidebar.</p>
            </div>
        )
    }

    return (
        <div style={{ display: 'flex', height: 'calc(100vh - 48px)', gap: 0, overflow: 'hidden' }}>
            {/* Contact list */}
            <div style={{
                width: selectedContactId ? 320 : '100%',
                maxWidth: selectedContactId ? 320 : 600,
                minWidth: selectedContactId ? 280 : undefined,
                borderRight: selectedContactId ? '1px solid var(--border)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--surface)',
                ...(selectedContactId ? {} : { margin: '0 auto' })
            }}>
                <div style={{ padding: '16px 12px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <MessageSquare size={18} style={{ color: 'var(--primary)' }} />
                        <span style={{ fontWeight: 700, fontSize: 16 }}>Conversas</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                            {filtered.length}
                        </span>
                    </div>
                    <div style={{ position: 'relative' }}>
                        <Search size={14} style={{
                            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                            color: 'var(--text-muted)'
                        }} />
                        <input
                            className="input"
                            placeholder="Buscar contato..."
                            value={searchQ}
                            onChange={e => setSearchQ(e.target.value)}
                            style={{ paddingLeft: 32, fontSize: 13 }}
                        />
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loading && conversations.length === 0 && (
                        <p style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>Carregando...</p>
                    )}
                    {!loading && filtered.length === 0 && (
                        <p style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
                            Nenhuma conversa encontrada.
                        </p>
                    )}
                    {filtered.map(c => {
                        const st = statusBadge(c.ai_status || 'none')
                        const isSelected = selectedContactId === c.contact_id
                        return (
                            <button
                                key={c.contact_id}
                                type="button"
                                onClick={() => setSelectedContactId(c.contact_id)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    width: '100%',
                                    padding: '10px 12px',
                                    border: 'none',
                                    borderBottom: '1px solid var(--border-subtle)',
                                    background: isSelected ? 'var(--surface-hover)' : 'transparent',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    transition: 'background 0.15s'
                                }}
                            >
                                <div style={{
                                    width: 40, height: 40, borderRadius: '50%',
                                    background: 'var(--primary)', color: '#fff',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 700, fontSize: 14, flexShrink: 0
                                }}>
                                    {c.name?.[0]?.toUpperCase() || '?'}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {c.name || c.phone}
                                        </span>
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                                            {c.last_message_at ? timeLabel(c.last_message_at) : ''}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                        <span style={{
                                            fontSize: 12, color: 'var(--text-secondary)',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                        }}>
                                            {c.last_sender_type ? `${senderLabel(c.last_sender_type)}: ` : ''}
                                            {c.last_message || 'Sem mensagens'}
                                        </span>
                                        <span style={{
                                            fontSize: 10, padding: '1px 6px', borderRadius: 8,
                                            background: st.bg, color: st.color, fontWeight: 600, flexShrink: 0
                                        }}>
                                            {st.label}
                                        </span>
                                    </div>
                                </div>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Chat view */}
            {selectedContactId && (
                <div style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    background: 'var(--bg)', minWidth: 0
                }}>
                    {/* Chat header */}
                    <div style={{
                        padding: '10px 16px', borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: 'var(--surface)'
                    }}>
                        <button
                            type="button"
                            onClick={() => setSelectedContactId(null)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-secondary)' }}
                            title="Voltar"
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <div style={{
                            width: 36, height: 36, borderRadius: '50%',
                            background: 'var(--primary)', color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: 14
                        }}>
                            {contactInfo?.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                                {contactInfo?.name || 'Carregando...'}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Phone size={10} />
                                {contactInfo?.phone || ''}
                            </div>
                        </div>

                        {/* AI status + controls */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{
                                fontSize: 11, padding: '3px 8px', borderRadius: 10,
                                background: aiStatus.bg, color: aiStatus.color, fontWeight: 600
                            }}>
                                {aiStatus.label}
                            </span>
                            {convInfo?.status === 'active' && (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-compact"
                                    onClick={() => handleToggleAI('pause_ai')}
                                    title="Pausar IA"
                                    style={{ fontSize: 11, gap: 4 }}
                                >
                                    <Pause size={12} /> Pausar
                                </button>
                            )}
                            {(convInfo?.status === 'handed_off' || convInfo?.status === 'ended') && (
                                <button
                                    type="button"
                                    className="btn btn-primary btn-compact"
                                    onClick={() => handleToggleAI('resume_ai')}
                                    title="Reativar IA"
                                    style={{ fontSize: 11, gap: 4 }}
                                >
                                    <Play size={12} /> Ativar IA
                                </button>
                            )}
                            <button
                                type="button"
                                className="btn btn-secondary btn-compact"
                                onClick={() => setShowNotes(!showNotes)}
                                title="Notas internas"
                                style={{ fontSize: 11, gap: 4 }}
                            >
                                <StickyNote size={12} />
                            </button>
                        </div>
                    </div>

                    {/* Notes panel */}
                    {showNotes && (
                        <div style={{
                            padding: '10px 16px', borderBottom: '1px solid var(--border)',
                            background: '#fefce818'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <StickyNote size={14} style={{ color: '#d97706' }} />
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#d97706' }}>
                                    Notas internas (nao enviadas ao cliente)
                                </span>
                                <button
                                    type="button"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto', color: 'var(--text-muted)' }}
                                    onClick={() => setShowNotes(false)}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            <textarea
                                className="input"
                                rows={3}
                                value={notesText}
                                onChange={e => setNotesText(e.target.value)}
                                placeholder="Anote informacoes sobre esta conversa..."
                                style={{ fontSize: 13, resize: 'vertical' }}
                            />
                            <button
                                type="button"
                                className="btn btn-primary btn-compact"
                                onClick={handleSaveNotes}
                                disabled={savingNotes}
                                style={{ marginTop: 6, fontSize: 12 }}
                            >
                                {savingNotes ? 'Salvando...' : 'Salvar notas'}
                            </button>
                        </div>
                    )}

                    {/* Messages */}
                    <div style={{
                        flex: 1, overflowY: 'auto', padding: '12px 16px',
                        display: 'flex', flexDirection: 'column', gap: 6
                    }}>
                        {chatLoading && chatMessages.length === 0 && (
                            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                                Carregando mensagens...
                            </p>
                        )}
                        {chatMessages.map(msg => {
                            const isContact = msg.sender_type === 'contact'
                            const isAi = msg.sender_type === 'ai'
                            return (
                                <div
                                    key={msg.id}
                                    style={{
                                        display: 'flex',
                                        justifyContent: isContact ? 'flex-start' : 'flex-end',
                                        maxWidth: '100%'
                                    }}
                                >
                                    <div style={{
                                        maxWidth: '75%',
                                        padding: '8px 12px',
                                        borderRadius: isContact ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                                        background: isContact
                                            ? 'var(--surface)'
                                            : isAi
                                                ? '#7c3aed15'
                                                : '#2563eb15',
                                        border: `1px solid ${isContact ? 'var(--border)' : isAi ? '#7c3aed30' : '#2563eb30'}`
                                    }}>
                                        <div style={{
                                            fontSize: 11, fontWeight: 600, marginBottom: 2,
                                            color: senderColor(msg.sender_type),
                                            display: 'flex', alignItems: 'center', gap: 4
                                        }}>
                                            {isAi ? <Bot size={10} /> : isContact ? <User size={10} /> : <User size={10} />}
                                            {senderLabel(msg.sender_type)}
                                        </div>
                                        {msg.media_type && msg.media_url && (
                                            <div style={{ marginBottom: 4 }}>
                                                {msg.media_type === 'image' && (
                                                    <img
                                                        src={msg.media_url}
                                                        alt="imagem"
                                                        style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6 }}
                                                    />
                                                )}
                                                {msg.media_type === 'video' && (
                                                    <video
                                                        src={msg.media_url}
                                                        controls
                                                        style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6 }}
                                                    />
                                                )}
                                                {msg.media_type === 'audio' && (
                                                    <audio src={msg.media_url} controls style={{ maxWidth: '100%' }} />
                                                )}
                                                {msg.media_type === 'document' && (
                                                    <a href={msg.media_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--primary)' }}>
                                                        <Paperclip size={12} /> Documento anexado
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                        {msg.media_type && !msg.media_url && (
                                            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 2 }}>
                                                [{msg.media_type}]
                                            </div>
                                        )}
                                        <div style={{
                                            fontSize: 13, lineHeight: 1.45,
                                            color: 'var(--text-primary)',
                                            whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                                        }}>
                                            {msg.body || ''}
                                        </div>
                                        <div style={{
                                            fontSize: 10, color: 'var(--text-muted)',
                                            textAlign: 'right', marginTop: 4
                                        }}>
                                            {new Date(msg.created_at).toLocaleString('pt-BR', {
                                                hour: '2-digit', minute: '2-digit',
                                                day: '2-digit', month: '2-digit'
                                            })}
                                            {msg.status === 'failed' && (
                                                <span style={{ color: '#dc2626', marginLeft: 4 }}>falhou</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}

                        {/* Conversation summary when ended/handed_off */}
                        {convInfo && (convInfo.status === 'handed_off' || convInfo.status === 'ended') && chatMessages.length > 0 && (
                            <div style={{
                                margin: '8px auto', padding: '8px 16px',
                                background: 'var(--surface-secondary)',
                                borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)',
                                textAlign: 'center', maxWidth: 400,
                                border: '1px solid var(--border-subtle)'
                            }}>
                                <strong>{convInfo.status === 'handed_off' ? 'IA Pausada' : 'Conversa Finalizada'}</strong>
                                {convInfo.handoff_reason && (
                                    <div style={{ marginTop: 4, fontStyle: 'italic' }}>
                                        Motivo: {convInfo.handoff_reason}
                                    </div>
                                )}
                                <div style={{ marginTop: 4 }}>
                                    {convInfo.messages_count} mensagens trocadas
                                </div>
                            </div>
                        )}

                        <div ref={chatEndRef} />
                    </div>

                    {/* Compose bar */}
                    <form
                        onSubmit={handleSendText}
                        style={{
                            padding: '8px 12px',
                            borderTop: '1px solid var(--border)',
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: 'var(--surface)'
                        }}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                            onChange={e => {
                                const file = e.target.files?.[0]
                                if (file) void handleSendMedia(file)
                                e.target.value = ''
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={sending}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                padding: 6, color: 'var(--text-secondary)'
                            }}
                            title="Enviar imagem, video, audio ou documento"
                        >
                            <Paperclip size={18} />
                        </button>
                        <input
                            className="input"
                            placeholder="Digite uma mensagem..."
                            value={composeText}
                            onChange={e => setComposeText(e.target.value)}
                            disabled={sending}
                            style={{ flex: 1, fontSize: 13 }}
                        />
                        <button
                            type="submit"
                            disabled={!composeText.trim() || sending}
                            className="btn btn-primary btn-compact"
                            style={{ padding: '6px 12px' }}
                        >
                            <Send size={14} />
                        </button>
                    </form>
                </div>
            )}
        </div>
    )
}
