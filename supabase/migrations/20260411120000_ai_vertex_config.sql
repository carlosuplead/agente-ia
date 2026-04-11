-- Vertex AI config por workspace: project, location e service account JSON.
-- Permite cada workspace usar Vertex AI (limites enterprise) sem env vars globais.

DO $$
DECLARE
    tenant_slug TEXT;
BEGIN
    FOR tenant_slug IN SELECT slug FROM public.workspaces LOOP
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS google_vertex_project TEXT',
            tenant_slug
        );
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS google_vertex_location TEXT',
            tenant_slug
        );
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS google_service_account_json TEXT',
            tenant_slug
        );
    END LOOP;
END;
$$;
