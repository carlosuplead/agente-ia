-- Papel "client" (acesso só portal) + RLS para instância WhatsApp e nome do workspace

-- 1) Estender CHECK de role em workspace_members (nome da constraint varia entre versões)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND t.relname = 'workspace_members'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%role%'
    LOOP
        EXECUTE format('ALTER TABLE public.workspace_members DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE public.workspace_members
    ADD CONSTRAINT workspace_members_role_check
    CHECK (role IN ('owner', 'admin', 'member', 'client'));

-- 2) Instância WhatsApp: membros owner/admin/member/client podem criar (platform_admin mantém-se)
DROP POLICY IF EXISTS whatsapp_instances_insert ON public.whatsapp_instances;
CREATE POLICY whatsapp_instances_insert ON public.whatsapp_instances
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR (
            EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.workspace_slug = whatsapp_instances.workspace_slug
                  AND wm.user_id = auth.uid()
                  AND wm.role IN ('owner', 'admin', 'member', 'client')
            )
        )
    );

-- 3) Atualizar nome do workspace (slug imutável na prática — não expor na UI)
DROP POLICY IF EXISTS workspaces_update_owner_admin ON public.workspaces;
CREATE POLICY workspaces_update_owner_admin ON public.workspaces
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = workspaces.slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin')
        )
        OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = workspaces.slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin')
        )
        OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
    );
