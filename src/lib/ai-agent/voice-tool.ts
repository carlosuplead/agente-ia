import { textToSpeechMp3 } from '@/lib/elevenlabs'
import type { AiAgentConfig, BuiltContext, VoiceDeliveryRecord } from '@/lib/ai-agent/types'
import { createAdminClient } from '@/lib/supabase/server'
import { getProviderForWorkspace } from '@/lib/whatsapp/factory'
import { decryptWorkspaceLlmKeyIfNeeded } from '@/lib/crypto/workspace-llm-keys'

const TOOL_NAME = 'send_voice_message'

export { TOOL_NAME as VOICE_MESSAGE_TOOL_NAME }

const DEFAULT_VOICE_TOOL_DESC = `Envia uma mensagem de áudio (voz sintetizada) ao lead no WhatsApp. Use quando o utilizador pedir áudio, voz, "manda aí falando", ou quando for claramente útil. O argumento "text" é o que será falado (português, claro e natural). Opcional: voice_id para outra voz ElevenLabs. Depois de chamar, podes enviar uma frase curta em texto se fizer sentido.`

export function voiceToolDescription(config: AiAgentConfig): string {
    const c = config.elevenlabs_voice_tool_description?.trim()
    return c || DEFAULT_VOICE_TOOL_DESC
}

function resolveElevenLabsApiKey(config: AiAgentConfig): string | null {
    const w = typeof config.elevenlabs_api_key === 'string' ? config.elevenlabs_api_key.trim() : ''
    if (w) return decryptWorkspaceLlmKeyIfNeeded(w)
    return null // fallback to ELEVENLABS_API_KEY handled inside textToSpeechMp3
}

export function resolveElevenLabsVoiceId(config: AiAgentConfig, override?: string | null): string | null {
    const o = override?.trim()
    if (o) return o
    const fromCfg = config.elevenlabs_voice_id?.trim()
    if (fromCfg) return fromCfg
    const fromEnv = process.env.ELEVENLABS_DEFAULT_VOICE_ID?.trim()
    return fromEnv || null
}

export async function executeSendVoiceMessage(args: {
    config: AiAgentConfig
    context: BuiltContext
    workspaceSlug: string
    instanceToken: string
    text: string
    voiceIdOverride?: string | null
    delayMs: number
}): Promise<{ toolResult: string; delivery?: VoiceDeliveryRecord }> {
    const voiceId = resolveElevenLabsVoiceId(args.config, args.voiceIdOverride)
    if (!voiceId) {
        return {
            toolResult:
                'Erro: nenhum voice_id configurado. Define elevenlabs_voice_id no agente ou ELEVENLABS_DEFAULT_VOICE_ID no servidor.'
        }
    }
    let audio: ArrayBuffer
    try {
        audio = await textToSpeechMp3({
            text: args.text,
            voiceId,
            modelId: args.config.elevenlabs_model_id,
            apiKey: resolveElevenLabsApiKey(args.config)
        })
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ElevenLabs'
        return { toolResult: `Erro TTS: ${msg}` }
    }

    try {
        const supabase = await createAdminClient()
        const { provider } = await getProviderForWorkspace(supabase, args.workspaceSlug)
        const sent = await provider.sendAudio(args.instanceToken, args.context.contactPhone, audio, {
            delayMs: args.delayMs
        })
        return {
            toolResult: sent.messageId
                ? `Áudio enviado com sucesso (id: ${sent.messageId}).`
                : 'Áudio enviado com sucesso.',
            delivery: {
                transcript: args.text.trim(),
                whatsappId: sent.messageId
            }
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha Uazapi'
        return { toolResult: `Erro ao enviar áudio: ${msg}` }
    }
}
