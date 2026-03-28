-- Meta token timestamp (long-lived ~60d); broadcasts + queue for official template sends

ALTER TABLE public.whatsapp_instances
    ADD COLUMN IF NOT EXISTS meta_token_obtained_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.whatsapp_broadcasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_slug TEXT NOT NULL REFERENCES public.workspaces (slug) ON DELETE CASCADE,
    name TEXT NOT NULL,
    template_name TEXT NOT NULL,
    template_language TEXT NOT NULL DEFAULT 'pt_BR',
    template_components JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed')),
    scheduled_at TIMESTAMPTZ,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    pending_count INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_broadcasts_workspace ON public.whatsapp_broadcasts (workspace_slug);
CREATE INDEX IF NOT EXISTS idx_whatsapp_broadcasts_status ON public.whatsapp_broadcasts (workspace_slug, status);

CREATE TABLE IF NOT EXISTS public.whatsapp_broadcast_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id UUID NOT NULL REFERENCES public.whatsapp_broadcasts (id) ON DELETE CASCADE,
    workspace_slug TEXT NOT NULL,
    contact_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    last_error TEXT,
    whatsapp_message_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_queue_pending
    ON public.whatsapp_broadcast_queue (status, next_attempt_at, created_at)
    WHERE status IN ('pending', 'sending');

CREATE INDEX IF NOT EXISTS idx_broadcast_queue_broadcast ON public.whatsapp_broadcast_queue (broadcast_id);

ALTER TABLE public.whatsapp_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_broadcast_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_broadcasts_select ON public.whatsapp_broadcasts;
CREATE POLICY whatsapp_broadcasts_select ON public.whatsapp_broadcasts
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_broadcasts.workspace_slug AND wm.user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
    );

DROP POLICY IF EXISTS whatsapp_broadcasts_insert ON public.whatsapp_broadcasts;
CREATE POLICY whatsapp_broadcasts_insert ON public.whatsapp_broadcasts
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_broadcasts.workspace_slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS whatsapp_broadcasts_update ON public.whatsapp_broadcasts;
CREATE POLICY whatsapp_broadcasts_update ON public.whatsapp_broadcasts
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_broadcasts.workspace_slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_broadcasts.workspace_slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS whatsapp_broadcasts_delete ON public.whatsapp_broadcasts;
CREATE POLICY whatsapp_broadcasts_delete ON public.whatsapp_broadcasts
    FOR DELETE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_broadcasts.workspace_slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS whatsapp_broadcast_queue_select ON public.whatsapp_broadcast_queue;
CREATE POLICY whatsapp_broadcast_queue_select ON public.whatsapp_broadcast_queue
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_broadcast_queue.workspace_slug AND wm.user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
    );

DROP POLICY IF EXISTS whatsapp_broadcast_queue_insert ON public.whatsapp_broadcast_queue;
CREATE POLICY whatsapp_broadcast_queue_insert ON public.whatsapp_broadcast_queue
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_broadcast_queue.workspace_slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS whatsapp_broadcast_queue_update ON public.whatsapp_broadcast_queue;
CREATE POLICY whatsapp_broadcast_queue_update ON public.whatsapp_broadcast_queue
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_broadcast_queue.workspace_slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_broadcast_queue.workspace_slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS whatsapp_broadcast_queue_delete ON public.whatsapp_broadcast_queue;
CREATE POLICY whatsapp_broadcast_queue_delete ON public.whatsapp_broadcast_queue
    FOR DELETE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_broadcast_queue.workspace_slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin')
        )
    );
