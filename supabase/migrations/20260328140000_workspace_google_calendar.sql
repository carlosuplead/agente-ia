-- Ligação Google Calendar por workspace (tokens só via service role / rotas servidor — RLS sem policies = nega anon/authenticated)

CREATE TABLE IF NOT EXISTS public.workspace_google_calendar (
    workspace_slug TEXT NOT NULL PRIMARY KEY REFERENCES public.workspaces (slug) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL,
    access_token TEXT,
    token_expires_at TIMESTAMPTZ,
    calendar_id TEXT NOT NULL DEFAULT 'primary',
    account_email TEXT,
    default_timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_google_calendar_workspace_slug_idx
    ON public.workspace_google_calendar (workspace_slug);

ALTER TABLE public.workspace_google_calendar ENABLE ROW LEVEL SECURITY;
