import type {
    MetaWebhookParsed,
    WhatsAppConnectResult,
    WhatsAppProvider,
    WhatsAppSendOptions,
    WhatsAppSendResult
} from '@/lib/whatsapp/provider.interface'

import { GRAPH_API_BASE } from '@/lib/meta/graph-version'

type OfficialCreds = {
    phoneNumberId: string
    accessToken: string
}

export class OfficialApiProvider implements WhatsAppProvider {
    readonly type = 'official' as const
    private readonly creds: OfficialCreds

    constructor(creds: OfficialCreds) {
        this.creds = creds
    }

    private formatPhone(phone: string): string {
        return phone.replace(/\D/g, '')
    }

    private async graph(path: string, init?: RequestInit): Promise<Response> {
        // Se body é FormData, NÃO setar Content-Type (fetch auto-seta multipart/form-data com boundary)
        const isFormData = init?.body instanceof FormData
        const defaultHeaders: Record<string, string> = {
            Authorization: `Bearer ${this.creds.accessToken}`,
        }
        if (!isFormData) {
            defaultHeaders['Content-Type'] = 'application/json'
        }
        return fetch(`${GRAPH_API_BASE}${path}`, {
            ...init,
            headers: {
                ...defaultHeaders,
                ...(init?.headers || {})
            }
        })
    }

    async sendText(
        _instanceToken: string,
        phone: string,
        text: string,
        _opts?: WhatsAppSendOptions
    ): Promise<WhatsAppSendResult> {
        const res = await this.graph(`/${this.creds.phoneNumberId}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: this.formatPhone(phone),
                type: 'text',
                text: { preview_url: true, body: text }
            })
        })
        const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) throw new Error(`Meta Cloud API sendText failed (${res.status})`)
        const msg = Array.isArray(raw.messages) ? (raw.messages[0] as { id?: string } | undefined) : undefined
        return { messageId: msg?.id ?? null, raw }
    }

    async sendAudio(
        _instanceToken: string,
        phone: string,
        audioBytes: ArrayBuffer,
        _opts?: { delayMs?: number }
    ): Promise<WhatsAppSendResult> {
        const mediaUpload = await this.graph(`/${this.creds.phoneNumberId}/media`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.creds.accessToken}`
            },
            body: (() => {
                const form = new FormData()
                form.append('messaging_product', 'whatsapp')
                form.append('type', 'audio/mpeg')
                form.append('file', new Blob([audioBytes], { type: 'audio/mpeg' }), 'voice.mp3')
                return form
            })()
        })
        const uploadJson = (await mediaUpload.json().catch(() => ({}))) as { id?: string }
        if (!mediaUpload.ok || !uploadJson.id) throw new Error('Meta Cloud API media upload failed')

        const sendRes = await this.graph(`/${this.creds.phoneNumberId}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: this.formatPhone(phone),
                type: 'audio',
                audio: { id: uploadJson.id }
            })
        })
        const raw = (await sendRes.json().catch(() => ({}))) as Record<string, unknown>
        if (!sendRes.ok) throw new Error(`Meta Cloud API sendAudio failed (${sendRes.status})`)
        const msg = Array.isArray(raw.messages) ? (raw.messages[0] as { id?: string } | undefined) : undefined
        return { messageId: msg?.id ?? null, raw }
    }

    async connect(_instanceToken: string): Promise<WhatsAppConnectResult> {
        return { status: 'connected' }
    }
}

export function parseMetaWebhookPayload(payload: unknown): MetaWebhookParsed[] {
    const out: MetaWebhookParsed[] = []
    if (!payload || typeof payload !== 'object') return out
    const p = payload as { entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }> }
    for (const entry of p.entry || []) {
        for (const change of entry.changes || []) {
            const value = change.value || {}
            const metadata = value.metadata as { phone_number_id?: string } | undefined
            const phoneNumberId = metadata?.phone_number_id
            if (!phoneNumberId) continue

            const statusesRaw = (value.statuses as Array<{ id?: string; status?: string }> | undefined) || []
            const statuses = statusesRaw
                .filter(s => s.id && ['sent', 'delivered', 'read', 'failed'].includes(String(s.status)))
                .map(s => ({ whatsappId: String(s.id), status: s.status as 'sent' | 'delivered' | 'read' | 'failed' }))

            const contacts = (value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }> | undefined) || []
            const messagesRaw =
                (value.messages as Array<Record<string, unknown>> | undefined) || []
            const messages = messagesRaw.map(msg => {
                const fromPhone = String(msg.from || '')
                const fromName =
                    contacts.find(c => c.wa_id === fromPhone)?.profile?.name ??
                    null
                const textBody =
                    (msg.text as { body?: string } | undefined)?.body ||
                    (msg.button as { text?: string } | undefined)?.text ||
                    (msg.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } } | undefined)
                        ?.button_reply?.title ||
                    (msg.interactive as { list_reply?: { title?: string } } | undefined)?.list_reply?.title ||
                    ''
                const type = typeof msg.type === 'string' ? msg.type : ''
                // `voice` (se existir no payload) normaliza para `audio` — a fila de mídia só processa audio|image
                const mediaType =
                    type === 'text' || type === 'interactive' || type === 'button'
                        ? null
                        : type === 'voice'
                          ? 'audio'
                          : type || null
                const fallback = mediaType ? 'Midia enviada' : ''

                // Extrair caption de mensagens de mídia (imagem/vídeo/documento)
                let caption = ''
                if (type === 'image') {
                    caption = (msg.image as { caption?: string } | undefined)?.caption || ''
                } else if (type === 'video') {
                    caption = (msg.video as { caption?: string } | undefined)?.caption || ''
                } else if (type === 'document') {
                    caption =
                        (msg.document as { caption?: string } | undefined)?.caption ||
                        (msg.document as { filename?: string } | undefined)?.filename || ''
                } else if (type === 'audio') {
                    caption = (msg.audio as { caption?: string } | undefined)?.caption || ''
                } else if (type === 'voice') {
                    caption = (msg.voice as { caption?: string } | undefined)?.caption || ''
                }

                // media_id para download na Graph API (áudio: bloco audio ou voice)
                let mediaId: string | null = null
                if (mediaType === 'audio') {
                    const audioBlock =
                        type === 'voice' && msg.voice && typeof msg.voice === 'object'
                            ? (msg.voice as { id?: string })
                            : msg.audio && typeof msg.audio === 'object'
                              ? (msg.audio as { id?: string })
                              : null
                    if (audioBlock && typeof audioBlock.id === 'string' && audioBlock.id) {
                        mediaId = audioBlock.id
                    }
                } else if (mediaType && msg[type] && typeof msg[type] === 'object') {
                    const mediaObj = msg[type] as { id?: string }
                    if (typeof mediaObj.id === 'string' && mediaObj.id) {
                        mediaId = mediaObj.id
                    }
                }

                return {
                    whatsappId: String(msg.id || ''),
                    fromPhone,
                    fromName,
                    body: textBody || caption || fallback,
                    mediaType,
                    mediaId,
                    timestampMs: msg.timestamp ? Number(msg.timestamp) * 1000 : null
                }
            }).filter(m => m.whatsappId && m.fromPhone)

            out.push({ phoneNumberId, statuses, messages })
        }
    }
    return out
}
