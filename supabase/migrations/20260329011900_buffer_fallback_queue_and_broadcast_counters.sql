-- 1. Tabela de fallback para quando o buffer não consegue chamar /api/ai/schedule
CREATE TABLE IF NOT EXISTS public.ai_process_fallback_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_slug TEXT NOT NULL,
    contact_id UUID NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Evita duplicatas para o mesmo contato enquanto está na fila
    CONSTRAINT ai_process_fallback_unique UNIQUE (workspace_slug, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_fallback_queue_next
    ON public.ai_process_fallback_queue (next_attempt_at)
    WHERE attempts < 5;

-- 2. RPC atômica para incrementar contadores de broadcast (evita race condition)
CREATE OR REPLACE FUNCTION public.increment_broadcast_counters(
    p_broadcast_id UUID,
    p_sent INT DEFAULT 0,
    p_failed INT DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.whatsapp_broadcasts
    SET sent_count = COALESCE(sent_count, 0) + p_sent,
        failed_count = COALESCE(failed_count, 0) + p_failed,
        pending_count = GREATEST(0, COALESCE(pending_count, 0) - p_sent - p_failed),
        updated_at = NOW()
    WHERE id = p_broadcast_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_broadcast_counters(UUID, INT, INT) TO service_role;
