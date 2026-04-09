import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { normalizePhoneForBrazil, generateBrazilianPhoneVariants, isWhatsAppGroup } from '@/lib/phone'
import { addToBuffer } from '@/lib/ai-agent/buffer'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { resetFollowupAnchorForContact } from '@/lib/ai-agent/followup-anchor'
import { parseMetaWebhookPayload } from '@/lib/whatsapp/providers/official.provider'
import { shouldAcceptInboundForTestMode } from '@/lib/ai-agent/test-mode-allowlist'
import { ensureMediaColumns } from '@/lib/ai-agent/media-processing'

const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || ''

function isProductionRuntime(): boolean {
    return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
}

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
        if (isProductionRuntime() && !appSecret) {
            console.error('META_APP_SECRET is required in production for WhatsApp Cloud API webhooks')
            return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
        }
        if (appSecret) {
            const signature = request.headers.get('x-hub-signature-256')
            if (!signature) {
                return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
            }
            const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(raw).digest('hex')}`
            // Comparação em tempo constante para prevenir timing attacks
            const sigBuf = Buffer.from(signature)
            const expBuf = Buffer.from(expected)
            if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
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

            // Garantir colunas media_ref/media_processed se houver mídia neste batch
            const hasMediaInBatch = c.messages.some(m => m.mediaType && m.mediaId)
            if (hasMediaInBatch) {
                await ensureMediaColumns(ws).catch(() => {})
            }

            for (const m of c.messages) {
                const dup = await sql.unsafe(`SELECT id FROM ${sch}.messages WHERE whatsapp_id = $1 LIMIT 1`, [m.whatsappId])
                if (dup.length) continue
                const normalized = normalizePhoneForBrazil(m.fromPhone)
                if (!normalized || isWhatsAppGroup(normalized.replace(/\D/g, ''))) continue
                const testCfgRows = await sql.unsafe(
                    `SELECT ai_test_mode, ai_test_allowlist_phones FROM ${sch}.ai_agent_config LIMIT 1`,
                    []
                )
                const testCfg = testCfgRows[0] as
                    | { ai_test_mode?: boolean | null; ai_test_allowlist_phones?: string | null }
                    | undefined
                if (!shouldAcceptInboundForTestMode(testCfg ?? {}, normalized)) {
                    continue
                }
                const variants = generateBrazilianPhoneVariants(normalized)
                const rows = await sql.unsafe(`SELECT id FROM ${sch}.contacts WHERE phone = ANY($1::text[]) LIMIT 1`, [variants])
                let contactId = (rows[0] as { id?: string } | undefined)?.id
                let isNewContact = false
                if (!contactId) {
                    // INSERT DO NOTHING — se já existe, busca; se não, cria com flag
                    const ins = await sql.unsafe(
                        `INSERT INTO ${sch}.contacts (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING RETURNING id`,
                        [normalized, m.fromName || normalized]
                    )
                    if (ins.length > 0) {
                        contactId = (ins[0] as { id?: string } | undefined)?.id
                        isNewContact = true
                    } else {
                        const existing = await sql.unsafe(
                            `SELECT id FROM ${sch}.contacts WHERE phone = $1 LIMIT 1`,
                            [normalized]
                        )
                        contactId = (existing[0] as { id?: string } | undefined)?.id
                    }
                }
                if (!contactId) continue
                const convRows = await sql.unsafe(
                    `SELECT id FROM ${sch}.ai_conversations WHERE contact_id = $1::uuid AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
                    [contactId]
                )
                const conversationId = (convRows[0] as { id?: string } | undefined)?.id || null

                // Se há media_id, salvar em media_ref para download posterior
                const hasMediaRef = m.mediaId && hasMediaInBatch
                const insMsg = hasMediaRef
                    ? await sql.unsafe(
                        `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, media_type, status, whatsapp_id, media_ref, created_at)
                         VALUES ($1::uuid, $2::uuid, 'contact', $3, $4, 'received', $5, $6, COALESCE(to_timestamp($7 / 1000.0), now()))
                         RETURNING id`,
                        [contactId, conversationId, m.body || 'Midia enviada', m.mediaType, m.whatsappId, m.mediaId, m.timestampMs]
                    )
                    : await sql.unsafe(
                        `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, media_type, status, whatsapp_id, created_at)
                         VALUES ($1::uuid, $2::uuid, 'contact', $3, $4, 'received', $5, COALESCE(to_timestamp($6 / 1000.0), now()))
                         RETURNING id`,
                        [contactId, conversationId, m.body || 'Midia enviada', m.mediaType, m.whatsappId, m.timestampMs]
                    )
                const messageId = (insMsg[0] as { id?: string } | undefined)?.id
                if (messageId) {
                    await resetFollowupAnchorForContact(ws, contactId).catch(() => {})

                    // Greeting para contatos novos (mesma lógica do webhook Uazapi)
                    let skipBuffer = false
                    if (isNewContact) {
                        try {
                            const cfgRows = await sql.unsafe(
                                `SELECT greeting_message, enabled FROM ${sch}.ai_agent_config LIMIT 1`, []
                            )
                            const cfg = cfgRows[0] as { greeting_message?: string | null; enabled?: boolean } | undefined
                            const gm = cfg?.greeting_message?.trim()
                            if (gm && cfg?.enabled !== false) {
                                const { parseMessageForWhatsApp } = await import('@/lib/ai-agent/format-for-whatsapp')
                                const { getProviderForWorkspace } = await import('@/lib/whatsapp/factory')
                                const { setFollowupAnchorForContact } = await import('@/lib/ai-agent/followup-anchor')
                                const instRow = await supabase
                                    .from('whatsapp_instances')
                                    .select('instance_token')
                                    .eq('workspace_slug', ws)
                                    .eq('status', 'connected')
                                    .maybeSingle()
                                if (instRow.data?.instance_token) {
                                    const textOut = parseMessageForWhatsApp(gm)
                                    const { provider } = await getProviderForWorkspace(supabase, ws)
                                    await provider.sendText(instRow.data.instance_token, m.fromPhone, textOut, {
                                        delayMs: 800,
                                        presence: 'composing'
                                    })
                                    await sql.unsafe(
                                        `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, status) VALUES ($1::uuid, $2::uuid, 'ai', $3, 'sent')`,
                                        [contactId, conversationId, gm]
                                    )
                                    await setFollowupAnchorForContact(ws, contactId).catch(() => {})
                                    skipBuffer = true
                                }
                            }
                        } catch (greetErr) {
                            console.error('official greeting_message', greetErr)
                        }
                    }

                    if (!skipBuffer) {
                        await addToBuffer(ws, contactId, messageId)
                    }
                }
            }
        }
        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('official webhook', e)
        return NextResponse.json({ success: true })
    }
}
