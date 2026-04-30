export type WorkspaceRow = { id: string; name: string; slug: string; created_at: string }
export type InstanceRow = {
    id: string
    status: string
    provider?: 'uazapi' | 'official' | null
    phone_number: string | null
    phone_number_id?: string | null
    waba_id?: string | null
    meta_token_obtained_at?: string | null
    meta_webhook_verify_token?: string | null
    uazapi_webhook_secret?: string | null
    last_connected_at: string | null
    updated_at?: string
} | null

export type AiConfigRow = {
    enabled: boolean
    provider: string
    model: string
    temperature: number
    system_prompt: string
    max_messages_per_conversation: number
    context_max_messages?: number
    human_handoff_enabled?: boolean
    transfer_tool_description?: string | null
    handoff_default_reply?: string | null
    whatsapp_formatting_extra?: string | null
    send_delay_ms?: number
    send_presence?: string | null
    handoff_keywords?: string | null
    label_team?: string
    label_assistant?: string
    buffer_delay_seconds?: number
    greeting_message?: string | null
    n8n_webhook_url?: string | null
    n8n_webhook_enabled?: boolean
    n8n_webhook_timeout_seconds?: number
    n8n_tool_description?: string | null
    n8n_tools?: unknown
    inactivity_timeout_hours?: number
    ai_followup_enabled?: boolean
    ai_followup_prompt?: string | null
    ai_followup_steps?: unknown
    elevenlabs_voice_enabled?: boolean
    elevenlabs_voice_id?: string | null
    elevenlabs_model_id?: string | null
    elevenlabs_voice_tool_description?: string | null
    /** API: chave não é devolvida; só indica se existe valor na BD. */
    openai_api_key_set?: boolean
    google_api_key_set?: boolean
    anthropic_api_key_set?: boolean
    elevenlabs_api_key_set?: boolean
    google_vertex_project?: string | null
    google_vertex_location?: string | null
    google_service_account_json_set?: boolean
    fallback_provider?: string | null
    ai_chunk_messages_enabled?: boolean
    ai_chunk_split_mode?: string | null
    ai_chunk_max_parts?: number
    ai_test_mode?: boolean
    ai_test_allowlist_phones?: string | null
    team_notification_enabled?: boolean
    team_notification_allowlist_phones?: string | null
    team_notification_tool_description?: string | null
    team_notification_append_transcript?: boolean
    team_notification_template?: string | null
    /** Notificação ao vendedor via UAZAPI separada (disparo automático após agendamento). */
    seller_notification_enabled?: boolean
    seller_notification_uazapi_url?: string | null
    /** API: token não é devolvido; só indica se existe valor na BD. */
    seller_notification_uazapi_token_set?: boolean
    seller_notification_phones?: string | null
    seller_notification_on_appointment?: boolean
    seller_notification_on_handoff?: boolean
    seller_notification_message_template?: string | null
    /** Lista fixa de emails (separados por vírgula/ponto-e-vírgula/nova linha) que serão sempre adicionados como convidados nos eventos criados pela IA. */
    google_calendar_default_attendees?: string | null
}

export type MessageRow = {
    id: string
    body: string | null
    sender_type: string
    status: string
    created_at: string
    contact_id: string
}

export type N8nToolUiRow = {
    id: string
    slug: string
    url: string
    timeout_seconds: number
    description: string
}

export type GoogleCalendarStatus = {
    oauth_configured: boolean
    connected: boolean
    account_email: string | null
    calendar_id: string | null
    default_timezone: string | null
    updated_at: string | null
}

/** Opção na UI — dados vêm de GET /api/workspace/google-calendar/calendars */
export type GoogleCalendarPickerItem = {
    id: string
    summary: string
    primary?: boolean
}

export type DashboardTab = 'workspaces' | 'connection' | 'conversas' | 'disparos' | 'relatorios' | 'config' | 'atividade' | 'workspace_settings'

export type WorkspaceMembershipRow = { workspace_slug: string; role: string }
