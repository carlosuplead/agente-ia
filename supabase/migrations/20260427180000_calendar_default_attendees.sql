-- Lista fixa de emails que serão sempre adicionados como convidados nos
-- eventos criados pela IA (ex: vendedor, gestor, etc.). A IA também pode
-- passar o email do cliente (capturado na conversa) como convidado adicional;
-- backend junta as duas listas e cria evento com todos como attendees.
--
-- Formato: emails separados por vírgula, ponto-e-vírgula ou nova linha.
-- Ex: "vendedor@empresa.com, gestor@empresa.com"

DO $$
DECLARE
    tenant_slug TEXT;
BEGIN
    FOR tenant_slug IN SELECT slug FROM public.workspaces LOOP
        EXECUTE format(
            'ALTER TABLE %I.ai_agent_config ADD COLUMN IF NOT EXISTS google_calendar_default_attendees TEXT',
            tenant_slug
        );
    END LOOP;
END;
$$;
