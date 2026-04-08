-- Chave ElevenLabs opcional por workspace (BYOK); fallback: ELEVENLABS_API_KEY no servidor.

DO $$
DECLARE
    tenant_slug TEXT;
BEGIN
    FOR tenant_slug IN SELECT slug FROM public.workspaces LOOP
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS elevenlabs_api_key TEXT',
            tenant_slug
        );
    END LOOP;
END;
$$;
