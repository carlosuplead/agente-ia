import { GRAPH_API_BASE } from '@/lib/meta/graph-version'

export type DiscoveredPhone = {
    phone_number_id: string
    waba_id: string
    display_phone_number?: string
    verified_name?: string
}

async function wabaIdsFromDebugToken(accessToken: string, appId: string, appSecret: string): Promise<string[]> {
    const url = new URL(`${GRAPH_API_BASE}/debug_token`)
    url.searchParams.set('input_token', accessToken)
    url.searchParams.set('access_token', `${appId}|${appSecret}`)
    const res = await fetch(url.toString())
    if (!res.ok) return []
    const data = (await res.json().catch(() => ({}))) as {
        data?: { granular_scopes?: Array<{ scope?: string; target_ids?: string[] }> }
    }
    const out = new Set<string>()
    for (const g of data.data?.granular_scopes || []) {
        const scope = (g.scope || '').toLowerCase()
        if (scope.includes('whatsapp') || scope === 'whatsapp_business_management' || scope === 'whatsapp_business_messaging') {
            for (const tid of g.target_ids || []) if (tid) out.add(tid)
        }
    }
    return [...out]
}

export async function discoverWhatsAppPhones(accessToken: string, appId: string, appSecret: string): Promise<DiscoveredPhone[]> {
    const result: DiscoveredPhone[] = []
    const wabaIds = new Set<string>()
    const businessesRes = await fetch(
        `${GRAPH_API_BASE}/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id},client_whatsapp_business_accounts{id}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (businessesRes.ok) {
        const businesses = (await businessesRes.json().catch(() => ({}))) as {
            data?: Array<{
                owned_whatsapp_business_accounts?: { data?: Array<{ id: string }> }
                client_whatsapp_business_accounts?: { data?: Array<{ id: string }> }
            }>
        }
        for (const b of businesses.data || []) {
            for (const x of b.owned_whatsapp_business_accounts?.data || []) wabaIds.add(x.id)
            for (const x of b.client_whatsapp_business_accounts?.data || []) wabaIds.add(x.id)
        }
    }

    if (wabaIds.size === 0) {
        for (const id of await wabaIdsFromDebugToken(accessToken, appId, appSecret)) wabaIds.add(id)
    }

    for (const wabaId of wabaIds) {
        const phonesRes = await fetch(`${GRAPH_API_BASE}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        })
        if (!phonesRes.ok) continue
        const phones = (await phonesRes.json().catch(() => ({}))) as {
            data?: Array<{ id: string; display_phone_number?: string; verified_name?: string }>
        }
        for (const p of phones.data || []) {
            result.push({
                phone_number_id: p.id,
                waba_id: wabaId,
                display_phone_number: p.display_phone_number,
                verified_name: p.verified_name
            })
        }
    }
    return result
}
