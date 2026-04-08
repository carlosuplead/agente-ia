const ELEVENLABS_API = 'https://api.elevenlabs.io'
const TTS_TIMEOUT_MS = 45_000
/** Limite de carateres por pedido (custo + estabilidade). */
export const ELEVENLABS_MAX_TEXT_CHARS = 2500

export type TextToSpeechOptions = {
    text: string
    voiceId: string
    modelId?: string | null
    apiKey?: string | null  // per-workspace key (already decrypted)
}

export async function textToSpeechMp3(opts: TextToSpeechOptions): Promise<ArrayBuffer> {
    const key = opts.apiKey?.trim() || process.env.ELEVENLABS_API_KEY?.trim()
    if (!key) {
        throw new Error('ELEVENLABS_API_KEY não configurada')
    }
    const t = opts.text.trim()
    if (!t) {
        throw new Error('Texto vazio para síntese')
    }
    if (t.length > ELEVENLABS_MAX_TEXT_CHARS) {
        throw new Error(`Texto excede ${ELEVENLABS_MAX_TEXT_CHARS} carateres`)
    }
    const modelId = (opts.modelId || process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2').trim()

    const controller = new AbortController()
    const to = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS)
    try {
        const res = await fetch(`${ELEVENLABS_API}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}`, {
            method: 'POST',
            headers: {
                'xi-api-key': key,
                'Content-Type': 'application/json',
                Accept: 'audio/mpeg'
            },
            body: JSON.stringify({
                text: t,
                model_id: modelId
            }),
            signal: controller.signal
        })
        if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText)
            throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 200)}`)
        }
        return await res.arrayBuffer()
    } finally {
        clearTimeout(to)
    }
}
