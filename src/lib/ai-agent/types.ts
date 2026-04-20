export type AiAgentConfig = {
    id: string
    enabled: boolean
    provider: 'gemini' | 'openai' | 'anthropic'
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
    /** BYOK ElevenLabs; se vazio, usa ELEVENLABS_API_KEY no servidor. */
    elevenlabs_api_key?: string | null
    /** Follow-up automático após silêncio do cliente (requer job em `/api/ai/followup-cron`). */
    ai_followup_enabled?: boolean
    /** Prompt customizado para gerar follow-ups via IA (se vazio, usa texto fixo). */
    ai_followup_prompt?: string | null
    /** Passos: `[{ delay_minutes, message }]` (JSONB). */
    ai_followup_steps?: unknown
    /** BYOK OpenAI; se vazio, usa OPENAI_API_KEY no servidor. */
    openai_api_key?: string | null
    /** BYOK Gemini; se vazio, usa GOOGLE_API_KEY no servidor. */
    google_api_key?: string | null
    /** Vertex AI — project ID do Google Cloud (se preenchido, usa Vertex em vez de AI Studio). */
    google_vertex_project?: string | null
    /** Vertex AI — região (default: us-central1). */
    google_vertex_location?: string | null
    /** Vertex AI — JSON da service account (se preenchido, autentica com service account). */
    google_service_account_json?: string | null
    /** BYOK Anthropic; se vazio, usa ANTHROPIC_API_KEY no servidor. */
    anthropic_api_key?: string | null
    /** Provedor de fallback quando o primário falha. */
    fallback_provider?: 'gemini' | 'openai' | 'anthropic' | null
    /** Várias bolhas WhatsApp por turno (split do texto). */
    ai_chunk_messages_enabled?: boolean
    /** paragraph: quebra por linha em branco; lines: cada linha é uma bolha. */
    ai_chunk_split_mode?: string | null
    /** Máximo de mensagens por turno (1–20 no servidor). */
    ai_chunk_max_parts?: number
    /** Só números na allowlist recebem mensagens gravadas e respostas da IA (com lista válida). */
    ai_test_mode?: boolean
    /** Texto livre: linhas ou separadores vírgula/; — normalizado como contacts.phone. */
    ai_test_allowlist_phones?: string | null
    /** Tool `notify_team_whatsapp`: envia texto da instância para números autorizados. */
    team_notification_enabled?: boolean
    team_notification_allowlist_phones?: string | null
    team_notification_tool_description?: string | null
    /** Se true (default), anexa excerto recente do transcript à notificação. */
    team_notification_append_transcript?: boolean
    /** Template de formato para a notificação — a IA preenche os campos. */
    team_notification_template?: string | null
    /** Notificação automática ao vendedor via UAZAPI dedicada (separada da instância principal). */
    seller_notification_enabled?: boolean
    /** URL base da UAZAPI (ex. https://atendsoft.uazapi.com). */
    seller_notification_uazapi_url?: string | null
    /** Token UAZAPI guardado em texto cifrado (AES-256-GCM via WORKSPACE_LLM_KEYS_SECRET). */
    seller_notification_uazapi_token?: string | null
    /** Telefones a notificar (um por linha ou vírgula). */
    seller_notification_phones?: string | null
    /** Disparar ao criar agendamento Google Calendar (default true). */
    seller_notification_on_appointment?: boolean
    /** Disparar quando a IA transferir o atendimento para humano — handoff (default true). */
    seller_notification_on_handoff?: boolean
    /** Template de mensagem. Placeholders: {nome}, {telefone}, {email}, {agendamento}, {resumo}, {vendedor}, {motivo}. */
    seller_notification_message_template?: string | null
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
