import type { SupabaseClient } from '@supabase/supabase-js'
import type { WhatsAppProvider, WhatsAppProviderType } from '@/lib/whatsapp/provider.interface'
import { UazapiProvider } from '@/lib/whatsapp/providers/uazapi.provider'
import { OfficialApiProvider } from '@/lib/whatsapp/providers/official.provider'

const uazapiProvider = new UazapiProvider()

type InstanceRow = {
    instance_token: string
    provider: WhatsAppProviderType | null
    phone_number_id: string | null
    meta_access_token: string | null
}

export async function getProviderForWorkspace(
    supabase: SupabaseClient,
    workspaceSlug: string
): Promise<{ provider: WhatsAppProvider; instance: InstanceRow | null }> {
    const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_token, provider, phone_number_id, meta_access_token')
        .eq('workspace_slug', workspaceSlug)
        .maybeSingle()

    if (!instance) return { provider: uazapiProvider, instance: null }
    if (instance.provider === 'official') {
        if (!instance.phone_number_id || !instance.meta_access_token) {
            throw new Error('Official provider configured but credentials (phone_number_id / meta_access_token) are missing')
        }
        return {
            provider: new OfficialApiProvider({
                phoneNumberId: instance.phone_number_id,
                accessToken: instance.meta_access_token
            }),
            instance: instance as InstanceRow
        }
    }
    return { provider: uazapiProvider, instance: instance as InstanceRow }
}

