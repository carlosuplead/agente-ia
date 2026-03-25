# n8n, Supabase e schemas por tenant

## Objetivo

Consultar dados de um cliente apenas no seu schema PostgreSQL (ex.: `moreli`) sem `WHERE tenant_id = …` na aplicação.

## Opção recomendada para n8n: Postgres direto

1. Cria um utilizador PostgreSQL com permissões **só de leitura** nos schemas necessários (`moreli`, `diel`, …) ou usa um role por cliente.
2. No n8n, usa o nó **Postgres** com a connection string do projeto Supabase (**Settings → Database**).
3. Nas queries, define `search_path` ou prefixa tabelas: `moreli.messages`, `moreli.contacts`.

Vantagens: controlo fino, sem expor todos os schemas na API REST do Supabase.

## API REST Supabase (`supabase-js` / PostgREST)

- Por defeito só estão expostos `public` (e `graphql_public`). Os schemas por tenant **não** precisam de ser expostos na API para esta app: o servidor Next usa **`DATABASE_URL`** (Postgres direto) para `contacts`, `messages`, `ai_*` em cada schema.
- Se quiseres consultar um tenant via **REST** ou **supabase-js** `.schema()`, adiciona esse schema em **Settings → Data API → Exposed schemas** (ou usa só Postgres no n8n).
- O cliente anónimo/authenticated está sujeito a **RLS**. Para integrações servidor-a-servidor costuma usar-se a **service role** com extremo cuidado (nunca no browser).

## RLS neste projeto

- `public.workspaces`, `public.whatsapp_instances`, `public.workspace_members` e `public.platform_admins` têm políticas para utilizadores autenticados.
- Tabelas em cada schema de tenant (`contacts`, `messages`, `ai_conversations`, `ai_agent_config`) têm políticas que exigem linha em `workspace_members` com o mesmo `workspace_slug` ou utilizador em `platform_admins`.
- O **webhook** WhatsApp usa `SUPABASE_SERVICE_ROLE_KEY` no servidor para escrever mensagens sem passar pelo utilizador final (comportamento intencional).

## Bootstrap de administrador

Após criar o primeiro utilizador em **Authentication**:

```sql
INSERT INTO public.platform_admins (user_id)
VALUES ('UUID_DO_AUTH_USERS');
```

Quem cria um workspace na app fica automaticamente como **owner** em `workspace_members`. Para dar acesso a mais alguém:

```sql
INSERT INTO public.workspace_members (user_id, workspace_slug, role)
VALUES ('UUID', 'moreli', 'member');
```
