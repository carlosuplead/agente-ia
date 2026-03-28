import * as uazapi from '@/lib/uazapi'
import type {
    WhatsAppProvider,
    WhatsAppConnectResult,
    WhatsAppSendOptions,
    WhatsAppSendResult
} from '@/lib/whatsapp/provider.interface'

export class UazapiProvider implements WhatsAppProvider {
    readonly type = 'uazapi' as const

    async sendText(
        instanceToken: string,
        phone: string,
        text: string,
        opts?: WhatsAppSendOptions
    ): Promise<WhatsAppSendResult> {
        const raw = await uazapi.sendTextMessage(instanceToken, phone, text, opts)
        const rec = raw as { messageId?: string | null } | null
        return { messageId: rec?.messageId ?? null, raw }
    }

    async sendAudio(
        instanceToken: string,
        phone: string,
        audioBytes: ArrayBuffer,
        opts?: { delayMs?: number }
    ): Promise<WhatsAppSendResult> {
        return uazapi.sendMediaAudio(instanceToken, phone, audioBytes, {
            delayMs: opts?.delayMs,
            uazapiType: 'audio'
        })
    }

    async connect(instanceToken: string): Promise<WhatsAppConnectResult> {
        const r = await uazapi.connect(instanceToken)
        return {
            status: 'connecting',
            qrcode: r.qrcode,
            pairingCode: r.pairingCode
        }
    }
}
