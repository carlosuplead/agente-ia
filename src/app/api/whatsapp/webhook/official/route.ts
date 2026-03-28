import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { normalizePhoneForBrazil, generateBrazilianPhoneVariants, isWhatsAppGroup } from '@/lib/phone'
import { addToBuffer } from '@/lib/ai-agent/buffer'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { resetFollowupAnchorForContact } from '@/lib/ai-agent/followup-anchor'
import { parseMetaWebhookPayload } from '@/lib/whatsapp/providers/official.provider'

const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || ''

export async function GET(request: Request) {
    const url = new URL(request.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200 })
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(request: Request) {
    try {
        const raw = await request.text()
        const appSecret = process.env.META_APP_SECRET?.trim()
        if (appSecret) {
            const signature = request.headers.get('x-hub-signature-256')
            const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(raw).digest('hex')}`
            if (!signature || signature !== expected) {
                return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
            }
        }

        const body = JSON.parse(raw) as unknown
        const chunks = parseMetaWebhookPayload(body)
        if (!chunks.length) return NextResponse.json({ success: true })

        const supabase = await createAdminClient()
        const sql = getTenantSql()

        for (const c of chunks) {
            const { data: instance } = await supabase
                .from('whatsapp_instances')
                .select('workspace_slug')
                .eq('provider', 'official')
                .eq('phone_number_id', c.phoneNumberId)
                .maybeSingle()
            if (!instance?.workspace_slug) continue
            const ws = instance.workspace_slug
            const sch = quotedSchema(ws)

            for (const st of c.statuses) {
                await sql.unsafe(`UPDATE ${sch}.messages SET status = $2 WHERE whatsapp_id = $1`, [st.whatsappId, st.status])
            }

            for (const m of c.messages) {
                const dup = await sql.unsafe(`SELECT id FROM ${sch}.messages WHERE whatsapp_id = $1 LIMIT 1`, [m.whatsappId])
                if (dup.length) continue
                const normalized = normalizePhoneForBrazil(m.fromPhone)
                if (!normalized || isWhatsAppGroup(normalized.replace(/\D/g, ''))) continue
                const variants = generateBrazilianPhoneVariants(normalized)
                const rows = await sql.unsafe(`SELECT id FROM ${sch}.contacts WHERE phone = ANY($1::text[]) LIMIT 1`, [variants])
                let contactId = (rows[0] as { id?: string } | undefined)?.id
                if (!contactId) {
                    const ins = await sql.unsafe(
                        `INSERT INTO ${sch}.contacts (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
                        [normalized, m.fromName || normalized]
                    )
                    contactId = (ins[0] as { id?: string } | undefined)?.id
                }
                if (!contactId) continue
                const convRows = await sql.unsafe(
                    `SELECT id FROM ${sch}.ai_conversations WHERE contact_id = $1::uuid AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
                    [contactId]
                )
                const conversationId = (convRows[0] as { id?: string } | undefined)?.id || null

                const insMsg = await sql.unsafe(
                    `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, media_type, status, whatsapp_id, created_at)
                     VALUES ($1::uuid, $2::uuid, 'contact', $3, $4, 'received', $5, COALESCE(to_timestamp($6 / 1000.0), now()))
                     RETURNING id`,
                    [contactId, conversationId, m.body || 'Midia enviada', m.mediaType, m.whatsappId, m.timestampMs]
                )
                const messageId = (insMsg[0] as { id?: string } | undefined)?.id
                if (messageId) {
                    await resetFollowupAnchorForContact(ws, contactId).catch(() => {})
                    await addToBuffer(ws, contactId, messageId).catch(() => {})
                }
            }
        }
        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('official webhook', e)
        return NextResponse.json({ success: true })
    }
}
