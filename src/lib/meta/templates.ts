import { GRAPH_API_BASE } from '@/lib/meta/graph-version'

export type MetaTemplateComponent = Record<string, unknown>

export type MetaMessageTemplateRow = {
    id?: string
    name: string
    language?: string
    status?: string
    category?: string
    components?: MetaTemplateComponent[]
}

type GraphListResponse<T> = { data?: T[]; paging?: { next?: string; cursors?: { after?: string } } }

function authHeaders(accessToken: string): HeadersInit {
    return {
        Authorization: `Bearer ${accessToken}`
    }
}

export async function listMessageTemplates(
    wabaId: string,
    accessToken: string
): Promise<MetaMessageTemplateRow[]> {
    const out: MetaMessageTemplateRow[] = []
    let url: string | null =
        `${GRAPH_API_BASE}/${wabaId}/message_templates?fields=name,language,status,category,components&limit=100`

    while (url) {
        const res = await fetch(url, { headers: authHeaders(accessToken) })
        const json = (await res.json().catch(() => ({}))) as GraphListResponse<MetaMessageTemplateRow> & {
            error?: { message?: string }
        }
        if (!res.ok) {
            throw new Error(json.error?.message || `listMessageTemplates failed (${res.status})`)
        }
        for (const row of json.data || []) {
            const rawLang = row.language as string | { code?: string } | undefined
            const lang =
                typeof rawLang === 'string' ? rawLang : rawLang && typeof rawLang === 'object' ? rawLang.code : undefined
            out.push({
                ...row,
                language: lang
            })
        }
        url = json.paging?.next?.trim() || null
    }

    return out
}

export type TemplateMessageComponent = {
    type: string
    parameters?: Array<{ type: string; text?: string; [k: string]: unknown }>
    sub_type?: string
    index?: string
    [k: string]: unknown
}

export async function sendTemplateMessage(params: {
    phoneNumberId: string
    accessToken: string
    toE164Digits: string
    templateName: string
    languageCode: string
    components: TemplateMessageComponent[]
}): Promise<{ messageId: string | null; raw: unknown }> {
    const { phoneNumberId, accessToken, toE164Digits, templateName, languageCode, components } = params
    const body = {
        messaging_product: 'whatsapp',
        to: toE164Digits.replace(/\D/g, ''),
        type: 'template',
        template: {
            name: templateName,
            language: { code: languageCode },
            ...(components.length ? { components } : {})
        }
    }

    const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            ...authHeaders(accessToken),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    })
    const raw = await res.json().catch(() => ({}))
    if (!res.ok) {
        const msg =
            typeof (raw as { error?: { message?: string } }).error?.message === 'string'
                ? (raw as { error: { message: string } }).error.message
                : `sendTemplateMessage failed (${res.status})`
        throw new Error(msg)
    }
    const messages = (raw as { messages?: Array<{ id?: string }> }).messages
    const messageId = Array.isArray(messages) ? (messages[0]?.id ?? null) : null
    return { messageId, raw }
}
