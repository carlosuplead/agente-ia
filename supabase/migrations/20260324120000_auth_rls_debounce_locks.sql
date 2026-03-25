-- Auth helpers, RLS, debounce locks, increment RPC, tenant RLS + default AI config

-- Platform admins (bootstrap: INSERT manual após criar utilizador em auth.users)
CREATE TABLE IF NOT EXISTS public.platform_admins (
    user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Membros por workspace (slug alinha com schema do tenant)
CREATE TABLE IF NOT EXISTS public.workspace_members (
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    workspace_slug TEXT NOT NULL REFERENCES public.workspaces (slug) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, workspace_slug)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_slug ON public.workspace_members (workspace_slug);

-- Lock curto por contacto para evitar corridas entre pedidos paralelos ao LLM
CREATE TABLE IF NOT EXISTS public.ai_process_locks (
    workspace_slug TEXT NOT NULL,
    contact_id UUID NOT NULL,
    locked_until TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (workspace_slug, contact_id)
);

CREATE OR REPLACE FUNCTION public.try_ai_process_lock(p_slug TEXT, p_contact UUID, p_ttl_seconds INT DEFAULT 45)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.ai_process_locks WHERE locked_until < NOW();
    BEGIN
        INSERT INTO public.ai_process_locks (workspace_slug, contact_id, locked_until)
        VALUES (p_slug, p_contact, NOW() + make_interval(secs => p_ttl_seconds));
        RETURN TRUE;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN FALSE;
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_ai_process_lock(p_slug TEXT, p_contact UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.ai_process_locks WHERE workspace_slug = p_slug AND contact_id = p_contact;
END;
$$;

-- Incremento atómico da conversa (evita duplo incremento com pedidos paralelos)
CREATE OR REPLACE FUNCTION public.increment_ai_conversation_if_under_cap(
    p_tenant TEXT,
    p_conv_id UUID,
    p_cap INT
)
RETURNS TABLE (new_count INT, updated_ok BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new INT;
BEGIN
    EXECUTE format(
        'UPDATE %I.ai_conversations
         SET messages_count = messages_count + 1
         WHERE id = $1 AND status = ''active'' AND messages_count < $2
         RETURNING messages_count',
        p_tenant
    )
    INTO v_new
    USING p_conv_id, p_cap;

    IF v_new IS NULL THEN
        RETURN QUERY SELECT NULL::INT, FALSE;
    ELSE
        RETURN QUERY SELECT v_new, TRUE;
    END IF;
END;
$$;

-- Uma instância WhatsApp por workspace (alinhado com .single() nas rotas)
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_one_per_workspace
    ON public.whatsapp_instances (workspace_slug);

-- RLS: tabelas públicas
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_admins_self ON public.platform_admins;
CREATE POLICY platform_admins_self ON public.platform_admins
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS workspace_members_self ON public.workspace_members;
CREATE POLICY workspace_members_self ON public.workspace_members
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS workspace_members_admin_all ON public.workspace_members;
CREATE POLICY workspace_members_admin_all ON public.workspace_members
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()));

DROP POLICY IF EXISTS workspaces_member_or_admin ON public.workspaces;
CREATE POLICY workspaces_member_or_admin ON public.workspaces
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = workspaces.slug AND wm.user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
    );

DROP POLICY IF EXISTS workspaces_insert_admin ON public.workspaces;
CREATE POLICY workspaces_insert_admin ON public.workspaces
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()));

DROP POLICY IF EXISTS whatsapp_instances_select ON public.whatsapp_instances;
CREATE POLICY whatsapp_instances_select ON public.whatsapp_instances
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_instances.workspace_slug AND wm.user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
    );

DROP POLICY IF EXISTS whatsapp_instances_insert ON public.whatsapp_instances;
CREATE POLICY whatsapp_instances_insert ON public.whatsapp_instances
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR (
            EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.workspace_slug = whatsapp_instances.workspace_slug
                  AND wm.user_id = auth.uid()
                  AND wm.role IN ('owner', 'admin')
            )
        )
    );

DROP POLICY IF EXISTS whatsapp_instances_update ON public.whatsapp_instances;
CREATE POLICY whatsapp_instances_update ON public.whatsapp_instances
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_instances.workspace_slug AND wm.user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_instances.workspace_slug AND wm.user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
    );

-- Substitui provisionamento: seed ai_agent_config + RLS nos schemas de tenant
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
            system_prompt TEXT NOT NULL,
            max_messages_per_conversation INTEGER NOT NULL DEFAULT 50,
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
        INSERT INTO %I.ai_agent_config (system_prompt)
        VALUES (''Você é um assistente virtual. Seja cordial e objetivo. Ajuste o tom ao contexto da empresa.'')
    ', tenant_slug);

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

GRANT EXECUTE ON FUNCTION public.try_ai_process_lock(TEXT, UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_process_lock(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_ai_conversation_if_under_cap(TEXT, UUID, INT) TO service_role;
