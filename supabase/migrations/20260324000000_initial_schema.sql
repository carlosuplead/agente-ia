-- Inicialização do Banco de Dados para Agente de IA WhatsApp (Multi-Tenant via Schema-Per-Tenant)

-- 1. Criação da Tabela Mestra de Workspaces (Public Schema)
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE, -- Usado como NOME DO SCHEMA (ex: 'moreli', 'diel')
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.5 Tabela de Instâncias do WhatsApp (Public Schema)
-- O webhook bate aqui primeiro para descobrir de qual "pasta" (slug) a mensagem pertence
CREATE TABLE IF NOT EXISTS public.whatsapp_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_slug TEXT NOT NULL REFERENCES public.workspaces(slug) ON DELETE CASCADE,
    instance_token TEXT NOT NULL UNIQUE,
    phone_number TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected',
    last_connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 2. Função RPC para provisionar um novo Schema para o Cliente
CREATE OR REPLACE FUNCTION public.create_tenant_schema(tenant_slug TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- 2.1 Criar o Schema com o nome do slug do cliente
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', tenant_slug);

    -- 2.2 Criar Tabela: ai_agent_config

    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.ai_agent_config (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            enabled BOOLEAN NOT NULL DEFAULT true,
            provider TEXT NOT NULL DEFAULT ''gemini'',
            model TEXT NOT NULL DEFAULT ''gemini-2.5-flash'',
            temperature FLOAT NOT NULL DEFAULT 0.7,
            system_prompt TEXT NOT NULL,
            max_messages_per_conversation INTEGER NOT NULL DEFAULT 50,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    ', tenant_slug);

    -- 2.3 Criar Tabela: contacts
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contacts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            avatar_url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    ', tenant_slug);

    -- 2.4 Criar Tabela: ai_conversations
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.ai_conversations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID NOT NULL REFERENCES %I.contacts(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT ''active'',
            messages_count INTEGER NOT NULL DEFAULT 0,
            handoff_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ
        )
    ', tenant_slug, tenant_slug);

    -- 2.5 Criar Tabela: messages
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID NOT NULL REFERENCES %I.contacts(id) ON DELETE CASCADE,
            conversation_id UUID REFERENCES %I.ai_conversations(id) ON DELETE SET NULL,
            sender_type TEXT NOT NULL,
            body TEXT,
            media_url TEXT,
            media_type TEXT,
            status TEXT NOT NULL DEFAULT ''received'',
            whatsapp_id TEXT,
            is_deleted BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    ', tenant_slug, tenant_slug, tenant_slug);

END;
$$;

-- 3. Trigger para provisionar automaticamente ao inserir no public.workspaces
CREATE OR REPLACE FUNCTION public.trigger_provision_tenant()
RETURNS TRIGGER AS $$
BEGIN
    -- Chama a função RPC passando o slug do novo cliente
    PERFORM public.create_tenant_schema(NEW.slug);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_workspace_created
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.trigger_provision_tenant();
