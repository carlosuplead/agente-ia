import { GRAPH_API_BASE } from '@/lib/meta/graph-version'

const MSG_MAX = 220

function truncateMessage(msg: string): string {
    const t = msg.trim()
    return t.length <= MSG_MAX ? t : `${t.slice(0, MSG_MAX)}…`
}

type GraphErrorBody = { error?: { message?: string } }

function graphErrorMessage(json: unknown, fallback: string): string {
    const e = (json as GraphErrorBody).error?.message
    return truncateMessage(e || fallback)
}

export type VerifyOfficialCredentialsResult =
    | { ok: true; displayPhoneNumber: string | null }
    | { ok: false; error: string }

/**
 * Valida token + Phone Number ID na Graph API e confirma que o número pertence à WABA.
 */
export async function verifyOfficialWhatsAppCredentials(params: {
    phoneNumberId: string
    wabaId: string
    accessToken: string
}): Promise<VerifyOfficialCredentialsResult> {
    const phoneNumberId = params.phoneNumberId.trim()
    const wabaId = params.wabaId.trim()
    const accessToken = params.accessToken.trim()

    if (!phoneNumberId || !wabaId || !accessToken) {
        return { ok: false, error: 'Phone Number ID, WABA ID e token são obrigatórios.' }
    }

    const phonePath = `/${phoneNumberId}?fields=id,display_phone_number,verified_name`
    const phoneRes = await fetch(`${GRAPH_API_BASE}${phonePath}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    })
    const phoneJson = (await phoneRes.json().catch(() => ({}))) as GraphErrorBody & {
        id?: string
        display_phone_number?: string
    }

    if (!phoneRes.ok || (phoneJson as GraphErrorBody).error) {
        return {
            ok: false,
            error: graphErrorMessage(phoneJson, `Não foi possível validar o número (HTTP ${phoneRes.status}).`)
        }
    }

    if (phoneJson.id && phoneJson.id !== phoneNumberId) {
        return { ok: false, error: 'Resposta inválida da API Meta para o Phone Number ID.' }
    }

    const ids = new Set<string>()
    let listUrl: string | null = `${GRAPH_API_BASE}/${wabaId}/phone_numbers?fields=id&limit=100`

    while (listUrl) {
        const listRes = await fetch(listUrl, {
            headers: { Authorization: `Bearer ${accessToken}` }
        })
        const listJson = (await listRes.json().catch(() => ({}))) as GraphErrorBody & {
            data?: Array<{ id?: string }>
            paging?: { next?: string }
        }

        if (!listRes.ok || listJson.error) {
            return {
                ok: false,
                error: graphErrorMessage(listJson, `Não foi possível listar números da WABA (HTTP ${listRes.status}).`)
            }
        }

        for (const row of listJson.data || []) {
            if (row.id) ids.add(row.id)
        }

        listUrl = listJson.paging?.next ?? null
    }

    if (!ids.has(phoneNumberId)) {
        return {
            ok: false,
            error: 'O Phone Number ID não pertence à WABA indicada ou o token não tem permissão para a WABA.'
        }
    }

    const display = phoneJson.display_phone_number?.trim() || null
    return { ok: true, displayPhoneNumber: display }
}
