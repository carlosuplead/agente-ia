import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { setFollowupAnchorForContact } from '@/lib/ai-agent/followup-anchor'
import { getUazapiBaseUrl } from '@/lib/uazapi'
import { GRAPH_API_BASE } from '@/lib/meta/graph-version'

/** MIME types suportados pela Meta para audio — audio/webm NÃO é aceito */
function metaSafeMime(mime: string, mediaType: string): string {
    if (mediaType !== 'audio') return mime
    // Meta rejeita audio/webm; remap para audio/ogg (mesmo codec Opus)
    if (mime.startsWith('audio/webm')) return 'audio/ogg'
    return mime
}

/** Extensão padrão para o MIME */
function extForMime(mime: string): string {
    if (mime.startsWith('audio/ogg')) return 'ogg'
    if (mime.startsWith('audio/webm')) return 'webm'
    if (mime.startsWith('audio/mp4') || mime.startsWith('audio/m4a')) return 'm4a'
    if (mime.startsWith('audio/mpeg')) return 'mp3'
    if (mime.startsWith('image/png')) return 'png'
    if (mime.startsWith('image/jpeg') || mime.startsWith('image/jpg')) return 'jpg'
    if (mime.startsWith('image/webp')) return 'webp'
    if (mime.startsWith('video/mp4')) return 'mp4'
    if (mime.startsWith('application/pdf')) return 'pdf'
    return 'bin'
}

/** Vercel function config — media upload pode demorar */
export const maxDuration = 30

/** Build multipart/form-data body manually — works reliably in Node.js serverless */
function buildMultipartBody(fields: Record<string, string>, fileField: { name: string; data: Buffer; filename: string; contentType: string }) {
    const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`
    const parts: Buffer[] = []

    for (const [key, value] of Object.entries(fields)) {
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
        ))
    }

    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.contentType}\r\n\r\n`
    ))
    parts.push(fileField.data)
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

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
            .maybeSingle()

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

        // Save message to DB — inclui nome do arquivo e caption
        const bodyText = caption || (filename ? `[${media_type}: ${filename}]` : `[${media_type}]`)
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
            let messageId: string | null = null

            if (instance.provider === 'official') {
                // Official Meta Cloud API — upload media then send

                const { data: inst } = await supabase
                    .from('whatsapp_instances')
                    .select('phone_number_id, meta_access_token')
                    .eq('workspace_slug', workspace_slug)
                    .maybeSingle()

                if (!inst?.phone_number_id || !inst?.meta_access_token) {
                    throw new Error('Official provider credentials missing')
                }

                // 1. Upload media to Meta
                // Remap MIME type para audio (Meta rejeita audio/webm)
                const safeMime = metaSafeMime(mimetype, media_type)
                const safeFilename = filename
                    ? filename.replace(/\.webm$/, safeMime === 'audio/ogg' ? '.ogg' : '.webm')
                    : `media-${Date.now()}.${extForMime(safeMime)}`

                const buffer = Buffer.from(base64Data, 'base64')

                console.log(`[send-media] official upload: mime=${safeMime} origMime=${mimetype} file=${safeFilename} size=${buffer.length} phoneId=${inst.phone_number_id}`)

                // Manual multipart — FormData+Blob nativos do Node.js falham no Vercel
                const { body: uploadBody, contentType: uploadCt } = buildMultipartBody(
                    { messaging_product: 'whatsapp', type: safeMime },
                    { name: 'file', data: buffer, filename: safeFilename, contentType: safeMime }
                )

                const uploadRes = await fetch(`${GRAPH_API_BASE}/${inst.phone_number_id}/media`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${inst.meta_access_token}`,
                        'Content-Type': uploadCt
                    },
                    body: uploadBody
                })
                const uploadText = await uploadRes.text()
                console.log(`[send-media] Meta upload response (${uploadRes.status}):`, uploadText.slice(0, 500))
                let uploadJson: { id?: string; error?: { message?: string; code?: number; error_subcode?: number } } = {}
                try { uploadJson = JSON.parse(uploadText) } catch { /* not JSON */ }

                if (!uploadRes.ok || !uploadJson.id) {
                    const errDetail = uploadJson.error
                        ? `code=${uploadJson.error.code} sub=${uploadJson.error.error_subcode} msg=${uploadJson.error.message}`
                        : uploadText.slice(0, 300)
                    console.error(`[send-media] Meta upload FAILED (${uploadRes.status}):`, errDetail)
                    throw new Error(`Meta media upload failed (${uploadRes.status}): ${errDetail}`)
                }
                console.log('[send-media] Meta upload OK, media_id=', uploadJson.id)

                // 2. Send message with uploaded media
                const msgBody: Record<string, unknown> = {
                    messaging_product: 'whatsapp',
                    to: contact.phone.replace(/\D/g, ''),
                    type: media_type
                }
                const mediaPayload: Record<string, unknown> = { id: uploadJson.id }
                if (caption) mediaPayload.caption = caption
                msgBody[media_type] = mediaPayload

                const sendRes = await fetch(`${GRAPH_API_BASE}/${inst.phone_number_id}/messages`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${inst.meta_access_token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(msgBody)
                })
                const sendJson = (await sendRes.json().catch(() => ({}))) as Record<string, unknown>
                if (!sendRes.ok) {
                    console.error(`[send-media] Meta send FAILED (${sendRes.status}):`, JSON.stringify(sendJson).slice(0, 500))
                    throw new Error(`Meta send media failed (${sendRes.status}): ${JSON.stringify(sendJson).slice(0, 300)}`)
                }
                console.log('[send-media] Meta send OK:', JSON.stringify(sendJson).slice(0, 200))
                const msg = Array.isArray(sendJson.messages) ? (sendJson.messages[0] as { id?: string } | undefined) : undefined
                messageId = msg?.id ?? null
            } else {
                // Uazapi — send via /send/media
                const base = getUazapiBaseUrl()
                // Audio vai como 'ptt' (Push-to-Talk = nota de voz no WhatsApp)
                const uazapiType = media_type === 'audio' ? 'ptt' : media_type
                const sendBody: Record<string, unknown> = {
                    number: contact.phone,
                    type: uazapiType,
                    file: base64Data,
                    mimetype,
                    delay: 1200
                }
                // caption: texto que aparece junto da media no WhatsApp
                if (caption) sendBody.caption = caption
                // fileName (camelCase): nome do arquivo que aparece pro destinatário
                // Uazapi espera fileName, não filename
                if (filename) {
                    sendBody.fileName = filename
                    sendBody.filename = filename // fallback para versões diferentes do Uazapi
                    // Se não tem caption e é documento, usa o nome do arquivo como caption
                    if (!caption && media_type === 'document') {
                        sendBody.caption = filename
                    }
                }

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
                messageId = typeof raw.messageId === 'string' ? raw.messageId :
                    typeof raw.id === 'string' ? raw.id : null
            }

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
        } catch (sendErr) {
            console.error('[send-media] SEND ERROR:', sendErr instanceof Error ? sendErr.message : sendErr)
            await sql.unsafe(`UPDATE ${sch}.messages SET status = 'failed' WHERE id = $1::uuid`, [savedMessage.id]).catch(() => {})
            return NextResponse.json(
                { error: sendErr instanceof Error ? sendErr.message : 'Failed to send media' },
                { status: 502 }
            )
        }
    } catch (error) {
        console.error('whatsapp send-media', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
