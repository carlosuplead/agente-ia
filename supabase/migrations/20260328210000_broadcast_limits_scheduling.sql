-- Broadcast scheduling, daily caps, cancellation, sent_at for queue metrics

-- whatsapp_broadcasts: extend status check + new columns
ALTER TABLE public.whatsapp_broadcasts DROP CONSTRAINT IF EXISTS whatsapp_broadcasts_status_check;
ALTER TABLE public.whatsapp_broadcasts
    ADD CONSTRAINT whatsapp_broadcasts_status_check
    CHECK (
        status IN (
            'draft',
            'scheduled',
            'running',
            'paused',
            'completed',
            'failed',
            'cancelled'
        )
    );

ALTER TABLE public.whatsapp_broadcasts
    ADD COLUMN IF NOT EXISTS max_sends_per_day INTEGER,
    ADD COLUMN IF NOT EXISTS send_timezone TEXT NOT NULL DEFAULT 'Europe/Lisbon';

COMMENT ON COLUMN public.whatsapp_broadcasts.max_sends_per_day IS 'NULL = unlimited sends per calendar day (send_timezone)';
COMMENT ON COLUMN public.whatsapp_broadcasts.send_timezone IS 'IANA timezone for daily cap boundary';

-- whatsapp_broadcast_queue: sent_at + cancelled status
ALTER TABLE public.whatsapp_broadcast_queue DROP CONSTRAINT IF EXISTS whatsapp_broadcast_queue_status_check;
ALTER TABLE public.whatsapp_broadcast_queue
    ADD CONSTRAINT whatsapp_broadcast_queue_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled'));

ALTER TABLE public.whatsapp_broadcast_queue
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

UPDATE public.whatsapp_broadcast_queue
SET sent_at = created_at
WHERE status = 'sent' AND sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_broadcast_queue_sent_at
    ON public.whatsapp_broadcast_queue (broadcast_id, sent_at)
    WHERE status = 'sent';
