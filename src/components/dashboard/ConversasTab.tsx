'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDashboard } from './dashboard-context'
import {
    MessageSquare,
    Send,
    Pause,
    Play,
    StickyNote,
    Paperclip,
    ArrowLeft,
    Bot,
    User,
    Phone,
    Search,
    X,
    Mic,
    FileText,
    Square
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
    if (t === 'user') return 'Equipa'
    return t
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

function aiStatusCss(status: string): { label: string; cls: string } {
    if (status === 'active') return { label: 'IA Ativa', cls: 'chat-status-dot--active' }
    if (status === 'handed_off') return { label: 'Pausado', cls: 'chat-status-dot--handed_off' }
    if (status === 'ended') return { label: 'Finalizado', cls: 'chat-status-dot--ended' }
    return { label: 'Sem conversa', cls: 'chat-status-dot--none' }
}

export function ConversasTab() {
    const d = useDashboard()
    const slug = d.selectedSlug

    const [conversations, setConversations] = useState<ConversationListItem[]>([])
    const [loading, setLoading] = useState(false)
    const [searchQ, setSearchQ] = useState('')

    const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
    const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
    const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null)
    const [convInfo, setConvInfo] = useState<ConvInfo | null>(null)
    const [chatLoading, setChatLoading] = useState(false)

    const [composeText, setComposeText] = useState('')
    const [sending, setSending] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const chatEndRef = useRef<HTMLDivElement>(null)

    // Audio recording
    const [isRecording, setIsRecording] = useState(false)
    const [recordingTime, setRecordingTime] = useState(0)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Cleanup recording on unmount
    useEffect(() => {
        return () => {
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
            if (mediaRecorderRef.current?.state === 'recording') {
                mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop())
                try { mediaRecorderRef.current.stop() } catch { /* already stopped */ }
            }
        }
    }, [])

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

    // Auto-refresh conversations list every 8s
    useEffect(() => {
        if (!slug) return
        const id = setInterval(() => {
            void loadConversations()
        }, 8000)
        return () => clearInterval(id)
    }, [slug, loadConversations])

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
        if (selectedContactId) void loadChat(selectedContactId)
    }, [selectedContactId, loadChat])

    // Auto-scroll
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [chatMessages])

    // Auto-refresh chat every 5s
    useEffect(() => {
        if (!selectedContactId || !slug) return
        const id = setInterval(() => void loadChat(selectedContactId), 5000)
        return () => clearInterval(id)
    }, [selectedContactId, slug, loadChat])

    // Send text
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
                loadConversations().catch(() => {})
            } else {
                const err = await res.json().catch(() => ({}))
                d.setToast({ message: (err as { error?: string }).error || 'Erro ao enviar', variant: 'error' })
            }
        } finally {
            setSending(false)
        }
    }

    // Send media file
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
                loadConversations().catch(() => {})
            } else {
                d.setToast({ message: 'Erro ao enviar midia', variant: 'error' })
            }
        } finally {
            setSending(false)
        }
    }

    // Audio recording
    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
            mediaRecorderRef.current = mediaRecorder
            audioChunksRef.current = []

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data)
            }

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop())
                if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
                setRecordingTime(0)

                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
                if (blob.size < 1000) return // too short

                const file = new File([blob], 'audio.webm', { type: 'audio/webm' })
                await handleSendMedia(file)
            }

            mediaRecorder.start()
            setIsRecording(true)
            setRecordingTime(0)
            recordingTimerRef.current = setInterval(() => {
                setRecordingTime(t => t + 1)
            }, 1000)
        } catch {
            d.setToast({ message: 'Sem acesso ao microfone', variant: 'error' })
        }
    }

    function stopRecording() {
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop()
        }
        setIsRecording(false)
    }

    function cancelRecording() {
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.ondataavailable = null
            mediaRecorderRef.current.onstop = () => {
                mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop())
            }
            mediaRecorderRef.current.stop()
        }
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
        audioChunksRef.current = []
        setIsRecording(false)
        setRecordingTime(0)
    }

    function formatRecTime(s: number): string {
        const m = Math.floor(s / 60)
        const sec = s % 60
        return `${m}:${sec.toString().padStart(2, '0')}`
    }

    // Pause / Resume AI
    const [togglingAI, setTogglingAI] = useState(false)

    async function handleToggleAI(action: 'pause_ai' | 'resume_ai') {
        if (!slug || !selectedContactId || togglingAI) return
        setTogglingAI(true)
        try {
            const res = await fetch(`/api/workspace/conversations/${selectedContactId}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspace_slug: slug, action })
            })
            if (res.ok) {
                await loadChat(selectedContactId)
                loadConversations().catch(() => {})
                d.setToast({
                    message: action === 'pause_ai' ? 'IA pausada' : 'IA reativada',
                    variant: 'success'
                })
            } else {
                const err = await res.json().catch(() => ({}))
                d.setToast({
                    message: (err as { error?: string }).error || 'Erro ao alterar estado da IA',
                    variant: 'error'
                })
            }
        } catch {
            d.setToast({ message: 'Erro de conexão ao alterar IA', variant: 'error' })
        } finally {
            setTogglingAI(false)
        }
    }

    // Save notes
    async function handleSaveNotes() {
        if (!slug || !selectedContactId) return
        setSavingNotes(true)
        try {
            const res = await fetch(`/api/workspace/conversations/${selectedContactId}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspace_slug: slug, internal_notes: notesText })
            })
            if (res.ok) {
                d.setToast({ message: 'Notas salvas', variant: 'success' })
            } else {
                const err = await res.json().catch(() => ({}))
                d.setToast({
                    message: (err as { error?: string }).error || 'Erro ao salvar notas',
                    variant: 'error'
                })
            }
        } catch {
            d.setToast({ message: 'Erro de conexão ao salvar notas', variant: 'error' })
        } finally {
            setSavingNotes(false)
        }
    }

    // Select contact
    function selectContact(contactId: string) {
        setSelectedContactId(contactId)
        setShowNotes(false)
    }

    function goBack() {
        setSelectedContactId(null)
        setShowNotes(false)
    }

    // Filter
    const filtered = conversations.filter(c => {
        if (!searchQ.trim()) return true
        const q = searchQ.toLowerCase()
        return c.name.toLowerCase().includes(q) || c.phone.includes(q)
    })

    const aiSt = convInfo ? aiStatusCss(convInfo.status) : aiStatusCss('none')

    if (!slug) {
        return (
            <div className="page-header">
                <h2>Conversas</h2>
                <p style={{ color: 'var(--text-secondary)' }}>Selecione um workspace na sidebar.</p>
            </div>
        )
    }

    return (
        <div className="chat-container">
            {/* ── Sidebar / Contact List ── */}
            <div className={`chat-sidebar ${selectedContactId ? 'chat-sidebar--has-chat' : ''}`}>
                <div className="chat-sidebar-header">
                    <div className="chat-sidebar-title">
                        <MessageSquare size={18} style={{ color: 'var(--primary)' }} />
                        <h3>Conversas</h3>
                        <span className="chat-sidebar-count">{filtered.length}</span>
                    </div>
                    <div className="chat-search">
                        <Search size={14} className="chat-search-icon" />
                        <input
                            className="input"
                            placeholder="Buscar contato..."
                            value={searchQ}
                            onChange={e => setSearchQ(e.target.value)}
                        />
                    </div>
                </div>

                <div className="chat-contact-list">
                    {loading && conversations.length === 0 && (
                        <p style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>Carregando...</p>
                    )}
                    {!loading && filtered.length === 0 && (
                        <p style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
                            Nenhuma conversa encontrada.
                        </p>
                    )}
                    {filtered.map(c => {
                        const st = aiStatusCss(c.ai_status || 'none')
                        const isActive = selectedContactId === c.contact_id
                        return (
                            <button
                                key={c.contact_id}
                                type="button"
                                className={`chat-contact-item ${isActive ? 'chat-contact-item--active' : ''}`}
                                onClick={() => selectContact(c.contact_id)}
                            >
                                <div className="chat-avatar">
                                    {c.name?.[0]?.toUpperCase() || '?'}
                                </div>
                                <div className="chat-contact-info">
                                    <div className="chat-contact-row">
                                        <span className="chat-contact-name">
                                            {c.name || c.phone}
                                        </span>
                                        <span className="chat-contact-time">
                                            {c.last_message_at ? timeLabel(c.last_message_at) : ''}
                                        </span>
                                    </div>
                                    <div className="chat-contact-preview">
                                        <span className="chat-contact-lastmsg">
                                            {c.last_sender_type ? `${senderLabel(c.last_sender_type)}: ` : ''}
                                            {c.last_message || 'Sem mensagens'}
                                        </span>
                                        <span className={`chat-status-dot ${st.cls}`}>
                                            {st.label}
                                        </span>
                                    </div>
                                </div>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* ── Chat View ── */}
            {selectedContactId ? (
                <div className="chat-view">
                    {/* Header */}
                    <div className="chat-header">
                        <button type="button" className="chat-header-back" onClick={goBack} title="Voltar">
                            <ArrowLeft size={18} />
                        </button>
                        <div className="chat-avatar chat-avatar--small">
                            {contactInfo?.avatar_url
                                ? <img src={contactInfo.avatar_url} alt="" />
                                : (contactInfo?.name?.[0]?.toUpperCase() || '?')
                            }
                        </div>
                        <div className="chat-header-info">
                            <div className="chat-header-name">
                                {contactInfo?.name || 'Carregando...'}
                            </div>
                            <div className="chat-header-phone">
                                <Phone size={10} />
                                {contactInfo?.phone || ''}
                            </div>
                        </div>
                        <div className="chat-header-actions">
                            <span className={`chat-status-dot ${aiSt.cls}`}>
                                {aiSt.label}
                            </span>
                            {convInfo?.status === 'active' && (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-compact"
                                    onClick={() => handleToggleAI('pause_ai')}
                                    disabled={togglingAI}
                                    title="Pausar IA"
                                >
                                    <Pause size={12} /> {togglingAI ? '...' : 'Pausar'}
                                </button>
                            )}
                            {(convInfo?.status === 'handed_off' || convInfo?.status === 'ended') && (
                                <button
                                    type="button"
                                    className="btn btn-primary btn-compact"
                                    onClick={() => handleToggleAI('resume_ai')}
                                    disabled={togglingAI}
                                    title="Reativar IA"
                                >
                                    <Play size={12} /> {togglingAI ? '...' : 'Ativar IA'}
                                </button>
                            )}
                            <button
                                type="button"
                                className="btn btn-secondary btn-compact"
                                onClick={() => setShowNotes(!showNotes)}
                                title="Notas internas"
                            >
                                <StickyNote size={12} />
                            </button>
                        </div>
                    </div>

                    {/* Notes panel */}
                    {showNotes && (
                        <div className="chat-notes">
                            <div className="chat-notes-header">
                                <StickyNote size={14} style={{ color: 'var(--orange)' }} />
                                <span className="chat-notes-label">
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
                    <div className="chat-messages">
                        {chatLoading && chatMessages.length === 0 && (
                            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>
                                Carregando mensagens...
                            </p>
                        )}

                        {chatMessages.map(msg => {
                            const st = msg.sender_type
                            const rowCls = st === 'contact' ? 'chat-msg-row--contact'
                                : st === 'ai' ? 'chat-msg-row--ai'
                                    : 'chat-msg-row--user'
                            const bubbleCls = st === 'contact' ? 'chat-bubble--contact'
                                : st === 'ai' ? 'chat-bubble--ai'
                                    : 'chat-bubble--user'
                            const senderCls = `chat-bubble-sender--${st === 'contact' ? 'contact' : st === 'ai' ? 'ai' : 'user'}`
                            const SenderIcon = st === 'ai' ? Bot : User

                            return (
                                <div key={msg.id} className={`chat-msg-row ${rowCls}`}>
                                    <div className={`chat-bubble ${bubbleCls}`}>
                                        <div className={`chat-bubble-sender ${senderCls}`}>
                                            <SenderIcon size={10} />
                                            {senderLabel(st)}
                                        </div>

                                        {/* Media */}
                                        {msg.media_type && msg.media_url && (
                                            <div className="chat-bubble-media">
                                                {msg.media_type === 'image' && (
                                                    <img src={msg.media_url} alt="imagem" loading="lazy" />
                                                )}
                                                {msg.media_type === 'video' && (
                                                    <video src={msg.media_url} controls preload="metadata" />
                                                )}
                                                {msg.media_type === 'audio' && (
                                                    <audio src={msg.media_url} controls preload="metadata" />
                                                )}
                                                {msg.media_type === 'document' && (
                                                    <a href={msg.media_url} target="_blank" rel="noreferrer">
                                                        <FileText size={14} /> Documento anexado
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                        {msg.media_type && !msg.media_url && (
                                            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                                [{msg.media_type}]
                                            </div>
                                        )}

                                        {msg.body && (
                                            <div className="chat-bubble-text">{msg.body}</div>
                                        )}

                                        <div className="chat-bubble-time">
                                            {new Date(msg.created_at).toLocaleString('pt-BR', {
                                                hour: '2-digit', minute: '2-digit',
                                                day: '2-digit', month: '2-digit'
                                            })}
                                            {msg.status === 'failed' && (
                                                <span className="chat-bubble-failed">falhou</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}

                        {/* Conversation summary block */}
                        {convInfo && (convInfo.status === 'handed_off' || convInfo.status === 'ended') && chatMessages.length > 0 && (
                            <div className="chat-system-block">
                                <strong>{convInfo.status === 'handed_off' ? 'IA Pausada' : 'Conversa Finalizada'}</strong>
                                {convInfo.handoff_reason && (
                                    <div style={{ marginTop: 4, fontStyle: 'italic' }}>
                                        {convInfo.handoff_reason}
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
                    {isRecording ? (
                        <div className="chat-compose">
                            <button
                                type="button"
                                className="chat-compose-btn"
                                onClick={cancelRecording}
                                title="Cancelar"
                            >
                                <X size={18} />
                            </button>
                            <div style={{
                                flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                                fontSize: 13, color: 'var(--red)', fontWeight: 600
                            }}>
                                <Mic size={16} className="chat-compose-btn--recording" />
                                Gravando {formatRecTime(recordingTime)}
                            </div>
                            <button
                                type="button"
                                className="btn btn-primary btn-compact chat-compose-send"
                                onClick={stopRecording}
                            >
                                <Send size={14} /> Enviar
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSendText} className="chat-compose">
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
                                className="chat-compose-btn"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={sending}
                                title="Enviar arquivo"
                            >
                                <Paperclip size={18} />
                            </button>
                            <button
                                type="button"
                                className="chat-compose-btn"
                                onClick={startRecording}
                                disabled={sending}
                                title="Gravar audio"
                            >
                                <Mic size={18} />
                            </button>
                            <input
                                type="text"
                                className="input"
                                placeholder="Digite uma mensagem..."
                                value={composeText}
                                onChange={e => setComposeText(e.target.value)}
                                disabled={sending}
                            />
                            <button
                                type="submit"
                                disabled={!composeText.trim() || sending}
                                className="btn btn-primary btn-compact chat-compose-send"
                            >
                                <Send size={14} />
                            </button>
                        </form>
                    )}
                </div>
            ) : (
                <div className="chat-empty">
                    <MessageSquare size={48} className="chat-empty-icon" />
                    <span>Selecione uma conversa</span>
                </div>
            )}
        </div>
    )
}
