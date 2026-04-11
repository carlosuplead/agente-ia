-- Fix: llm_usage.conversation_id → ai_conversation_id (código usa ai_conversation_id)

DO $$
DECLARE
    tenant_slug TEXT;
BEGIN
    FOR tenant_slug IN SELECT slug FROM public.workspaces LOOP
        -- Rename column if it exists as conversation_id
        BEGIN
            EXECUTE format(
                'ALTER TABLE %I.llm_usage RENAME COLUMN conversation_id TO ai_conversation_id',
                tenant_slug
            );
            RAISE NOTICE 'Renamed conversation_id → ai_conversation_id in %.llm_usage', tenant_slug;
        EXCEPTION WHEN undefined_column THEN
            -- Column might already be ai_conversation_id or table might not exist
            RAISE NOTICE 'Column conversation_id not found in %.llm_usage (already renamed or missing)', tenant_slug;
        WHEN undefined_table THEN
            RAISE NOTICE 'Table %.llm_usage does not exist', tenant_slug;
        END;
    END LOOP;
END;
$$;
