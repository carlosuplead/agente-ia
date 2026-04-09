/**
 * Webhook handler para Uazapi (uazapiGO v2).
 *
 * O Uazapi envia eventos via POST para este endpoint.
 * A instância é identificada pelo query param `token` (instance_token).
 *
 * Configuração no painel Uazapi:
 *   Webhook URL: https://<domain>/api/whatsapp/webhook?token=INSTANCE_TOKEN
 *
 * Payloads conhecidos do uazapiGO v2:
 *   { event: "message", ...message fields }
 *   { EventType: "Message", ...message fields }
 *   { event: "status", ... }
 *   { event: "connection", ... }
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { normalizePhoneForBrazil, generateBrazilianPhoneVariants, isWhatsAppGroup } from '@/lib/phone'
import { addToBuffer } from '@/lib/ai-agent/buffer'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { resetFollowupAnchorForContact } from '@/lib/ai-agent/followup-anchor'
import { shouldAcceptInboundForTestMode } from '@/lib/ai-agent/test-mode-allowlist'
import { ensureMediaColumns } from '@/lib/ai-agent/media-processing'

// ─── Payload parsing ──────────────────────────────────────────────

type ParsedUazapiMessage = {
    whatsappId: string
    fromPhone: string
    fromName: string | null
    body: string
    mediaType: string | null
    timestampMs: number | null
    fromMe: boolean
}

type ParsedUazapiStatus = {
    whatsappId: string
    status: 'sent' | 'delivered' | 'read' | 'failed'
}

/**
 * Extrai o tipo do evento.
 * uazapiGO v2 usa `event` (lowercase) ou `EventType` (PascalCase).
 */
function getEventType(data: Record<string, unknown>): string {
    const ev =
        typeof data.event === 'string'
            ? data.event
            : typeof data.EventType === 'string'
              ? data.EventType
              : ''
    return ev.trim().toLowerCase()
}

/**
 * Extrai JID (telefone) do campo remoteJid ou key.remoteJid.
 * Ex: "5511999999999@s.whatsapp.net" → "5511999999999"
 * Ignora LIDs (Linked IDs) que terminam em @lid — não são telefones.
 */
function jidToPhone(jid: string | undefined | null): string {
    if (!jid) return ''
    // LIDs (ex: "93020586258459@lid") não são telefones reais — ignorar
    if (jid.includes('@lid')) return ''
    return jid.split('@')[0]?.replace(/\D/g, '') || ''
}

/**
 * Tenta extrair corpo do texto da mensagem.
 * Lida com vários formatos de payload do Uazapi:
 *   - message.message.conversation (texto simples)
 *   - message.message.extendedTextMessage.text
 *   - message.body / message.text
 *   - body / text (top-level)
 *   - buttonReply / listReply
 */
function extractMessageBody(data: Record<string, unknown>): { body: string; mediaType: string | null } {
    // Nested message object (padrão Baileys/uazapiGO)
    const msgOuter = data.message as Record<string, unknown> | undefined
    const msgInner = msgOuter?.message as Record<string, unknown> | undefined

    // Texto simples
    if (msgInner) {
        if (typeof msgInner.conversation === 'string' && msgInner.conversation) {
            return { body: msgInner.conversation, mediaType: null }
        }
        // Extended text (respostas citadas, links)
        const ext = msgInner.extendedTextMessage as Record<string, unknown> | undefined
        if (ext && typeof ext.text === 'string') {
            return { body: ext.text, mediaType: null }
        }
        // Imagem com caption
        const img = msgInner.imageMessage as Record<string, unknown> | undefined
        if (img) {
            const caption = typeof img.caption === 'string' ? img.caption : ''
            return { body: caption || 'Imagem enviada', mediaType: 'image' }
        }
        // Vídeo com caption
        const vid = msgInner.videoMessage as Record<string, unknown> | undefined
        if (vid) {
            const caption = typeof vid.caption === 'string' ? vid.caption : ''
            return { body: caption || 'Vídeo enviado', mediaType: 'video' }
        }
        // Documento
        const doc = msgInner.documentMessage as Record<string, unknown> | undefined
        if (doc) {
            const fileName = typeof doc.fileName === 'string' ? doc.fileName : ''
            return { body: fileName || 'Documento enviado', mediaType: 'document' }
        }
        // Áudio / PTT
        const audio = msgInner.audioMessage as Record<string, unknown> | undefined
        if (audio) {
            return { body: 'Áudio enviado', mediaType: 'audio' }
        }
        // Sticker
        if (msgInner.stickerMessage) {
            return { body: 'Sticker enviado', mediaType: 'sticker' }
        }
        // Contato
        if (msgInner.contactMessage || msgInner.contactsArrayMessage) {
            return { body: 'Contato enviado', mediaType: 'contact' }
        }
        // Localização
        if (msgInner.locationMessage || msgInner.liveLocationMessage) {
            return { body: 'Localização enviada', mediaType: 'location' }
        }
    }

    // Button reply (botões interativos)
    const buttonReply = data.buttonReply as Record<string, unknown> | undefined
    if (buttonReply && typeof buttonReply.selectedButtonId === 'string') {
        return {
            body: (typeof buttonReply.selectedDisplayText === 'string' ? buttonReply.selectedDisplayText : buttonReply.selectedButtonId) as string,
            mediaType: null
        }
    }
    // buttonOrListid shorthand
    if (typeof data.buttonOrListid === 'string' && data.buttonOrListid) {
        return { body: data.buttonOrListid, mediaType: null }
    }

    // List reply (listas interativas)
    const listReply = data.listReply as Record<string, unknown> | undefined
    if (listReply && typeof listReply.title === 'string') {
        return { body: listReply.title, mediaType: null }
    }

    // Campos diretos no objeto raiz
    if (typeof data.body === 'string' && data.body) {
        return { body: data.body, mediaType: null }
    }
    if (typeof data.text === 'string' && data.text) {
        return { body: data.text, mediaType: null }
    }

    // Campos diretos no msgOuter
    if (msgOuter) {
        if (typeof msgOuter.body === 'string' && msgOuter.body) {
            return { body: msgOuter.body, mediaType: null }
        }
        if (typeof msgOuter.text === 'string' && msgOuter.text) {
            return { body: msgOuter.text, mediaType: null }
        }
        // caption fallback
        if (typeof msgOuter.caption === 'string' && msgOuter.caption) {
            return { body: msgOuter.caption, mediaType: 'image' }
        }
    }

    return { body: 'Mídia enviada', mediaType: 'media' }
}

/**
 * Extrai ID da mensagem do WhatsApp para deduplicação.
 * Suporta formato Baileys (message.key.id) e formato flat do uazapiGO (message.messageid).
 */
function extractWhatsAppId(data: Record<string, unknown>): string {
    // message.key.id (padrão Baileys)
    const msgOuter = data.message as Record<string, unknown> | undefined
    const key = (msgOuter?.key ?? data.key) as Record<string, unknown> | undefined
    if (key && typeof key.id === 'string') return key.id

    // Formato flat uazapiGO: message.messageid, message.id
    if (msgOuter) {
        for (const k of ['messageId', 'messageid', 'id', 'msgId']) {
            if (typeof msgOuter[k] === 'string' && (msgOuter[k] as string).trim()) {
                return (msgOuter[k] as string).trim()
            }
        }
    }

    // Fallback: campos no top-level
    for (const k of ['messageId', 'messageid', 'id', 'whatsapp_id', 'msgId']) {
        if (typeof data[k] === 'string' && (data[k] as string).trim()) {
            return (data[k] as string).trim()
        }
    }

    return ''
}

/**
 * Extrai o telefone do remetente.
 * Suporta formato Baileys (message.key.remoteJid) e formato flat do uazapiGO (message.sender, message.chatid).
 *
 * Prioridade:
 *   1. sender_pn (telefone real explícito)
 *   2. chatid (sempre @s.whatsapp.net, nunca @lid)
 *   3. key.remoteJid
 *   4. sender (pode ser @lid — rejeitado por jidToPhone)
 *   5. campos top-level
 */
function extractFromPhone(data: Record<string, unknown>): string {
    const msgOuter = data.message as Record<string, unknown> | undefined

    // 1. sender_pn — telefone real explícito do uazapiGO (sempre confiável)
    for (const obj of [msgOuter, data]) {
        if (!obj) continue
        const pn = obj.sender_pn
        if (typeof pn === 'string' && pn) {
            const digits = jidToPhone(pn)
            if (digits.length >= 8) return digits
        }
    }

    // 2. chatid — sempre @s.whatsapp.net, nunca @lid
    for (const obj of [msgOuter, data]) {
        if (!obj) continue
        for (const k of ['chatid', 'chatId']) {
            const v = obj[k]
            if (typeof v === 'string' && v) {
                const digits = jidToPhone(v)
                if (digits.length >= 8) return digits
            }
        }
    }

    // 3. message.key.remoteJid (padrão Baileys)
    const key = (msgOuter?.key ?? data.key) as Record<string, unknown> | undefined
    if (key) {
        const jid = jidToPhone(key.remoteJid as string | undefined)
        if (jid) return jid
    }

    // 4. sender e outros campos (sender pode ser @lid — rejeitado por jidToPhone)
    if (msgOuter) {
        for (const k of ['sender', 'phone', 'from', 'number', 'remoteJid']) {
            const v = msgOuter[k]
            if (typeof v === 'string' && v) {
                const digits = jidToPhone(v)
                if (digits.length >= 8) return digits
            }
        }
    }

    // 5. Campos diretos no top-level
    for (const k of ['phone', 'from', 'sender', 'number', 'remoteJid']) {
        const v = data[k]
        if (typeof v === 'string' && v) {
            const digits = jidToPhone(v)
            if (digits.length >= 8) return digits
        }
    }

    // 6. chat object (wa_chatid no formato uazapiGO)
    const chat = data.chat as Record<string, unknown> | undefined
    if (chat) {
        const jid = jidToPhone((chat.wa_chatid ?? chat.id ?? chat.jid ?? chat.remoteJid) as string | undefined)
        if (jid) return jid
    }

    return ''
}

/**
 * Verifica se a mensagem foi enviada pela API (por nós), para ignorar eco.
 * Suporta Baileys (key.fromMe) e uazapiGO flat (message.fromMe, message.wasSentByApi).
 */
function isSentByUs(data: Record<string, unknown>): boolean {
    // wasSentByApi flag (top-level)
    if (data.wasSentByApi === true) return true
    if (typeof data.wasSentByApi === 'string' && data.wasSentByApi.toLowerCase() === 'true') return true

    // fromMe flag no key (Baileys)
    const msgOuter = data.message as Record<string, unknown> | undefined
    const key = (msgOuter?.key ?? data.key) as Record<string, unknown> | undefined
    if (key?.fromMe === true) return true

    // fromMe / wasSentByApi dentro de message (uazapiGO flat)
    if (msgOuter?.fromMe === true) return true
    if (msgOuter?.wasSentByApi === true) return true
    if (typeof msgOuter?.wasSentByApi === 'string' && (msgOuter.wasSentByApi as string).toLowerCase() === 'true') return true

    return false
}

/**
 * Extrai nome do remetente.
 */
function extractPushName(data: Record<string, unknown>): string | null {
    const msgOuter = data.message as Record<string, unknown> | undefined
    for (const obj of [data, msgOuter]) {
        if (!obj) continue
        for (const k of ['pushName', 'pushname', 'senderName', 'name', 'contactName']) {
            if (typeof obj[k] === 'string' && (obj[k] as string).trim()) {
                return (obj[k] as string).trim()
            }
        }
    }
    return null
}

/**
 * Extrai timestamp em ms.
 */
function extractTimestamp(data: Record<string, unknown>): number | null {
    const msgOuter = data.message as Record<string, unknown> | undefined
    for (const obj of [data, msgOuter]) {
        if (!obj) continue
        for (const k of ['messageTimestamp', 'timestamp', 'time']) {
            const v = obj[k]
            if (typeof v === 'number' && v > 0) {
                // Se é em segundos (10 dígitos), converte para ms
                return v < 1e12 ? v * 1000 : v
            }
            if (typeof v === 'string') {
                const n = Number(v)
                if (Number.isFinite(n) && n > 0) {
                    return n < 1e12 ? n * 1000 : n
                }
            }
        }
    }
    return null
}

/**
 * Parse completo do payload Uazapi → mensagem estruturada.
 */
function parseUazapiMessage(data: Record<string, unknown>): ParsedUazapiMessage | null {
    const whatsappId = extractWhatsAppId(data)
    if (!whatsappId) return null

    const fromPhone = extractFromPhone(data)
    if (!fromPhone) return null

    const fromMe = isSentByUs(data)
    const { body, mediaType } = extractMessageBody(data)

    return {
        whatsappId,
        fromPhone,
        fromName: extractPushName(data),
        body,
        mediaType,
        timestampMs: extractTimestamp(data),
        fromMe
    }
}

/**
 * Parse de evento de status (delivery, read, etc.)
 */
function parseUazapiStatusEvent(data: Record<string, unknown>): ParsedUazapiStatus | null {
    const whatsappId = extractWhatsAppId(data)
    if (!whatsappId) return null

    const statusRaw = (data.status ?? data.ack) as string | number | undefined
    if (statusRaw == null) return null

    let status: ParsedUazapiStatus['status'] = 'sent'
    if (typeof statusRaw === 'string') {
        const s = statusRaw.toLowerCase()
        if (s === 'delivered' || s === 'delivery') status = 'delivered'
        else if (s === 'read' || s === 'viewed') status = 'read'
        else if (s === 'failed' || s === 'error') status = 'failed'
        else status = 'sent'
    } else if (typeof statusRaw === 'number') {
        // Baileys ack: 0=error, 1=pending, 2=server, 3=delivery, 4=read, 5=played
        if (statusRaw >= 4) status = 'read'
        else if (statusRaw >= 3) status = 'delivered'
        else if (statusRaw >= 1) status = 'sent'
        else status = 'failed'
    }

    return { whatsappId, status }
}

// ─── Route handler ────────────────────────────────────────────────

export async function POST(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        let instanceToken = searchParams.get('token')?.trim() || ''

        let data: Record<string, unknown>
        try {
            data = (await request.json()) as Record<string, unknown>
        } catch {
            return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
        }

        // Fallback: token no body do payload (uazapiGO envia body.token)
        if (!instanceToken && typeof data.token === 'string' && data.token.trim()) {
            instanceToken = data.token.trim()
        }

        if (!instanceToken) {
            console.warn('[uazapi-webhook] POST sem token (nem query, nem body)')
            return NextResponse.json({ error: 'Missing token param' }, { status: 400 })
        }

        const eventType = getEventType(data)

        // Eventos de conexão/status de instância — ignorar silenciosamente
        if (['connection', 'open', 'close', 'connecting', 'qrcode', 'ready'].includes(eventType)) {
            return NextResponse.json({ success: true })
        }

        // Lookup: qual workspace pertence este instance_token?
        const supabase = await createAdminClient()
        const { data: instance } = await supabase
            .from('whatsapp_instances')
            .select('workspace_slug, status, provider')
            .eq('instance_token', instanceToken)
            .eq('provider', 'uazapi')
            .maybeSingle()

        if (!instance?.workspace_slug) {
            console.warn('[uazapi-webhook] instance_token não encontrado na BD')
            return NextResponse.json({ success: true })
        }

        const ws = instance.workspace_slug
        const sql = getTenantSql()
        const sch = quotedSchema(ws)

        // ── Status updates (ack/delivery/read) ──
        if (eventType === 'status' || eventType === 'ack' || eventType === 'message_ack') {
            const st = parseUazapiStatusEvent(data)
            if (st) {
                await sql.unsafe(
                    `UPDATE ${sch}.messages SET status = $2 WHERE whatsapp_id = $1`,
                    [st.whatsappId, st.status]
                )
            }
            return NextResponse.json({ success: true })
        }

        // ── Mensagens ──
        // Aceitar "message", "messages", "chat", ou evento vazio/desconhecido com dados de mensagem
        const isMessageEvent =
            ['message', 'messages', 'chat', 'messages.upsert'].includes(eventType) ||
            eventType === '' // payload sem campo event — tenta parsear como mensagem

        if (!isMessageEvent) {
            // Evento desconhecido — aceitar silenciosamente
            return NextResponse.json({ success: true })
        }

        const msg = parseUazapiMessage(data)
        if (!msg) {
            // Payload sem dados de mensagem extraíveis — OK
            return NextResponse.json({ success: true })
        }

        // Ignorar mensagens enviadas por nós (eco)
        if (msg.fromMe) {
            return NextResponse.json({ success: true })
        }

        // Deduplicação
        const dup = await sql.unsafe(
            `SELECT id FROM ${sch}.messages WHERE whatsapp_id = $1 LIMIT 1`,
            [msg.whatsappId]
        )
        if (dup.length) {
            return NextResponse.json({ success: true })
        }

        // Normalizar telefone e filtrar grupos
        const normalized = normalizePhoneForBrazil(msg.fromPhone)
        if (!normalized || isWhatsAppGroup(msg.fromPhone)) {
            return NextResponse.json({ success: true })
        }

        // Verificar test mode
        const testCfgRows = await sql.unsafe(
            `SELECT ai_test_mode, ai_test_allowlist_phones FROM ${sch}.ai_agent_config LIMIT 1`,
            []
        )
        const testCfg = testCfgRows[0] as
            | { ai_test_mode?: boolean | null; ai_test_allowlist_phones?: string | null }
            | undefined
        if (!shouldAcceptInboundForTestMode(testCfg ?? {}, normalized)) {
            return NextResponse.json({ success: true })
        }

        // Buscar ou criar contato
        const variants = generateBrazilianPhoneVariants(normalized)
        const phonePlaceholders = variants.map((_, i) => `$${i + 1}`).join(', ')
        const rows = await sql.unsafe(
            `SELECT id FROM ${sch}.contacts WHERE phone IN (${phonePlaceholders}) LIMIT 1`,
            variants
        )
        let contactId = (rows[0] as { id?: string } | undefined)?.id
        let isNewContact = false

        if (!contactId) {
            const ins = await sql.unsafe(
                `INSERT INTO ${sch}.contacts (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING RETURNING id`,
                [normalized, msg.fromName || normalized]
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

        if (!contactId) {
            console.error('[uazapi-webhook] Não conseguiu criar/encontrar contato:', normalized)
            return NextResponse.json({ success: true })
        }

        // Garantir colunas media_ref/media_processed se houver mídia
        if (msg.mediaType && ['audio', 'image', 'video', 'document'].includes(msg.mediaType)) {
            await ensureMediaColumns(ws).catch(() => {})
        }

        // Buscar conversa ativa
        const convRows = await sql.unsafe(
            `SELECT id FROM ${sch}.ai_conversations WHERE contact_id = $1::uuid AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
            [contactId]
        )
        const conversationId = (convRows[0] as { id?: string } | undefined)?.id || null

        // Inserir mensagem
        const insMsg = await sql.unsafe(
            `INSERT INTO ${sch}.messages (contact_id, conversation_id, sender_type, body, media_type, status, whatsapp_id, created_at)
             VALUES ($1::uuid, $2::uuid, 'contact', $3, $4, 'received', $5, COALESCE(to_timestamp($6 / 1000.0), now()))
             RETURNING id`,
            [contactId, conversationId, msg.body || 'Mídia enviada', msg.mediaType, msg.whatsappId, msg.timestampMs]
        )

        const messageId = (insMsg[0] as { id?: string } | undefined)?.id
        if (!messageId) {
            return NextResponse.json({ success: true })
        }

        // Reset follow-up anchor (cliente respondeu)
        await resetFollowupAnchorForContact(ws, contactId).catch(() => {})

        // Greeting para contatos novos
        let skipBuffer = false
        if (isNewContact) {
            try {
                const cfgRows = await sql.unsafe(
                    `SELECT greeting_message, enabled FROM ${sch}.ai_agent_config LIMIT 1`,
                    []
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
                        await provider.sendText(instRow.data.instance_token, msg.fromPhone, textOut, {
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
                console.error('[uazapi-webhook] greeting_message error:', greetErr)
            }
        }

        // Agendar processamento IA
        if (!skipBuffer) {
            await addToBuffer(ws, contactId, messageId)
        }

        return NextResponse.json({ success: true })
    } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        const errStack = e instanceof Error ? e.stack : ''
        console.error('[uazapi-webhook] CRITICAL error:', errMsg)
        console.error('[uazapi-webhook] stack:', errStack)
        // Retorna 200 para o Uazapi não reenviar infinitamente
        return NextResponse.json({ success: true, _debug_error: errMsg })
    }
}

/**
 * GET — verificação simples de saúde (o Uazapi não faz challenge como o Meta,
 * mas pode ser útil para verificar se o endpoint está vivo).
 */
export async function GET() {
    return NextResponse.json({ status: 'ok', handler: 'uazapi' })
}
