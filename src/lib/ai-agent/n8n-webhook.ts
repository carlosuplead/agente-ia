/**
 * Chama workflow N8N (como no CR Pro). Payload inclui workspace_slug; organization_id espelha o slug para templates antigos.
 */

import { isIP } from 'node:net'

export type N8nWebhookPayload = {
    payload: string
    contact: {
        id: string
        name: string
        phone: string
    }
    conversation_id: string
    workspace_slug: string
    /** Compatível com fluxos copiados do CR Pro (substituir por workspace_slug no n8n). */
    organization_id: string
    /** Nome da função chamada no LLM (ex.: n8n_agendar, call_n8n_webhook). */
    n8n_tool?: string
}

export type N8nWebhookResult = {
    ok: boolean
    data?: string
    error?: string
}

export async function callN8nWebhook(
    webhookUrl: string,
    body: N8nWebhookPayload,
    timeoutSeconds: number = 30
): Promise<N8nWebhookResult> {
    if (!isSafeHttpUrl(webhookUrl)) {
        return { ok: false, error: 'URL do webhook inválida ou não permitida' }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000)

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        })

        clearTimeout(timer)

        if (!response.ok) {
            const text = await response.text().catch(() => '')
            console.error(`[n8n-webhook] HTTP ${response.status}: ${text}`)
            return { ok: false, error: `Webhook retornou status ${response.status}` }
        }

        const contentType = response.headers.get('content-type') || ''
        let data: string

        if (contentType.includes('application/json')) {
            const json = await response.json()
            data =
                typeof json === 'string'
                    ? json
                    : (json.message || json.result || json.response || JSON.stringify(json))
        } else {
            data = await response.text()
        }

        return { ok: true, data: data || 'OK' }
    } catch (err: unknown) {
        clearTimeout(timer)
        if (err instanceof Error && err.name === 'AbortError') {
            console.error(`[n8n-webhook] Timeout após ${timeoutSeconds}s`)
            return { ok: false, error: `Timeout: N8N não respondeu em ${timeoutSeconds} segundos` }
        }
        const message = err instanceof Error ? err.message : 'Erro ao chamar webhook'
        console.error('[n8n-webhook]', message)
        return { ok: false, error: message }
    }
}

function isBlockedWebhookHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host.endsWith('.local')) return true
    if (host === 'metadata.google.internal') return true

    const kind = isIP(host)
    if (kind === 4) {
        const parts = host.split('.')
        if (parts.length !== 4) return true
        const [a, b] = parts.map(Number)
        if (a === 0 || a === 127 || a === 10) return true
        if (a === 192 && b === 168) return true
        if (a === 169 && b === 254) return true
        if (a === 172 && b >= 16 && b <= 31) return true
        return false
    }
    if (kind === 6) {
        if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
        if (host.startsWith('fe80:')) return true
        if (host.startsWith('fc') || host.startsWith('fd')) return true
        const m = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
        if (m && isIP(m[1]) === 4) return isBlockedWebhookHost(m[1])
        return false
    }
    return false
}

function isSafeHttpUrl(value: string): boolean {
    try {
        const parsed = new URL(value)
        if (!['https:', 'http:'].includes(parsed.protocol)) return false
        if (isBlockedWebhookHost(parsed.hostname)) return false
        return true
    } catch {
        return false
    }
}
