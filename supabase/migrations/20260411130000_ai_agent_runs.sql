-- Registo de execuções do processamento IA por tenant (dashboard Atividade / estilo n8n)

DO $$
DECLARE
    tenant_slug TEXT;
BEGIN
    FOR tenant_slug IN SELECT slug FROM public.workspaces LOOP
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

        EXECUTE format('ALTER TABLE %I.ai_agent_runs ENABLE ROW LEVEL SECURITY', tenant_slug);
        EXECUTE format('DROP POLICY IF EXISTS tenant_ai_agent_runs_access ON %I.ai_agent_runs', tenant_slug);
        EXECUTE format('
            CREATE POLICY tenant_ai_agent_runs_access ON %I.ai_agent_runs
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
    END LOOP;
END;
$$;
