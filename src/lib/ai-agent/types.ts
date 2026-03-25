export type AiAgentConfig = {
    id: string
    enabled: boolean
    provider: 'gemini' | 'openai'
    model: string
    temperature: number
    system_prompt: string
    max_messages_per_conversation: number
    /** Quantas mensagens recentes entram no prompt (1–100). */
    context_max_messages?: number
    /** Ferramenta transfer_to_human + palavras-chave. */
    human_handoff_enabled?: boolean
    /** Substitui o texto padrão da ferramenta de transferência (opcional). */
    transfer_tool_description?: string | null
    /** Resposta quando há handoff sem texto do modelo ou por palavra-chave. */
    handoff_default_reply?: string | null
    /** Instruções extra de formatação para WhatsApp (anexadas ao system). */
    whatsapp_formatting_extra?: string | null
    send_delay_ms?: number
    /** composing | recording | paused | none */
    send_presence?: string | null
    /** Palavras ou frases separadas por vírgula ou nova linha; disparam handoff imediato. */
    handoff_keywords?: string | null
    /** Rótulo no transcript para mensagens da equipe (sender_type user). */
    label_team?: string
    /** Rótulo no transcript para respostas da IA. */
    label_assistant?: string
    /** Atraso antes de processar o buffer (segundos), como no CR Pro. */
    buffer_delay_seconds?: number
    /** Primeira mensagem automática ao novo contacto (webhook). */
    greeting_message?: string | null
    n8n_webhook_url?: string | null
    n8n_webhook_enabled?: boolean
    n8n_webhook_timeout_seconds?: number
    n8n_tool_description?: string | null
    /** Lista de ferramentas N8N (JSON no Postgres). */
    n8n_tools?: unknown
    /** Expira conversa IA após esta horas sem mensagens (nova sessão). */
    inactivity_timeout_hours?: number
    /** Tool `send_voice_message` (ElevenLabs + WhatsApp). Requer ELEVENLABS_API_KEY no servidor. */
    elevenlabs_voice_enabled?: boolean
    /** ID da voz ElevenLabs (ex. do dashboard). Fallback: ELEVENLABS_DEFAULT_VOICE_ID. */
    elevenlabs_voice_id?: string | null
    elevenlabs_model_id?: string | null
    /** Descrição da tool para o modelo (opcional). */
    elevenlabs_voice_tool_description?: string | null
    /** Follow-up automático após silêncio do cliente (requer job em `/api/ai/followup-cron`). */
    ai_followup_enabled?: boolean
    /** Passos: `[{ delay_minutes, message }]` (JSONB). */
    ai_followup_steps?: unknown
    /** BYOK OpenAI; se vazio, usa OPENAI_API_KEY no servidor. */
    openai_api_key?: string | null
    /** BYOK Gemini; se vazio, usa GOOGLE_API_KEY no servidor. */
    google_api_key?: string | null
    /** Várias bolhas WhatsApp por turno (split do texto). */
    ai_chunk_messages_enabled?: boolean
    /** paragraph: quebra por linha em branco; lines: cada linha é uma bolha. */
    ai_chunk_split_mode?: string | null
    /** Máximo de mensagens por turno (1–20 no servidor). */
    ai_chunk_max_parts?: number
}

export type VoiceDeliveryRecord = {
    transcript: string
    whatsappId: string | null
}

/** Tokens reportados pelo fornecedor (agregados num único turno, incl. várias rondas com tools). */
export type LlmUsageSnapshot = {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
}

export type LLMResponse = {
    text: string
    shouldHandoff: boolean
    handoffReason?: string
    /** Áudios enviados durante tool calls (persistir em `messages`). */
    voiceDeliveries?: VoiceDeliveryRecord[]
    /** Metadados de uso quando o fornecedor expõe contagem de tokens. */
    usage?: LlmUsageSnapshot
}

export type BuiltContext = {
    contactId: string
    contactName: string
    contactPhone: string
    transcript: string
}
