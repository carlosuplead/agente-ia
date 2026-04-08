-- Adiciona suporte ao provider Anthropic (Claude) e fallback entre provedores

-- 1. Atualiza create_tenant_schema para incluir novos campos em novos workspaces
CREATE OR REPLACE FUNCTION public.create_tenant_schema(tenant_slug TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', tenant_slug);

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.ai_agent_config (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            enabled BOOLEAN NOT NULL DEFAULT true,
            provider TEXT NOT NULL DEFAULT ''gemini'',
            model TEXT NOT NULL DEFAULT ''gemini-2.5-flash'',
            temperature FLOAT NOT NULL DEFAULT 0.7,
            system_prompt TEXT NOT NULL DEFAULT ''Você é um assistente virtual. Seja cordial e objetivo.'',
            max_messages_per_conversation INTEGER NOT NULL DEFAULT 50,
            context_max_messages INTEGER DEFAULT 20,
            human_handoff_enabled BOOLEAN DEFAULT true,
            transfer_tool_description TEXT,
            handoff_default_reply TEXT,
            whatsapp_formatting_extra TEXT,
            send_delay_ms INTEGER DEFAULT 1200,
            send_presence TEXT DEFAULT ''composing'',
            handoff_keywords TEXT,
            label_team TEXT DEFAULT ''Equipe'',
            label_assistant TEXT DEFAULT ''Assistente'',
            buffer_delay_seconds INTEGER DEFAULT 30,
            greeting_message TEXT,
            n8n_webhook_url TEXT,
            n8n_webhook_enabled BOOLEAN DEFAULT false,
            n8n_webhook_timeout_seconds INTEGER DEFAULT 30,
            n8n_tool_description TEXT,
            n8n_tools JSONB DEFAULT ''[]''::jsonb,
            inactivity_timeout_hours INTEGER DEFAULT 24,
            ai_followup_enabled BOOLEAN DEFAULT false,
            ai_followup_steps JSONB DEFAULT ''[]''::jsonb,
            elevenlabs_voice_enabled BOOLEAN DEFAULT false,
            elevenlabs_voice_id TEXT,
            elevenlabs_model_id TEXT,
            elevenlabs_voice_tool_description TEXT,
            openai_api_key TEXT,
            google_api_key TEXT,
            anthropic_api_key TEXT,
            fallback_provider TEXT,
            ai_chunk_messages_enabled BOOLEAN DEFAULT false,
            ai_chunk_split_mode TEXT DEFAULT ''paragraph'',
            ai_chunk_max_parts INTEGER DEFAULT 8,
            ai_test_mode BOOLEAN DEFAULT false,
            ai_test_allowlist_phones TEXT,
            team_notification_enabled BOOLEAN DEFAULT false,
            team_notification_allowlist_phones TEXT,
            team_notification_tool_description TEXT,
            team_notification_append_transcript BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    ', tenant_slug);

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contacts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            avatar_url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    ', tenant_slug);

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.ai_conversations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID NOT NULL REFERENCES %I.contacts(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT ''active'',
            messages_count INTEGER NOT NULL DEFAULT 0,
            handoff_reason TEXT,
            followup_anchor_at TIMESTAMPTZ,
            followup_progress INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ
        )
    ', tenant_slug, tenant_slug);

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID NOT NULL REFERENCES %I.contacts(id) ON DELETE CASCADE,
            conversation_id UUID REFERENCES %I.ai_conversations(id) ON DELETE SET NULL,
            sender_type TEXT NOT NULL,
            body TEXT,
            media_url TEXT,
            media_type TEXT,
            status TEXT NOT NULL DEFAULT ''received'',
            whatsapp_id TEXT,
            is_deleted BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    ', tenant_slug, tenant_slug, tenant_slug);

    EXECUTE format('
        CREATE INDEX IF NOT EXISTS messages_created_at_desc ON %I.messages (created_at DESC)
    ', tenant_slug);

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.llm_usage (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID,
            provider TEXT,
            model TEXT,
            prompt_tokens INTEGER DEFAULT 0,
            completion_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    ', tenant_slug);

    -- Insere config default se a tabela estiver vazia
    EXECUTE format('
        INSERT INTO %I.ai_agent_config (system_prompt)
        SELECT ''Você é um assistente virtual. Seja cordial e objetivo.''
        WHERE NOT EXISTS (SELECT 1 FROM %I.ai_agent_config)
    ', tenant_slug, tenant_slug);
END;
$$;

-- 2. Adiciona colunas a schemas existentes (para workspaces já criados)
DO $$
DECLARE
    ws RECORD;
BEGIN
    FOR ws IN SELECT slug FROM public.workspaces LOOP
        EXECUTE format('ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT', ws.slug);
        EXECUTE format('ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS fallback_provider TEXT', ws.slug);
    END LOOP;
END;
$$;
