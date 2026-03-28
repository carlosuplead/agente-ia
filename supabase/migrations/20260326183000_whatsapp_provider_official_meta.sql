ALTER TABLE public.whatsapp_instances
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'uazapi',
    ADD COLUMN IF NOT EXISTS phone_number_id TEXT,
    ADD COLUMN IF NOT EXISTS waba_id TEXT,
    ADD COLUMN IF NOT EXISTS meta_access_token TEXT;

UPDATE public.whatsapp_instances
SET provider = 'uazapi'
WHERE provider IS NULL OR provider = '';

ALTER TABLE public.whatsapp_instances
    DROP CONSTRAINT IF EXISTS whatsapp_instances_provider_check;

ALTER TABLE public.whatsapp_instances
    ADD CONSTRAINT whatsapp_instances_provider_check
    CHECK (provider IN ('uazapi', 'official'));

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_official_phone_number_id_idx
    ON public.whatsapp_instances (phone_number_id)
    WHERE provider = 'official' AND phone_number_id IS NOT NULL;
