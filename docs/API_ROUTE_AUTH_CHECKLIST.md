# Checklist: novas rotas `route.ts` em `src/app/api`

O middleware de sessão **não** exige utilizador autenticado para pedidos `/api/*`; cada handler é responsável pela sua própria autorização.

Antes de fazer merge de uma rota nova, confirma:

1. **Dados de utilizador final / dashboard / portal**  
   - Usa `createClient()` de [`src/lib/supabase/server.ts`](src/lib/supabase/server.ts).  
   - Chama `getUser()` ou um helper em [`src/lib/auth/workspace-access.ts`](src/lib/auth/workspace-access.ts):  
     - `requireWorkspaceMember` — qualquer membro (inclui role `client`) onde faz sentido.  
     - `requireWorkspaceInternal` — operações do painel (exclui `client`).  
     - `requireWorkspaceRole` — quando precisas de um subconjunto de roles.  
     - `requirePlatformAdmin` — apenas administradores da plataforma.

2. **Jobs internos, webhooks sem sessão, ou automação servidor-a-servidor**  
   - Usa `requireInternalAiSecret` ou `requireInternalBroadcastCronSecret` de [`src/lib/auth/internal.ts`](src/lib/auth/internal.ts) com `Authorization: Bearer …` (`INTERNAL_AI_SECRET`, ou `CRON_SECRET` / `INTERNAL_BROADCAST_SECRET` quando aplicável). Cabeçalhos como `x-vercel-cron` **não** substituem o Bearer. Para outros casos, usa assinatura HMAC, segredo de webhook do fornecedor, etc.

3. **Acesso à base tenant (schemas `"slug"`)**  
   - O `workspace_slug` vem de um parâmetro de URL/query/body **só depois** de validares membership (ou de teres resolvido o tenant por um token seguro).  
   - Usa `quotedSchema` / `assertTenantSlug` de [`src/lib/db/tenant-sql.ts`](src/lib/db/tenant-sql.ts) para interpolar o nome do schema.

4. **Service role / admin**  
   - `createAdminClient()` só onde for inevitável (ex.: webhooks que não têm cookie). Documenta o motivo no PR se não for óbvio.

5. **Nunca** expor em JSON para o browser campos secretos sem passar por sanitização (ex.: [`sanitizeAiConfigForClient`](../src/lib/dashboard/ai-config.ts)).

6. **RLS no Supabase (revisão periódica)**  
   A app valida autorização nas rotas, mas as políticas **Row Level Security** em `public.*` são defesa em profundidade se a `anon` key for exposta ou houver regressões no código. No dashboard Supabase (Authentication → Policies ou SQL), rever pelo menos:
   - `workspaces`, `workspace_members` — só leitura/escrita alinhada com membership e `platform_admins`.
   - `whatsapp_instances` — acesso restrito; campos sensíveis (`instance_token`, tokens Meta) não devem ser legíveis pela role `anon` sem política explícita e segura.
   - `platform_admins` — apenas admins da plataforma.
   - Tabelas de broadcasts/fila, se expostas ao cliente, com políticas por `workspace_slug` / role.

   Confirma que **não** há `GRANT ALL` permissivo a `anon` em tabelas com dados de tenant sem RLS ativo.
