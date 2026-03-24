import type { SupabaseClient } from '@supabase/supabase-js'

export async function addToBuffer(
    supabase: SupabaseClient,
    workspaceSlug: string,
    contactId: string,
    messageId: string
) {
    // Para simplificar a infra, como não temos CRON nativo em Next.js edge/serverless fácil,
    // podemos processar direto via fetch em tempo real (delay ou inline) no webhook.
    try {
        await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/ai/process`, {
            method: 'POST',
            body: JSON.stringify({ workspace_slug: workspaceSlug, contact_id: contactId }),
            headers: { 'Content-Type': 'application/json' }
        }).catch(() => {})
    } catch (e) {
        console.error('Falha ao acionar processamento do agente', e)
    }
}
