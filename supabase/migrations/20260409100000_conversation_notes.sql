-- Add internal_notes column to ai_conversations in all existing tenant schemas

DO $$
DECLARE
    tenant_slug TEXT;
BEGIN
    FOR tenant_slug IN
        SELECT slug FROM public.workspaces
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.ai_conversations ADD COLUMN IF NOT EXISTS internal_notes TEXT',
            tenant_slug
        );
    END LOOP;
END;
$$;

-- Also update the create_tenant_schema function to include internal_notes for new tenants
-- (The latest migration that redefines create_tenant_schema already includes this)
