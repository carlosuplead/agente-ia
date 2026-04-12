import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireWorkspaceMember } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { setFollowupAnchorForContact } from '@/lib/ai-agent/followup-anchor'
import { getUazapiBaseUrl } from '@/lib/uazapi'
import { GRAPH_API_BASE } from '@/lib/meta/graph-version'

const MEDIA_BUCKET = 'whatsapp-media'

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
                // ═══ Official Meta WhatsApp Cloud API ═══
                // Usa abordagem por LINK (URL) em vez de upload para /media
                // O endpoint /media requer permissão extra; /messages com link funciona

                // ── Step 1: Credenciais ──
                const { data: inst, error: instErr } = await supabase
                    .from('whatsapp_instances')
                    .select('phone_number_id, meta_access_token')
                    .eq('workspace_slug', workspace_slug)
                    .maybeSingle()

                if (instErr) throw new Error(`DB error: ${instErr.message}`)
                if (!inst?.phone_number_id || !inst?.meta_access_token) {
                    throw new Error('Credenciais da API oficial não configuradas')
                }

                // ── Step 2: Upload para Supabase Storage ──
                const safeMime = metaSafeMime(mimetype, media_type)
                const safeFilename = filename
                    ? filename.replace(/\.webm$/, safeMime === 'audio/ogg' ? '.ogg' : '.webm')
                    : `media-${Date.now()}.${extForMime(safeMime)}`
                const buffer = Buffer.from(base64Data, 'base64')
                const storagePath = `${workspace_slug}/${Date.now()}-${safeFilename}`

                console.log(`[send-media] official via link: type=${media_type} mime=${safeMime} file=${safeFilename} bytes=${buffer.length}`)

                const admin = await createAdminClient()

                // Garante que o bucket existe (ignora erro se já existir)
                await admin.storage.createBucket(MEDIA_BUCKET, {
                    public: true,
                    fileSizeLimit: 16 * 1024 * 1024 // 16MB
                }).catch(() => {})

                const { error: upErr } = await admin.storage
                    .from(MEDIA_BUCKET)
                    .upload(storagePath, buffer, {
                        contentType: safeMime,
                        upsert: true
                    })

                if (upErr) {
                    console.error('[send-media] Storage upload failed:', upErr.message)
                    throw new Error(`Storage upload falhou: ${upErr.message}`)
                }

                // URL pública (bucket é público)
                const { data: urlData } = admin.storage
                    .from(MEDIA_BUCKET)
                    .getPublicUrl(storagePath)

                const publicUrl = urlData?.publicUrl
                if (!publicUrl) {
                    throw new Error('Não foi possível gerar URL pública')
                }
                console.log('[send-media] Storage OK, url=', publicUrl)

                // ── Step 3: Enviar mensagem com link ──
                const toPhone = contact.phone.replace(/\D/g, '')
                const mediaPayload: Record<string, unknown> = { link: publicUrl }
                if (caption) mediaPayload.caption = caption

                const msgBody = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: toPhone,
                    type: media_type,
                    [media_type]: mediaPayload
                }

                console.log(`[send-media] sending via link: type=${media_type} to=${toPhone}`)

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
                    throw new Error(`Envio falhou (${sendRes.status}): ${JSON.stringify(sendJson).slice(0, 300)}`)
                }
                console.log('[send-media] Meta send OK:', JSON.stringify(sendJson).slice(0, 200))

                const msg = Array.isArray(sendJson.messages) ? (sendJson.messages[0] as { id?: string } | undefined) : undefined
                messageId = msg?.id ?? null

                // Limpar arquivo do storage depois de 2 min (Meta já baixou)
                setTimeout(() => {
                    admin.storage.from(MEDIA_BUCKET).remove([storagePath]).catch(() => {})
                }, 120_000)
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
            const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
            const errStack = sendErr instanceof Error ? sendErr.stack : undefined
            console.error('[send-media] SEND ERROR:', errMsg)
            if (errStack) console.error('[send-media] STACK:', errStack)
            await sql.unsafe(`UPDATE ${sch}.messages SET status = 'failed' WHERE id = $1::uuid`, [savedMessage.id]).catch(() => {})
            return NextResponse.json({ error: errMsg }, { status: 502 })
        }
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        const errStack = error instanceof Error ? error.stack : undefined
        console.error('[send-media] OUTER ERROR:', errMsg)
        if (errStack) console.error('[send-media] OUTER STACK:', errStack)
        return NextResponse.json({ error: errMsg }, { status: 500 })
    }
}
