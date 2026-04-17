-- Tokens de webhook por workspace (reduz fricção e dá isolamento entre tenants).
-- Meta: verify_token usado no passo "verify" do Meta. App Secret permanece global.
-- Uazapi: secret partilhado (header x-uazapi-secret ou ?secret=) por workspace.

ALTER TABLE public.whatsapp_instances
    ADD COLUMN IF NOT EXISTS meta_webhook_verify_token TEXT,
    ADD COLUMN IF NOT EXISTS uazapi_webhook_secret TEXT;

-- Índice para busca rápida durante verify (GET /webhook/official?hub.verify_token=...)
CREATE INDEX IF NOT EXISTS whatsapp_instances_meta_verify_idx
    ON public.whatsapp_instances (meta_webhook_verify_token)
    WHERE meta_webhook_verify_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_instances_uazapi_secret_idx
    ON public.whatsapp_instances (uazapi_webhook_secret)
    WHERE uazapi_webhook_secret IS NOT NULL;
