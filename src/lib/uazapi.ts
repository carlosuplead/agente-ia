// Integração UAZAPI (uazapiGO v2) — baseado na OpenAPI spec oficial.
// Auth: header `token` para endpoints de instância, header `admintoken` para admin.
// Endpoints: /instance/init, /instance/connect, /instance/status, /instance (DELETE)
//            /send/text, /send/media

export interface UazapiConnectResult {
    qrcode: string
    pairingCode: string
}

/** Base URL sem barra final. */
export function getUazapiBaseUrl(): string {
    const raw = (process.env.UAZAPI_URL || 'https://api.uazapi.com').trim()
    return raw.replace(/\/+$/, '') || 'https://api.uazapi.com'
}

function adminToken(): string {
    return (process.env.UAZAPI_ADMIN_TOKEN || process.env.UAZAPI_GLOBAL_TOKEN || '').trim()
}

/**
 * True se o valor guardado como instance_token for na verdade o admintoken do .env.
 * O OpenAPI exige header `token` = token da INSTÂNCIA em /instance/connect; usar o admin dá 401.
 */
export function isInstanceTokenConfusedWithAdminToken(instanceToken: string): boolean {
    const t = instanceToken.trim()
    if (!t) return false
    const adm = adminToken()
    return adm.length > 0 && t === adm
}

// ──────────────────────────────────────────────── Instance Management

/**
 * POST /instance/init
 * Cria uma instância remota e devolve o token da instância.
 * Auth: header `admintoken`.
 */
export async function createRemoteInstance(displayName: string): Promise<{ token: string }> {
    const adm = adminToken()
    if (!adm) {
        throw new Error(
            'Uazapi: falta token administrativo. Define UAZAPI_ADMIN_TOKEN ou UAZAPI_GLOBAL_TOKEN.'
        )
    }

    const base = getUazapiBaseUrl()
    const res = await fetch(`${base}/instance/init`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            admintoken: adm
        },
        body: JSON.stringify({ name: displayName })
    })

    if (!res.ok) {
        const text = await res.text()
        throw new Error(`Uazapi create instance: ${res.status} ${text}`)
    }

    const data = (await res.json()) as Record<string, unknown>

    // A spec devolve {token, instance: {token, ...}, ...}
    const token =
        (typeof data.token === 'string' && data.token) ||
        (data.instance && typeof (data.instance as { token?: string }).token === 'string'
            ? (data.instance as { token: string }).token
            : null) ||
        null

    if (!token) {
        throw new Error('Uazapi create instance: resposta sem token')
    }

    return { token: token.trim() }
}

export type UazapiRemoteStatus = {
    dbStatus: 'connected' | 'connecting' | 'disconnected'
    qrcode?: string
    pairingCode?: string
    phoneE164: string | null
}

/**
 * GET /instance/status
 * Auth: header `token` (token da instância).
 */
export async function fetchRemoteInstanceStatus(instanceToken: string): Promise<UazapiRemoteStatus | null> {
    const t = instanceToken.trim()
    if (!t) return null

    const base = getUazapiBaseUrl()
    const res = await fetch(`${base}/instance/status`, {
        method: 'GET',
        headers: { token: t }
    })

    if (!res.ok) {
        // 401 = token inválido/instância não existe mais
        return null
    }

    let data: Record<string, unknown>
    try {
        data = (await res.json()) as Record<string, unknown>
    } catch {
        return null
    }

    // Resposta: { instance: {...}, status: { connected, loggedIn, jid } }
    const instRaw = data.instance
    const inst =
        instRaw && typeof instRaw === 'object'
            ? (instRaw as Record<string, unknown>)
            : data

    const stRaw = data.status
    const st = stRaw && typeof stRaw === 'object' ? (stRaw as Record<string, unknown>) : null

    const uazStatus =
        typeof inst.status === 'string' ? inst.status.trim().toLowerCase() : ''

    const connectedByFlags =
        st?.connected === true && st?.loggedIn === true

    let dbStatus: UazapiRemoteStatus['dbStatus'] = 'disconnected'
    if (connectedByFlags || uazStatus === 'connected') {
        dbStatus = 'connected'
    } else if (uazStatus === 'connecting') {
        dbStatus = 'connecting'
    }

    const qrcode = typeof inst.qrcode === 'string' && inst.qrcode ? inst.qrcode : undefined
    const pairingCode =
        typeof inst.paircode === 'string' && inst.paircode
            ? inst.paircode
            : undefined

    let phoneE164: string | null = null
    const jid = (st?.jid ?? inst.jid) as Record<string, unknown> | undefined
    if (jid && typeof jid === 'object') {
        const user = typeof jid.user === 'string' ? jid.user.replace(/\D/g, '') : ''
        if (user.length >= 10) {
            phoneE164 = user
        }
    }

    return { dbStatus, qrcode, pairingCode, phoneE164 }
}

/**
 * DELETE /instance
 * Remove a instância no servidor UAZAPI.
 * Auth: header `token` (token da instância).
 * Se retornar 401 ou 404 → instância já não existe, ignoramos.
 */
export async function deleteRemoteInstance(instanceToken: string): Promise<void> {
    const t = instanceToken.trim()
    if (!t) return // nada a deletar

    const base = getUazapiBaseUrl()
    const res = await fetch(`${base}/instance`, {
        method: 'DELETE',
        headers: { token: t }
    })

    // 200 = deletou, 401/404 = já não existe → tudo OK.
    if (res.ok || res.status === 401 || res.status === 404) {
        return
    }

    const text = await res.text().catch(() => '')
    throw new Error(`Uazapi delete instance: ${res.status} ${text}`)
}

/**
 * POST /webhook (modo simples — recomendado pela spec)
 * Configura o webhook da instância para receber eventos.
 * Auth: header `token` (token da instância).
 *
 * Payload:
 *   url: URL destino
 *   enabled: true
 *   events: ["messages"] — só precisamos de mensagens recebidas
 *   excludeMessages: ["wasSentByApi", "isGroupYes"] — evita eco e grupos
 *   addUrlEvents: false
 *   addUrlTypesMessages: false
 *
 * Modo simples (sem action/id): cria ou atualiza automaticamente.
 */
export async function configureInstanceWebhook(instanceToken: string, webhookUrl: string): Promise<boolean> {
    const t = instanceToken.trim()
    if (!t || !webhookUrl) return false

    const base = getUazapiBaseUrl()

    try {
        const res = await fetch(`${base}/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                token: t
            },
            body: JSON.stringify({
                enabled: true,
                url: webhookUrl,
                events: ['messages'],
                excludeMessages: ['wasSentByApi', 'isGroupYes'],
                addUrlEvents: false,
                addUrlTypesMessages: false
            })
        })

        if (res.ok) {
            console.log(`[uazapi] Webhook configurado para instância: ${webhookUrl}`)
            return true
        }

        const errText = await res.text().catch(() => '')
        console.warn(`[uazapi] Falha ao configurar webhook: ${res.status} ${errText}`)
        return false
    } catch (e) {
        console.warn('[uazapi] Erro ao configurar webhook:', e)
        return false
    }
}

// ──────────────────────────────────────────────── Connect

/**
 * POST /instance/connect
 * Inicia o processo de conexão (gera QR code ou pairing code).
 * Auth: header `token` (token da instância).
 * Body opcional: { phone: "5511..." } para gerar pairing code em vez de QR.
 */
export async function connect(instanceToken: string): Promise<UazapiConnectResult> {
    const t = instanceToken.trim()
    if (!t) {
        throw new Error('Uazapi: token da instância vazio')
    }

    const base = getUazapiBaseUrl()
    const res = await fetch(`${base}/instance/connect`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            token: t
        },
        body: JSON.stringify({})
    })

    if (!res.ok) {
        const errBody = await res.text().catch(() => '')

        // Se 401, tenta ler o status para ver se já tem QR disponível
        if (res.status === 401) {
            const fromStatus = await tryConnectPayloadFromStatus(t)
            if (fromStatus) return fromStatus
        }

        throw new Error(`Uazapi connect: ${res.status} ${errBody || res.statusText}`)
    }

    let data: Record<string, unknown>
    try {
        data = (await res.json()) as Record<string, unknown>
    } catch {
        throw new Error('Uazapi connect: resposta JSON inválida')
    }

    const normalized = normalizeConnectPayload(data)

    // Se a resposta 200 não trouxe QR, consulta status (pode estar a gerar)
    if (!normalized.qrcode && !normalized.pairingCode) {
        const fromStatus = await tryConnectPayloadFromStatus(t)
        if (fromStatus) return fromStatus
    }

    return normalized
}

function normalizeConnectPayload(data: Record<string, unknown>): UazapiConnectResult {
    const instRaw = data.instance
    const inst =
        instRaw && typeof instRaw === 'object'
            ? (instRaw as Record<string, unknown>)
            : data

    const qrcode =
        typeof inst.qrcode === 'string'
            ? inst.qrcode
            : typeof data.qrcode === 'string'
              ? data.qrcode
              : ''

    const pairingCode =
        typeof inst.paircode === 'string'
            ? inst.paircode
            : typeof data.paircode === 'string'
              ? data.paircode
              : ''

    return { qrcode, pairingCode }
}

/** Verifica GET /instance/status para obter QR/pairing code (ex.: instância já em connecting). */
async function tryConnectPayloadFromStatus(instanceToken: string): Promise<UazapiConnectResult | null> {
    const remote = await fetchRemoteInstanceStatus(instanceToken)
    if (!remote) return null
    if (remote.qrcode || remote.pairingCode) {
        return {
            qrcode: remote.qrcode || '',
            pairingCode: remote.pairingCode || ''
        }
    }
    return null
}

// ──────────────────────────────────────────────── Send Messages

export type SendTextOptions = {
    delayMs?: number
    /** Omitir ou `none` para não enviar indicador de presença. */
    presence?: string | null
}

/**
 * POST /send/text
 * Auth: header `token` (token da instância).
 * Body: { number, text, delay? }
 */
export async function sendTextMessage(
    instanceToken: string,
    phone: string,
    text: string,
    sendOpts?: SendTextOptions
) {
    const t = instanceToken.trim()
    const delay = sendOpts?.delayMs ?? 1200
    const base = getUazapiBaseUrl()

    const res = await fetch(`${base}/send/text`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            token: t
        },
        body: JSON.stringify({
            number: phone,
            text,
            delay
        })
    })

    if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Uazapi send text: ${res.status} ${errText || res.statusText}`)
    }

    return res.json()
}

export type SendMediaAudioOptions = {
    delayMs?: number
    /** Conforme OpenAPI: audio (MP3/OGG), ptt, myaudio */
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
 * POST /send/media
 * Auth: header `token` (token da instância).
 * Body: { number, type, file (base64 ou URL), mimetype? }
 */
export async function sendMediaAudio(
    instanceToken: string,
    phone: string,
    audioBytes: ArrayBuffer,
    opts?: SendMediaAudioOptions
): Promise<{ messageId: string | null; raw: unknown }> {
    const t = instanceToken.trim()
    const type = opts?.uazapiType ?? 'audio'
    const delay = opts?.delayMs ?? 1200
    const base64 = Buffer.from(audioBytes).toString('base64')
    const base = getUazapiBaseUrl()

    const res = await fetch(`${base}/send/media`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            token: t
        },
        body: JSON.stringify({
            number: phone,
            type,
            file: base64,
            mimetype: 'audio/mpeg',
            delay
        })
    })

    const raw = (await res.json().catch(() => ({}))) as unknown
    if (res.ok) {
        return { messageId: extractUazapiMessageId(raw), raw }
    }

    const err =
        typeof raw === 'object' && raw !== null && 'error' in raw
            ? String((raw as { error?: string }).error || res.statusText)
            : res.statusText

    throw new Error(`Uazapi send/media: ${res.status} ${err}`)
}
