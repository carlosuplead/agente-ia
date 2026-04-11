-- Indexes de performance para Conversas (LATERAL JOINs rápidos)

DO $$
DECLARE
    tenant_slug TEXT;
BEGIN
    FOR tenant_slug IN SELECT slug FROM public.workspaces LOOP
        -- Index composto para messages: busca última msg por contact_id
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_messages_contact_created ON %I.messages (contact_id, created_at DESC) WHERE is_deleted = false',
            tenant_slug
        );
        -- Index composto para ai_conversations: busca última conversa por contact_id
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_ai_conv_contact_created ON %I.ai_conversations (contact_id, created_at DESC)',
            tenant_slug
        );
        -- Index para messages contact_id (usado no chat load)
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_messages_contact_id ON %I.messages (contact_id)',
            tenant_slug
        );
        RAISE NOTICE 'Created perf indexes for %', tenant_slug;
    END LOOP;
END;
$$;
