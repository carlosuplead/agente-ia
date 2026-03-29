-- Permitir apagar registo de instância Uazapi (dashboard: repor ligação do zero)
DROP POLICY IF EXISTS whatsapp_instances_delete ON public.whatsapp_instances;
CREATE POLICY whatsapp_instances_delete ON public.whatsapp_instances
    FOR DELETE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_slug = whatsapp_instances.workspace_slug
              AND wm.user_id = auth.uid()
              AND wm.role IN ('owner', 'admin', 'member')
        )
    );
