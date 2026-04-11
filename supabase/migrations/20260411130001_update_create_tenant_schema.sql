-- Atualiza create_tenant_schema com ai_agent_runs + todas as colunas atuais

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
            ai_followup_prompt TEXT,
            ai_followup_steps JSONB DEFAULT ''[]''::jsonb,
            elevenlabs_voice_enabled BOOLEAN DEFAULT false,
            elevenlabs_voice_id TEXT,
            elevenlabs_model_id TEXT,
            elevenlabs_voice_tool_description TEXT,
            openai_api_key TEXT,
            google_api_key TEXT,
            anthropic_api_key TEXT,
            elevenlabs_api_key TEXT,
            fallback_provider TEXT,
            google_vertex_project TEXT,
            google_vertex_location TEXT,
            google_service_account_json TEXT,
            ai_chunk_messages_enabled BOOLEAN DEFAULT false,
            ai_chunk_split_mode TEXT DEFAULT ''paragraph'',
            ai_chunk_max_parts INTEGER DEFAULT 8,
            ai_test_mode BOOLEAN DEFAULT false,
            ai_test_allowlist_phones TEXT,
            team_notification_enabled BOOLEAN DEFAULT false,
            team_notification_allowlist_phones TEXT,
            team_notification_tool_description TEXT,
            team_notification_append_transcript BOOLEAN DEFAULT true,
            team_notification_template TEXT,
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
            internal_notes TEXT,
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
            ai_conversation_id UUID,
            contact_id UUID,
            provider TEXT,
            model TEXT,
            prompt_tokens INTEGER DEFAULT 0,
            completion_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    ', tenant_slug);

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.ai_agent_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID NOT NULL REFERENCES %I.contacts(id) ON DELETE CASCADE,
            conversation_id UUID REFERENCES %I.ai_conversations(id) ON DELETE SET NULL,
            status TEXT NOT NULL,
            source TEXT NOT NULL,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at TIMESTAMPTZ,
            reason TEXT,
            error_message TEXT,
            meta JSONB NOT NULL DEFAULT ''{}''::jsonb
        )
    ', tenant_slug, tenant_slug, tenant_slug);

    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS ai_agent_runs_started_at_desc ON %I.ai_agent_runs (started_at DESC)',
        tenant_slug
    );
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS ai_agent_runs_status_started ON %I.ai_agent_runs (status, started_at DESC)',
        tenant_slug
    );

    -- RLS
    EXECUTE format('ALTER TABLE %I.contacts ENABLE ROW LEVEL SECURITY', tenant_slug);
    EXECUTE format('ALTER TABLE %I.messages ENABLE ROW LEVEL SECURITY', tenant_slug);
    EXECUTE format('ALTER TABLE %I.ai_conversations ENABLE ROW LEVEL SECURITY', tenant_slug);
    EXECUTE format('ALTER TABLE %I.ai_agent_config ENABLE ROW LEVEL SECURITY', tenant_slug);
    EXECUTE format('ALTER TABLE %I.ai_agent_runs ENABLE ROW LEVEL SECURITY', tenant_slug);

    -- Policies
    EXECUTE format('DROP POLICY IF EXISTS tenant_contacts_access ON %I.contacts', tenant_slug);
    EXECUTE format('
        CREATE POLICY tenant_contacts_access ON %I.contacts
        FOR ALL TO authenticated
        USING (
            EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L)
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
        WITH CHECK (
            EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L)
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
    ', tenant_slug, tenant_slug, tenant_slug);

    EXECUTE format('DROP POLICY IF EXISTS tenant_messages_access ON %I.messages', tenant_slug);
    EXECUTE format('
        CREATE POLICY tenant_messages_access ON %I.messages
        FOR ALL TO authenticated
        USING (
            EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L)
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
        WITH CHECK (
            EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L)
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
    ', tenant_slug, tenant_slug, tenant_slug);

    EXECUTE format('DROP POLICY IF EXISTS tenant_ai_conversations_access ON %I.ai_conversations', tenant_slug);
    EXECUTE format('
        CREATE POLICY tenant_ai_conversations_access ON %I.ai_conversations
        FOR ALL TO authenticated
        USING (
            EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L)
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
        WITH CHECK (
            EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L)
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
    ', tenant_slug, tenant_slug, tenant_slug);

    EXECUTE format('DROP POLICY IF EXISTS tenant_ai_config_access ON %I.ai_agent_config', tenant_slug);
    EXECUTE format('
        CREATE POLICY tenant_ai_config_access ON %I.ai_agent_config
        FOR ALL TO authenticated
        USING (
            EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L)
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
        WITH CHECK (
            EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L)
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
    ', tenant_slug, tenant_slug, tenant_slug);

    EXECUTE format('DROP POLICY IF EXISTS tenant_ai_agent_runs_access ON %I.ai_agent_runs', tenant_slug);
    EXECUTE format('
        CREATE POLICY tenant_ai_agent_runs_access ON %I.ai_agent_runs
        FOR ALL TO authenticated
        USING (
            EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L)
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
        WITH CHECK (
            EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L)
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
    ', tenant_slug, tenant_slug, tenant_slug);

    -- Seed config
    EXECUTE format('
        INSERT INTO %I.ai_agent_config (system_prompt)
        SELECT ''Você é um assistente virtual. Seja cordial e objetivo.''
        WHERE NOT EXISTS (SELECT 1 FROM %I.ai_agent_config)
    ', tenant_slug, tenant_slug);
END;
$$;
