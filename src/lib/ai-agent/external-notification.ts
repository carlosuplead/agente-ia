import type { AiAgentConfig, BuiltContext } from '@/lib/ai-agent/types'
import { normalizePhoneForBrazil } from '@/lib/phone'
import { decryptWorkspaceLlmKeyIfNeeded } from '@/lib/crypto/workspace-llm-keys'

/**
 * Notificação ao vendedor via UAZAPI dedicada (separada da instância principal
 * do cliente). Replica o bloco `ctr` do workflow n8n de referência:
 *
 *   POST {uazapi_url}/send/text
 *   headers: token: <token>
 *   body: { number, text }
 *
 * A função é invocada automaticamente após um evento (ex. criação de agenda).
 * É fire-and-forget — nunca quebra o fluxo principal do agente.
 */

const DEFAULT_TEMPLATE = [
    '🟢 Agenda criada com sucesso.',
    '',
    '👤 Lead: {nome}',
    '📱 Telefone: {telefone}',
    '🗓️ Agendamento: {agendamento}',
    '',
    '📝 Resumo:',
    '{resumo}'
].join('\n')

export type SellerNotificationEvent = 'appointment_created'

export type SellerNotificationPayload = {
    /** Rótulo do evento (ex. "Agendamento confirmado"). */
    stageLabel?: string
    /** Data/hora do agendamento em texto humano (ex. "23/04/2026 14:30 Europe/Lisbon"). */
    appointmentAt?: string
    /** Título/assunto do evento (ex. título fornecido à tool). */
    eventTitle?: string
    /** Resumo opcional para aparecer em {resumo}. */
    summary?: string
    /** Nome do vendedor (placeholder {vendedor}). */
    seller?: string
    /** Email do lead — pode vir vazio se não capturado. */
    leadEmail?: string
    /** Link do evento (Google Calendar). */
    eventLink?: string
}

function splitPhones(raw: string | null | undefined): string[] {
    if (!raw) return []
    return raw
        .split(/[\n,;]+/)
        .map(p => p.trim())
        .filter(Boolean)
}

function normalizeAllPhones(raw: string | null | undefined): string[] {
    const list = splitPhones(raw)
    const out = new Set<string>()
    for (const p of list) {
        const n = normalizePhoneForBrazil(p)
        if (n) out.add(n.replace(/\D/g, '')) // UAZAPI espera só dígitos
    }
    return Array.from(out)
}

function renderTemplate(template: string, data: Record<string, string>): string {
    let result = template
    for (const [k, v] of Object.entries(data)) {
        result = result.replace(new RegExp(`\\{\\s*${k}\\s*\\}`, 'gi'), v)
    }
    // Remove placeholders não preenchidos (ficam vazios em vez de "{foo}")
    return result.replace(/\{[a-zA-Z_][\w]*\}/g, '')
}

function buildMessageBody(
    template: string,
    context: BuiltContext,
    payload: SellerNotificationPayload
): string {
    const data: Record<string, string> = {
        nome: context.contactName || '—',
        telefone: context.contactPhone || '—',
        email: payload.leadEmail || '—',
        agendamento: payload.appointmentAt || '—',
        titulo: payload.eventTitle || '—',
        resumo: payload.summary || '—',
        vendedor: payload.seller || '—',
        link: payload.eventLink || '',
        etapa: payload.stageLabel || 'Agendamento confirmado',
        // Aliases em inglês para quem preferir
        name: context.contactName || '—',
        phone: context.contactPhone || '—',
        appointment: payload.appointmentAt || '—',
        summary: payload.summary || '—',
        title: payload.eventTitle || '—'
    }
    return renderTemplate(template, data).trim()
}

export function sellerNotificationLayerOn(config: AiAgentConfig): boolean {
    if (config.seller_notification_enabled !== true) return false
    if (!config.seller_notification_uazapi_url?.trim()) return false
    if (!config.seller_notification_uazapi_token?.trim()) return false
    return normalizeAllPhones(config.seller_notification_phones).length > 0
}

/**
 * Dispara uma notificação UAZAPI para todos os telefones configurados.
 * Nunca lança — regista erros em console mas não quebra o fluxo do agente.
 */
export async function sendSellerNotification(args: {
    config: AiAgentConfig
    context: BuiltContext
    event: SellerNotificationEvent
    payload: SellerNotificationPayload
}): Promise<void> {
    const { config, context, event, payload } = args

    if (!sellerNotificationLayerOn(config)) return
    if (event === 'appointment_created' && config.seller_notification_on_appointment === false) return

    const url = (config.seller_notification_uazapi_url || '').trim().replace(/\/+$/, '')
    const tokenStored = (config.seller_notification_uazapi_token || '').trim()
    if (!url || !tokenStored) return

    const token = decryptWorkspaceLlmKeyIfNeeded(tokenStored)
    if (!token) {
        console.error('[seller-notification] token could not be decrypted; skipping')
        return
    }

    const phones = normalizeAllPhones(config.seller_notification_phones)
    if (phones.length === 0) return

    const template = (config.seller_notification_message_template || '').trim() || DEFAULT_TEMPLATE
    const text = buildMessageBody(template, context, payload)
    if (!text) return

    const endpoint = `${url}/send/text`

    await Promise.all(
        phones.map(async number => {
            try {
                const controller = new AbortController()
                const tid = setTimeout(() => controller.abort(), 15_000)
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        token
                    },
                    body: JSON.stringify({ number, text }),
                    signal: controller.signal
                })
                clearTimeout(tid)
                if (!res.ok) {
                    let bodyText = ''
                    try {
                        bodyText = await res.text()
                    } catch {
                        /* ignore */
                    }
                    console.error(
                        `[seller-notification] UAZAPI HTTP ${res.status} at ${endpoint} → ${number}: ${bodyText.slice(0, 400)}`
                    )
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                console.error(`[seller-notification] failed to notify ${number}: ${msg}`)
            }
        })
    )
}
