export async function addToBuffer(workspaceSlug: string, contactId: string, _messageId: string) {
    const secret = process.env.INTERNAL_AI_SECRET
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    if (!secret) {
        console.error('INTERNAL_AI_SECRET missing; skip AI schedule')
        return
    }
    try {
        await fetch(`${base}/api/ai/schedule`, {
            method: 'POST',
            body: JSON.stringify({ workspace_slug: workspaceSlug, contact_id: contactId }),
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${secret}`
            }
        }).catch(() => {})
    } catch (e) {
        console.error('Falha ao agendar processamento do agente', e)
    }
}
