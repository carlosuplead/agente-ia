-- Adiciona coluna `extra_fields` (JSONB) na tabela `contacts` de cada tenant.
-- Essa coluna guarda as colunas extras vindas do CSV/XLSX importado, com chave
-- = nome do header (lowercase, sem acentos) e valor = string. Usado depois
-- para personalização variável em broadcasts (substituição de {{var:xxx}}
-- em template_components).

DO $$
DECLARE
    tenant_slug TEXT;
BEGIN
    FOR tenant_slug IN SELECT slug FROM public.workspaces LOOP
        EXECUTE format(
            'ALTER TABLE %I.contacts ADD COLUMN IF NOT EXISTS extra_fields JSONB NOT NULL DEFAULT ''{}''::jsonb',
            tenant_slug
        );
    END LOOP;
END;
$$;
