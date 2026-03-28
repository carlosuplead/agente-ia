import type { SupabaseClient } from '@supabase/supabase-js'

export type OfficialInstanceRow = {
    workspace_slug: string
    phone_number_id: string
    waba_id: string
    meta_access_token: string
}

export async function getOfficialInstanceForWorkspace(
    supabase: SupabaseClient,
    workspaceSlug: string
): Promise<OfficialInstanceRow | null> {
    const { data } = await supabase
        .from('whatsapp_instances')
        .select('workspace_slug, phone_number_id, waba_id, meta_access_token, provider, status')
        .eq('workspace_slug', workspaceSlug)
        .maybeSingle()

    if (
        !data ||
        data.provider !== 'official' ||
        data.status !== 'connected' ||
        !data.phone_number_id ||
        !data.waba_id ||
        !data.meta_access_token
    ) {
        return null
    }

    return {
        workspace_slug: data.workspace_slug,
        phone_number_id: data.phone_number_id,
        waba_id: data.waba_id,
        meta_access_token: data.meta_access_token
    }
}
