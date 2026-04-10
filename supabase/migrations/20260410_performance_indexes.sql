-- =============================================================================
-- Migration: Índices compostos para performance das queries LATERAL JOIN
-- 
-- PROBLEMA: As queries de listagem de conversas fazem LATERAL JOIN em messages
-- e ai_conversations, mas os índices existentes só cobrem (created_at DESC).
-- O planner do Postgres faz sequential scan por contato sem índice composto.
--
-- IMPACTO: Reduz tempo da query de conversas de ~1-3s para ~50-200ms.
-- =============================================================================

-- 1. Índice composto para a query principal de listagem de conversas
--    Cobre: SELECT ... FROM messages WHERE contact_id = X AND is_deleted = false ORDER BY created_at DESC LIMIT 1
DO $$
DECLARE tenant_slug TEXT;
BEGIN
  FOR tenant_slug IN SELECT slug FROM public.workspaces LOOP

    -- Índice principal: messages por contato + data (filtro parcial is_deleted)
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS messages_contact_created_active ON %I.messages (contact_id, created_at DESC) WHERE is_deleted = false',
      tenant_slug
    );

    -- Índice para ai_conversations por contato + data
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS ai_conv_contact_created ON %I.ai_conversations (contact_id, created_at DESC)',
      tenant_slug
    );

    -- Índice para busca de conversa ativa por contato (usado no webhook e run-process)
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS ai_conv_contact_active ON %I.ai_conversations (contact_id, status) WHERE status = ''active''',
      tenant_slug
    );

    -- Índice para messages por sender_type (usado no dedup check e last inbound)
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS messages_contact_sender_created ON %I.messages (contact_id, sender_type, created_at DESC)',
      tenant_slug
    );

  END LOOP;
END $$;

-- 2. Atualizar create_tenant_schema para incluir os novos índices em workspaces futuros
-- (Adicionar ao final do bloco de EXECUTE format dos índices dentro de create_tenant_schema)

CREATE OR REPLACE FUNCTION public.ensure_tenant_perf_indexes(tenant_slug TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS messages_contact_created_active ON %I.messages (contact_id, created_at DESC) WHERE is_deleted = false',
        tenant_slug
    );
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS ai_conv_contact_created ON %I.ai_conversations (contact_id, created_at DESC)',
        tenant_slug
    );
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS ai_conv_contact_active ON %I.ai_conversations (contact_id, status) WHERE status = ''active''',
        tenant_slug
    );
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS messages_contact_sender_created ON %I.messages (contact_id, sender_type, created_at DESC)',
        tenant_slug
    );
END;
$$;

-- 3. Tabela de buffer queue (usada pelo novo buffer.ts)
CREATE TABLE IF NOT EXISTS public.ai_buffer_queue (
    workspace_slug TEXT NOT NULL,
    contact_id UUID NOT NULL,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INT NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_slug, contact_id)
);
