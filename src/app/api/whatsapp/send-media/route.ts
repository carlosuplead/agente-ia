import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { setFollowupAnchorForContact } from '@/lib/ai-agent/followup-anchor'
import { getUazapiBaseUrl } from '@/lib/uazapi'

/**
 * POST — send media (image, video, audio, document) via WhatsApp
 * Body: multipart/form-data with fields:
 *   workspace_slug, contact_id, media_type (image|video|audio|document), file (binary), caption?
 *
 * Or JSON with base64:
 *   workspace_slug, contact_id, media_type, base64, mimetype, caption?, filename?
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient()

        let workspace_slug: string
        let contact_id: string
        let media_type: string
        let base64Data: string
        let mimetype: string
        let caption: string | null = null
        let filename: string | null = null

        const contentType = request.headers.get('content-type') || ''

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData()
            workspace_slug = formData.get('workspace_slug') as string
            contact_id = formData.get('contact_id') as string
            media_type = formData.get('media_type') as string
            caption = (formData.get('caption') as string) || null
            filename = (formData.get('filename') as string) || null

            const file = formData.get('file') as File | null
            if (!file) {
                return NextResponse.json({ error: 'file is required' }, { status: 400 })
            }
            mimetype = file.type || 'application/octet-stream'
            const buffer = Buffer.from(await file.arrayBuffer())
            base64Data = buffer.toString('base64')
        } else {
            const body = await request.json()
            workspace_slug = body.workspace_slug
            contact_id = body.contact_id
            media_type = body.media_type
            base64Data = body.base64
            mimetype = body.mimetype || 'application/octet-stream'
            caption = body.caption || null
            filename = body.filename || null
        }

        if (!workspace_slug || !contact_id || !media_type || !base64Data) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const validTypes = ['image', 'video', 'audio', 'document']
        if (!validTypes.includes(media_type)) {
            return NextResponse.json({ error: 'media_type must be image, video, audio, or document' }, { status: 400 })
        }

        const access = await requireWorkspaceMember(supabase, workspace_slug)
        if (!access.ok) return access.response

        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('instance_token, status, provider')
            .eq('workspace_slug', workspace_slug)
            .single()

        if (!instance || instance.status !== 'connected') {
            return NextResponse.json({ error: 'WhatsApp is not connected' }, { status: 400 })
        }

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)

        const contacts = await sql.unsafe(
            `SELECT phone FROM ${sch}.contacts WHERE id = $1::uuid LIMIT 1`,
            [contact_id]
        )
        const contact = contacts[0] as unknown as { phone: string } | undefined
        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        // Get active conversation
        let activeConvId: string | null = null
        try {
            const convRows = await sql.unsafe(
                `SELECT id FROM ${sch}.ai_conversations
                 WHERE contact_id = $1::uuid AND status = 'active'
                 ORDER BY created_at DESC LIMIT 1`,
                [contact_id]
            )
            activeConvId = (convRows[0] as unknown as { id: string } | undefined)?.id ?? null
        } catch { /* ignore */ }

        // Save message to DB
        const bodyText = caption || `[${media_type}]`
        const savedRows = await sql.unsafe(
            `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, media_type, status)
             VALUES ($1::uuid, $2::uuid, 'user', $3, $4, 'sending')
             RETURNING id`,
            [contact_id, activeConvId, bodyText, media_type]
        )
        const savedMessage = savedRows[0] as unknown as { id: string } | undefined
        if (!savedMessage) {
            return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
        }

        try {
            // Send via Uazapi (supports all media types via /send/media)
            const base = getUazapiBaseUrl()
            const sendBody: Record<string, unknown> = {
                number: contact.phone,
                type: media_type,
                file: base64Data,
                mimetype,
                delay: 1200
            }
            if (caption) sendBody.caption = caption
            if (filename) sendBody.fileName = filename

            const res = await fetch(`${base}/send/media`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    token: instance.instance_token
                },
                body: JSON.stringify(sendBody)
            })

            const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
            if (!res.ok) {
                throw new Error(`Media send failed (${res.status})`)
            }

            const messageId = typeof raw.messageId === 'string' ? raw.messageId :
                typeof raw.id === 'string' ? raw.id : null

            await sql.unsafe(
                `UPDATE ${sch}.messages SET status = 'sent', whatsapp_id = $2 WHERE id = $1::uuid`,
                [savedMessage.id, messageId]
            )

            await setFollowupAnchorForContact(workspace_slug, contact_id).catch(() => {})

            // Pause AI when human sends
            if (activeConvId) {
                await sql.unsafe(
                    `UPDATE ${sch}.ai_conversations SET status = 'handed_off', handoff_reason = 'Atendente assumiu a conversa'
                     WHERE id = $1::uuid AND status = 'active'`,
                    [activeConvId]
                ).catch(() => {})
            }

            return NextResponse.json({ success: true, messageId: savedMessage.id })
        } catch {
            await sql.unsafe(`UPDATE ${sch}.messages SET status = 'failed' WHERE id = $1::uuid`, [savedMessage.id])
            return NextResponse.json({ error: 'Failed to send media' }, { status: 502 })
        }
    } catch (error) {
        console.error('whatsapp send-media', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
