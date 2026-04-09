export type WhatsAppProviderType = 'uazapi' | 'official'

export type WhatsAppSendOptions = {
    delayMs?: number
    presence?: string | null
}

export type WhatsAppSendResult = {
    messageId: string | null
    raw?: unknown
}

export type WhatsAppConnectResult = {
    status: 'connecting' | 'connected'
    qrcode?: string
    pairingCode?: string
}

export type MetaWebhookStatus = 'sent' | 'delivered' | 'read' | 'failed'

export type MetaWebhookStatusEvent = {
    whatsappId: string
    status: MetaWebhookStatus
}

export type MetaWebhookMessageEvent = {
    whatsappId: string
    fromPhone: string
    fromName: string | null
    body: string
    mediaType: string | null
    /** ID do ficheiro de mídia no Graph API (para download). */
    mediaId: string | null
    timestampMs: number | null
}

export type MetaWebhookParsed = {
    phoneNumberId: string
    statuses: MetaWebhookStatusEvent[]
    messages: MetaWebhookMessageEvent[]
}

export interface WhatsAppProvider {
    readonly type: WhatsAppProviderType
    sendText(instanceToken: string, phone: string, text: string, opts?: WhatsAppSendOptions): Promise<WhatsAppSendResult>
    sendAudio(
        instanceToken: string,
        phone: string,
        audioBytes: ArrayBuffer,
        opts?: { delayMs?: number }
    ): Promise<WhatsAppSendResult>
    connect(instanceToken: string): Promise<WhatsAppConnectResult>
}
