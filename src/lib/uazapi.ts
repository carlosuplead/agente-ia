// Minimalist Uazapi (Wazapi) integration
// Criar instância: POST /instance/create com apikey administrativa (ajustar se o teu painel Uazapi usar outro path).

export interface UazapiConnectResult {
    qrcode: string
    pairingCode: string
}

const UAZAPI_URL = process.env.UAZAPI_URL || 'https://api.uazapi.com'
const UAZAPI_TOKEN = process.env.UAZAPI_GLOBAL_TOKEN

function adminApiKey(): string {
    return process.env.UAZAPI_ADMIN_TOKEN || process.env.UAZAPI_GLOBAL_TOKEN || ''
}

/** Cria uma instância remota e devolve o token usado no webhook e no connect/send. */
export async function createRemoteInstance(displayName: string): Promise<{ token: string }> {
    const res = await fetch(`${UAZAPI_URL}/instance/create`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: adminApiKey()
        },
        body: JSON.stringify({ name: displayName })
    })

    if (!res.ok) {
        const text = await res.text()
        throw new Error(`Uazapi create instance: ${res.status} ${text}`)
    }

    const data = (await res.json()) as Record<string, unknown>
    const token =
        (typeof data.token === 'string' && data.token) ||
        (data.instance && typeof (data.instance as { token?: string }).token === 'string'
            ? (data.instance as { token: string }).token
            : null) ||
        (typeof data.instanceToken === 'string' && data.instanceToken) ||
        null

    if (!token) {
        throw new Error('Uazapi create instance: resposta sem token')
    }

    return { token }
}

export async function connect(instanceToken: string): Promise<UazapiConnectResult> {
    const res = await fetch(`${UAZAPI_URL}/instance/connect/${instanceToken}`, {
        method: 'GET',
        headers: {
            'apikey': UAZAPI_TOKEN || '',
        }
    })
    
    if (!res.ok) {
        throw new Error(`Failed to connect instance: ${res.statusText}`)
    }
    
    return res.json()
}

export type SendTextOptions = {
    delayMs?: number
    /** Omitir ou `none` para não enviar indicador de presença. */
    presence?: string | null
}

export async function sendTextMessage(
    instanceToken: string,
    phone: string,
    text: string,
    sendOpts?: SendTextOptions
) {
    const delay = sendOpts?.delayMs ?? 1200
    const rawPresence = sendOpts?.presence
    const usePresence =
        rawPresence !== undefined &&
        rawPresence !== null &&
        String(rawPresence).trim() !== '' &&
        String(rawPresence).toLowerCase() !== 'none'

    const res = await fetch(`${UAZAPI_URL}/message/sendText/${instanceToken}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': UAZAPI_TOKEN || '',
        },
        body: JSON.stringify({
            number: phone,
            options: usePresence ? { delay, presence: rawPresence } : { delay },
            textMessage: { text }
        })
    })

    if (!res.ok) {
        throw new Error(`Failed to send message: ${res.statusText}`)
    }

    return res.json()
}

export type SendMediaAudioOptions = {
    delayMs?: number
    /** Conforme OpenAPI uazapiGO: audio (MP3/OGG), ptt, myaudio */
    uazapiType?: 'audio' | 'ptt' | 'myaudio'
}

function extractUazapiMessageId(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null
    const o = data as Record<string, unknown>
    const keys = ['messageId', 'messageid', 'id', 'msgId', 'key']
    for (const k of keys) {
        const v = o[k]
        if (typeof v === 'string' && v.trim()) return v.trim()
    }
    const nested = o.response
    if (nested && typeof nested === 'object') {
        const r = nested as Record<string, unknown>
        for (const k of keys) {
            const v = r[k]
            if (typeof v === 'string' && v.trim()) return v.trim()
        }
    }
    return null
}

/**
 * Envia áudio via POST /send/media (OpenAPI v2). Auth: header `token` = token da instância.
 * Opcionalmente envia também `apikey` se UAZAPI_GLOBAL_TOKEN estiver definido (alguns gateways).
 */
export async function sendMediaAudio(
    instanceToken: string,
    phone: string,
    audioBytes: ArrayBuffer,
    opts?: SendMediaAudioOptions
): Promise<{ messageId: string | null; raw: unknown }> {
    const type = opts?.uazapiType ?? 'audio'
    const delay = opts?.delayMs ?? 1200
    const base64 = Buffer.from(audioBytes).toString('base64')

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        token: instanceToken
    }
    const globalKey = UAZAPI_TOKEN?.trim()
    if (globalKey) {
        headers.apikey = globalKey
    }

    const res = await fetch(`${UAZAPI_URL}/send/media`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            number: phone,
            type,
            file: base64,
            mimetype: 'audio/mpeg',
            delay
        })
    })

    const raw = (await res.json().catch(() => ({}))) as unknown
    if (!res.ok) {
        const err =
            typeof raw === 'object' && raw !== null && 'error' in raw
                ? String((raw as { error?: string }).error || res.statusText)
                : res.statusText
        throw new Error(`Uazapi send/media: ${res.status} ${err}`)
    }

    return { messageId: extractUazapiMessageId(raw), raw }
}
