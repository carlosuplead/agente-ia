-- Add team_notification_template column to ai_agent_config for all tenants

DO $$
DECLARE
    tenant_slug TEXT;
BEGIN
    FOR tenant_slug IN SELECT slug FROM public.workspaces LOOP
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS team_notification_template TEXT',
            tenant_slug
        );
    END LOOP;
END;
$$;
