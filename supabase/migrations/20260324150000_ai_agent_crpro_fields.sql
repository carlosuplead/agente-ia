-- Campos alinhados ao CR Pro: buffer, saudação, N8N, inatividade, follow-up (flag)

DO $$
DECLARE
    tenant_slug TEXT;
BEGIN
    FOR tenant_slug IN SELECT slug FROM public.workspaces LOOP
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS buffer_delay_seconds INTEGER NOT NULL DEFAULT 30',
            tenant_slug
        );
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS greeting_message TEXT',
            tenant_slug
        );
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS n8n_webhook_url TEXT',
            tenant_slug
        );
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS n8n_webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE',
            tenant_slug
        );
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS n8n_webhook_timeout_seconds INTEGER NOT NULL DEFAULT 30',
            tenant_slug
        );
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS n8n_tool_description TEXT',
            tenant_slug
        );
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS inactivity_timeout_hours INTEGER NOT NULL DEFAULT 24',
            tenant_slug
        );
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS ai_followup_enabled BOOLEAN NOT NULL DEFAULT FALSE',
            tenant_slug
        );
    END LOOP;
END;
$$;

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
            singleton_key BOOLEAN NOT NULL DEFAULT TRUE,
            enabled BOOLEAN NOT NULL DEFAULT true,
            provider TEXT NOT NULL DEFAULT ''gemini'',
            model TEXT NOT NULL DEFAULT ''gemini-2.5-flash'',
            temperature FLOAT NOT NULL DEFAULT 0.7,
            system_prompt TEXT NOT NULL,
            max_messages_per_conversation INTEGER NOT NULL DEFAULT 50,
            context_max_messages INTEGER NOT NULL DEFAULT 20,
            human_handoff_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            transfer_tool_description TEXT,
            handoff_default_reply TEXT,
            whatsapp_formatting_extra TEXT,
            send_delay_ms INTEGER NOT NULL DEFAULT 1200,
            send_presence TEXT NOT NULL DEFAULT ''composing'',
            handoff_keywords TEXT,
            label_team TEXT NOT NULL DEFAULT ''Equipe'',
            label_assistant TEXT NOT NULL DEFAULT ''Assistente'',
            buffer_delay_seconds INTEGER NOT NULL DEFAULT 30,
            greeting_message TEXT,
            n8n_webhook_url TEXT,
            n8n_webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            n8n_webhook_timeout_seconds INTEGER NOT NULL DEFAULT 30,
            n8n_tool_description TEXT,
            inactivity_timeout_hours INTEGER NOT NULL DEFAULT 24,
            ai_followup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
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
        CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_config_singleton_key
        ON %I.ai_agent_config (singleton_key)
    ', tenant_slug);

    EXECUTE format('
        CREATE UNIQUE INDEX IF NOT EXISTS messages_whatsapp_id_unique
        ON %I.messages (whatsapp_id)
        WHERE whatsapp_id IS NOT NULL
    ', tenant_slug);

    EXECUTE format('
        INSERT INTO %I.ai_agent_config (singleton_key, system_prompt)
        SELECT TRUE, ''Você é um assistente virtual. Seja cordial e objetivo. Ajuste o tom ao contexto da empresa.''
        WHERE NOT EXISTS (SELECT 1 FROM %I.ai_agent_config)
    ', tenant_slug, tenant_slug);

    EXECUTE format('ALTER TABLE %I.contacts ENABLE ROW LEVEL SECURITY', tenant_slug);
    EXECUTE format('ALTER TABLE %I.messages ENABLE ROW LEVEL SECURITY', tenant_slug);
    EXECUTE format('ALTER TABLE %I.ai_conversations ENABLE ROW LEVEL SECURITY', tenant_slug);
    EXECUTE format('ALTER TABLE %I.ai_agent_config ENABLE ROW LEVEL SECURITY', tenant_slug);

    EXECUTE format('
        CREATE POLICY tenant_contacts_access ON %I.contacts
        FOR ALL TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L
            )
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L
            )
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
    ', tenant_slug, tenant_slug, tenant_slug);

    EXECUTE format('
        CREATE POLICY tenant_messages_access ON %I.messages
        FOR ALL TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L
            )
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L
            )
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
    ', tenant_slug, tenant_slug, tenant_slug);

    EXECUTE format('
        CREATE POLICY tenant_ai_conversations_access ON %I.ai_conversations
        FOR ALL TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L
            )
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L
            )
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
    ', tenant_slug, tenant_slug, tenant_slug);

    EXECUTE format('
        CREATE POLICY tenant_ai_config_access ON %I.ai_agent_config
        FOR ALL TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L
            )
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.user_id = auth.uid() AND wm.workspace_slug = %L
            )
            OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        )
    ', tenant_slug, tenant_slug, tenant_slug);
END;
$$;
