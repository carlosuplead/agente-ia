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
   - Usa `requireInternalAiSecret` ou `requireInternalBroadcastCronSecret` de [`src/lib/auth/internal.ts`](src/lib/auth/internal.ts) com `Authorization: Bearer …`, **ou** outro esquema explícito (assinatura HMAC, segredo de webhook do fornecedor, etc.).

3. **Acesso à base tenant (schemas `"slug"`)**  
   - O `workspace_slug` vem de um parâmetro de URL/query/body **só depois** de validares membership (ou de teres resolvido o tenant por um token seguro).  
   - Usa `quotedSchema` / `assertTenantSlug` de [`src/lib/db/tenant-sql.ts`](src/lib/db/tenant-sql.ts) para interpolar o nome do schema.

4. **Service role / admin**  
   - `createAdminClient()` só onde for inevitável (ex.: webhooks que não têm cookie). Documenta o motivo no PR se não for óbvio.

5. **Nunca** expor em JSON para o browser campos secretos sem passar por sanitização (ex.: [`sanitizeAiConfigForClient`](../src/lib/dashboard/ai-config.ts)).
