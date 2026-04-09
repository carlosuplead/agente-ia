/**
 * Processamento de mídia recebida via WhatsApp.
 *
 * Áudio  → transcrição via OpenAI Whisper (fallback Gemini nativo).
 * Imagem → análise visual via GPT-4o-mini / Gemini / Claude.
 *
 * O processamento ocorre em `runAiProcess`, antes de montar o contexto,
 * para que o transcript contenha o conteúdo real da mídia (não "Áudio enviado").
 */

import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { getUazapiBaseUrl } from '@/lib/uazapi'
import { GRAPH_API_BASE } from '@/lib/meta/graph-version'
import { decryptWorkspaceLlmKeyIfNeeded } from '@/lib/crypto/workspace-llm-keys'
import type { AiAgentConfig } from './types'

// ─── Constantes ──────────────────────────────────────────────────

const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const DOWNLOAD_TIMEOUT_MS = 30_000
const PROCESSING_TIMEOUT_MS = 45_000
/** Máximo de mídias processadas por turno (evita ultrapassar TTL do lock). */
const MAX_MEDIA_PER_RUN = 3

// ─── Lazy column migration ──────────────────────────────────────

const migratedSchemas = new Set<string>()

export async function ensureMediaColumns(workspaceSlug: string): Promise<void> {
    const sch = quotedSchema(workspaceSlug)
    if (migratedSchemas.has(sch)) return
    const sql = getTenantSql()
    try {
        await sql.unsafe(
            `ALTER TABLE ${sch}.messages ADD COLUMN IF NOT EXISTS media_ref TEXT DEFAULT NULL`
        )
        await sql.unsafe(
            `ALTER TABLE ${sch}.messages ADD COLUMN IF NOT EXISTS media_processed BOOLEAN DEFAULT NULL`
        )
        migratedSchemas.add(sch)
    } catch (e) {
        // Se o tenant schema ainda não tem a tabela ou outra razão — ignora e
        // tenta na próxima vez (o Set não fica marcado).
        console.error('ensureMediaColumns:', e)
    }
}

// ─── Resolução de API keys ──────────────────────────────────────

function resolveOpenAiKey(config: AiAgentConfig): string {
    const w = typeof config.openai_api_key === 'string' ? config.openai_api_key.trim() : ''
    if (w) return decryptWorkspaceLlmKeyIfNeeded(w)
    return process.env.OPENAI_API_KEY?.trim() || ''
}

function resolveGoogleKey(config: AiAgentConfig): string {
    const w = typeof config.google_api_key === 'string' ? config.google_api_key.trim() : ''
    if (w) return decryptWorkspaceLlmKeyIfNeeded(w)
    return process.env.GOOGLE_API_KEY?.trim() || ''
}

function resolveAnthropicKey(config: AiAgentConfig): string {
    const w = typeof config.anthropic_api_key === 'string' ? config.anthropic_api_key.trim() : ''
    if (w) return decryptWorkspaceLlmKeyIfNeeded(w)
    return process.env.ANTHROPIC_API_KEY?.trim() || ''
}

// ─── Download — Uazapi ──────────────────────────────────────────

export async function downloadMediaUazapi(
    instanceToken: string,
    whatsappId: string
): Promise<{ buffer: Buffer; mimetype: string } | null> {
    const base = getUazapiBaseUrl()
    try {
        const res = await fetch(`${base}/message/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                token: instanceToken.trim()
            },
            body: JSON.stringify({ id: whatsappId, return_base64: true }),
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
        })
        if (!res.ok) {
            console.error(`downloadMediaUazapi: HTTP ${res.status}`)
            return null
        }
        const data = (await res.json()) as Record<string, unknown>
        // Uazapi pode retornar { base64, mimetype } ou { data, mime } etc.
        const b64 =
            (typeof data.base64 === 'string' ? data.base64 : '') ||
            (typeof data.data === 'string' ? data.data : '') ||
            (typeof data.file === 'string' ? data.file : '')
        const mime =
            (typeof data.mimetype === 'string' ? data.mimetype : '') ||
            (typeof data.mimeType === 'string' ? data.mimeType : '') ||
            (typeof data.mime === 'string' ? data.mime : '') ||
            (typeof data.mime_type === 'string' ? data.mime_type : '') ||
            'application/octet-stream'
        if (!b64) {
            console.error('downloadMediaUazapi: no base64 field in response')
            return null
        }
        const buffer = Buffer.from(b64, 'base64')
        if (buffer.length > MAX_MEDIA_SIZE_BYTES) {
            console.warn('downloadMediaUazapi: file too large', buffer.length)
            return null
        }
        return { buffer, mimetype: mime.split(';')[0].trim() }
    } catch (e) {
        console.error('downloadMediaUazapi:', e)
        return null
    }
}

// ─── Download — Meta Cloud API (Official) ───────────────────────

export async function downloadMediaOfficial(
    accessToken: string,
    mediaId: string
): Promise<{ buffer: Buffer; mimetype: string } | null> {
    try {
        // 1) Obter URL do ficheiro
        const metaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(15_000)
        })
        if (!metaRes.ok) {
            console.error(`downloadMediaOfficial meta: HTTP ${metaRes.status}`)
            return null
        }
        const metaData = (await metaRes.json()) as { url?: string; mime_type?: string }
        if (!metaData.url) {
            console.error('downloadMediaOfficial: no url in response')
            return null
        }
        const mime = metaData.mime_type || 'application/octet-stream'

        // 2) Baixar o ficheiro
        const fileRes = await fetch(metaData.url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
        })
        if (!fileRes.ok) {
            console.error(`downloadMediaOfficial download: HTTP ${fileRes.status}`)
            return null
        }
        const arrayBuf = await fileRes.arrayBuffer()
        const buffer = Buffer.from(arrayBuf)
        if (buffer.length > MAX_MEDIA_SIZE_BYTES) {
            console.warn('downloadMediaOfficial: file too large', buffer.length)
            return null
        }
        return { buffer, mimetype: mime.split(';')[0].trim() }
    } catch (e) {
        console.error('downloadMediaOfficial:', e)
        return null
    }
}

// ─── Transcrição de áudio ───────────────────────────────────────

export async function transcribeAudio(
    audioBuffer: Buffer,
    mimetype: string,
    config: AiAgentConfig
): Promise<string | null> {
    // 1. Whisper (melhor qualidade, disponível se houver chave OpenAI)
    const openaiKey = resolveOpenAiKey(config)
    if (openaiKey) {
        try {
            return await transcribeWithWhisper(audioBuffer, mimetype, openaiKey)
        } catch (e) {
            console.error('transcribeAudio whisper:', e)
        }
    }

    // 2. Gemini native audio (fallback)
    const geminiKey = resolveGoogleKey(config)
    if (geminiKey) {
        try {
            return await transcribeWithGemini(audioBuffer, mimetype, geminiKey)
        } catch (e) {
            console.error('transcribeAudio gemini:', e)
        }
    }

    console.warn('transcribeAudio: nenhuma API key disponível para transcrição')
    return null
}

async function transcribeWithWhisper(
    audioBuffer: Buffer,
    mimetype: string,
    apiKey: string
): Promise<string> {
    const ext = mimetype.includes('ogg')
        ? 'ogg'
        : mimetype.includes('mp3') || mimetype.includes('mpeg')
            ? 'mp3'
            : mimetype.includes('mp4') || mimetype.includes('m4a')
                ? 'mp4'
                : mimetype.includes('wav')
                    ? 'wav'
                    : mimetype.includes('webm')
                        ? 'webm'
                        : 'ogg'

    // Usa `toFile` da SDK para garantir compatibilidade em todos os runtimes
    const OpenAI = (await import('openai')).default
    const { toFile } = await import('openai')
    const openai = new OpenAI({ apiKey })
    const file = await toFile(audioBuffer, `audio.${ext}`, { type: mimetype })

    const transcription = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'pt'
    })

    return transcription.text?.trim() || ''
}

async function transcribeWithGemini(
    audioBuffer: Buffer,
    mimetype: string,
    apiKey: string
): Promise<string> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const base64 = audioBuffer.toString('base64')
    const result = await model.generateContent([
        {
            text: 'Transcreva fielmente o áudio a seguir em português brasileiro. Retorne APENAS a transcrição do que foi dito, sem comentários, aspas ou formatação.'
        },
        { inlineData: { mimeType: mimetype, data: base64 } }
    ])

    return result.response.text()?.trim() || ''
}

// ─── Análise de imagem (vision) ─────────────────────────────────

export async function analyzeImage(
    imageBuffer: Buffer,
    mimetype: string,
    config: AiAgentConfig
): Promise<string | null> {
    const base64 = imageBuffer.toString('base64')
    const prompt =
        'Descreva detalhadamente todos os elementos visuais desta imagem. Se houver texto na imagem, transcreva-o. Seja objetivo e direto.'

    // Tenta o provider primário do workspace primeiro
    const provider = config.provider

    const tryOpenAI = async (): Promise<string | null> => {
        const key = resolveOpenAiKey(config)
        if (!key) return null
        try {
            return await analyzeImageOpenAI(base64, mimetype, key, prompt)
        } catch (e) {
            console.error('analyzeImage openai:', e)
            return null
        }
    }

    const tryGemini = async (): Promise<string | null> => {
        const key = resolveGoogleKey(config)
        if (!key) return null
        try {
            return await analyzeImageGemini(base64, mimetype, key, prompt)
        } catch (e) {
            console.error('analyzeImage gemini:', e)
            return null
        }
    }

    const tryAnthropic = async (): Promise<string | null> => {
        const key = resolveAnthropicKey(config)
        if (!key) return null
        try {
            return await analyzeImageAnthropic(base64, mimetype, key, prompt)
        } catch (e) {
            console.error('analyzeImage anthropic:', e)
            return null
        }
    }

    // Ordem: provider primário → fallbacks
    const order: Array<() => Promise<string | null>> =
        provider === 'openai'
            ? [tryOpenAI, tryGemini, tryAnthropic]
            : provider === 'anthropic'
                ? [tryAnthropic, tryOpenAI, tryGemini]
                : [tryGemini, tryOpenAI, tryAnthropic] // gemini default

    for (const fn of order) {
        const result = await fn()
        if (result) return result
    }

    console.warn('analyzeImage: nenhuma API key disponível para análise visual')
    return null
}

async function analyzeImageOpenAI(
    base64: string,
    mimetype: string,
    apiKey: string,
    prompt: string
): Promise<string> {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey })
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimetype};base64,${base64}`,
                            detail: 'auto'
                        }
                    }
                ]
            }
        ],
        max_tokens: 500
    })
    return completion.choices[0]?.message?.content?.trim() || ''
}

async function analyzeImageGemini(
    base64: string,
    mimetype: string,
    apiKey: string,
    prompt: string
): Promise<string> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType: mimetype, data: base64 } }
    ])
    return result.response.text()?.trim() || ''
}

async function analyzeImageAnthropic(
    base64: string,
    mimetype: string,
    apiKey: string,
    prompt: string
): Promise<string> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const anthropic = new Anthropic({ apiKey })
    // Anthropic aceita: image/jpeg, image/png, image/gif, image/webp
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
    type AnthropicMediaType = (typeof allowed)[number]
    let mediaType: AnthropicMediaType = 'image/jpeg'
    if (allowed.includes(mimetype as AnthropicMediaType)) {
        mediaType = mimetype as AnthropicMediaType
    }
    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    {
                        type: 'image',
                        source: { type: 'base64', media_type: mediaType, data: base64 }
                    }
                ]
            }
        ]
    })
    return response.content
        .filter(b => b.type === 'text')
        .map(b => ('text' in b ? (b as { text: string }).text : ''))
        .join('')
        .trim()
}

// ─── Função principal — processa mídias pendentes ───────────────

export type MediaProviderInfo = {
    providerType: 'uazapi' | 'official'
    instanceToken: string
    /** Token de acesso Meta (só para official). */
    accessToken?: string
}

/**
 * Busca mensagens de mídia (áudio/imagem) do contacto que ainda não foram
 * processadas, baixa o ficheiro, transcreve/analisa e atualiza o body na BD.
 *
 * Chamada por `runAiProcess` antes de `buildContext`.
 */
export async function processUnprocessedMedia(
    workspaceSlug: string,
    contactId: string,
    config: AiAgentConfig,
    providerInfo: MediaProviderInfo
): Promise<void> {
    const sql = getTenantSql()
    const sch = quotedSchema(workspaceSlug)

    // Garante que as colunas existem (idempotente)
    await ensureMediaColumns(workspaceSlug)

    // Mensagens recentes com mídia por processar
    const mediaMessages = (await sql.unsafe(
        `SELECT id, whatsapp_id, media_type, body, media_ref
         FROM ${sch}.messages
         WHERE contact_id = $1::uuid
           AND sender_type = 'contact'
           AND media_type IN ('audio', 'image')
           AND (media_processed IS NULL OR media_processed = false)
         ORDER BY created_at DESC
         LIMIT ${MAX_MEDIA_PER_RUN}`,
        [contactId]
    )) as unknown as Array<{
        id: string
        whatsapp_id: string | null
        media_type: string
        body: string | null
        media_ref: string | null
    }>

    if (!mediaMessages.length) return

    const startMs = Date.now()

    // Processa em paralelo (máx MAX_MEDIA_PER_RUN itens)
    await Promise.allSettled(
        mediaMessages.map(async msg => {
            // Guarda contra timeout global
            if (Date.now() - startMs > PROCESSING_TIMEOUT_MS) return

            try {
                // ── Download ──
                let mediaData: { buffer: Buffer; mimetype: string } | null = null

                if (
                    providerInfo.providerType === 'uazapi' &&
                    msg.whatsapp_id
                ) {
                    mediaData = await downloadMediaUazapi(
                        providerInfo.instanceToken,
                        msg.whatsapp_id
                    )
                } else if (
                    providerInfo.providerType === 'official' &&
                    msg.media_ref &&
                    providerInfo.accessToken
                ) {
                    mediaData = await downloadMediaOfficial(
                        providerInfo.accessToken,
                        msg.media_ref
                    )
                }

                if (!mediaData) {
                    await markProcessed(sql, sch, msg.id)
                    return
                }

                // ── Transcrição / análise ──
                let processedBody: string | null = null

                if (msg.media_type === 'audio') {
                    const transcription = await transcribeAudio(
                        mediaData.buffer,
                        mediaData.mimetype,
                        config
                    )
                    if (transcription) {
                        processedBody = transcription
                    }
                } else if (msg.media_type === 'image') {
                    const description = await analyzeImage(
                        mediaData.buffer,
                        mediaData.mimetype,
                        config
                    )
                    if (description) {
                        const originalBody = msg.body?.trim() || ''
                        const placeholders = [
                            'Imagem enviada',
                            'Midia enviada',
                            'Mídia enviada',
                            ''
                        ]
                        if (placeholders.includes(originalBody)) {
                            processedBody = description
                        } else {
                            // Manter caption original + descrição visual
                            processedBody = `${originalBody}\n[Análise visual]: ${description}`
                        }
                    }
                }

                if (processedBody) {
                    await sql.unsafe(
                        `UPDATE ${sch}.messages SET body = $2, media_processed = true WHERE id = $1::uuid`,
                        [msg.id, processedBody]
                    )
                } else {
                    await markProcessed(sql, sch, msg.id)
                }
            } catch (e) {
                console.error(`processUnprocessedMedia msg=${msg.id}:`, e)
                await markProcessed(sql, sch, msg.id)
            }
        })
    )
}

async function markProcessed(
    sql: ReturnType<typeof getTenantSql>,
    sch: string,
    msgId: string
): Promise<void> {
    try {
        await sql.unsafe(
            `UPDATE ${sch}.messages SET media_processed = true WHERE id = $1::uuid`,
            [msgId]
        )
    } catch {
        // best effort
    }
}
