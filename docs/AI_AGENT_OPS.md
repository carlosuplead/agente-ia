# Operação do agente de IA (locks, cron, segredos)

## Variáveis de ambiente

- **`INTERNAL_AI_SECRET`** — Obrigatório para rotas internas protegidas com `Authorization: Bearer <segredo>`:
  - `POST /api/ai/schedule` (agendamento após o webhook)
  - `POST /api/ai/process` (processamento direto)
  - `GET` ou `POST /api/ai/followup-cron` (follow-ups automáticos)
- **`CRON_SECRET`** (opcional) — Se definido, o mesmo header `Authorization: Bearer` pode usar este valor em vez de `INTERNAL_AI_SECRET` nas rotas acima. Útil para isolar segredos entre o buffer da app e jobs agendados. **Crons na Vercel (ou outro scheduler) devem enviar sempre o Bearer**; não há bypass por cabeçalho `x-vercel-cron` sozinho.
- **`INTERNAL_BROADCAST_SECRET`** (opcional) — Se definido, `GET`/`POST /api/cron/whatsapp-broadcast-queue` exige **este** Bearer em vez de `INTERNAL_AI_SECRET`, para isolar o job de disparos. Se estiver vazio, o cron de broadcasts continua a usar `INTERNAL_AI_SECRET` (comportamento anterior).
- **`NEXT_PUBLIC_SITE_URL`** — URL pública da app (ex. `https://app.exemplo.com`). O [`buffer`](../src/lib/ai-agent/buffer.ts) chama `POST ${NEXT_PUBLIC_SITE_URL}/api/ai/schedule`; em produção tem de apontar para a instância que serve essa rota.
- Chaves do LLM (`GOOGLE_API_KEY` / `OPENAI_API_KEY`) conforme o provider configurado no workspace, ou chaves por workspace no dashboard.
- **`WORKSPACE_LLM_KEYS_SECRET`** (opcional) — Se definido, as chaves OpenAI/Google guardadas no painel são persistidas encriptadas (AES-256-GCM, prefixo `ac:v1:`). Ver [LLM_API_KEYS_STORAGE.md](./LLM_API_KEYS_STORAGE.md).
- Meta Cloud API:
  - `META_APP_ID`
  - **`META_APP_SECRET`** — Em produção (`NODE_ENV=production` ou deploy na Vercel), o `POST` do webhook oficial **exige** este valor e valida `X-Hub-Signature-256`; sem segredo o servidor responde 500 (misconfiguration). Em desenvolvimento local podes omitir para testar sem assinatura.
  - `META_WEBHOOK_VERIFY_TOKEN` (ou `WHATSAPP_WEBHOOK_VERIFY_TOKEN`)
  - opcionais: `META_OAUTH_REDIRECT_URI`, `META_OAUTH_STATE_SECRET`
- Webhook Cloud API (receção de mensagens e estados): `https://<teu-dominio>/api/whatsapp/webhook/official` com o mesmo `META_WEBHOOK_VERIFY_TOKEN` configurado na app Meta.
- Tokens OAuth de longa duração expiram por volta de 60 dias; a coluna `meta_token_obtained_at` em `whatsapp_instances` regista quando o token foi guardado. O separador WhatsApp mostra um aviso após ~50 dias para voltares a correr o fluxo «Conectar Meta Oficial».

## Disparos (templates Meta)

Campanhas e fila: tabelas `public.whatsapp_broadcasts` e `public.whatsapp_broadcast_queue`. A UI está no separador **Disparos** do dashboard. Só funciona com `provider = official` e templates em estado **APPROVED** na WABA.

Sem o cron da fila, os itens ficam em `pending`. Configura um job periódico com `Authorization: Bearer ${INTERNAL_BROADCAST_SECRET || INTERNAL_AI_SECRET}` a chamar `GET /api/cron/whatsapp-broadcast-queue`.

## Follow-ups automáticos

Os passos configurados em `ai_followup_steps` só são enviados se um **job externo** invocar periodicamente `/api/ai/followup-cron` com `Authorization: Bearer ${INTERNAL_AI_SECRET}` ou, se configuraste, `Bearer ${CRON_SECRET}` (GET ou POST). Sem esse cron, nenhum follow-up é disparado.

## Áudio e outras mídias (transcrição / visão)

- **Onde corre:** ao contrário do CR Pro (transcrição no webhook com URL pública), aqui o webhook **só grava** a mensagem com placeholder (`Áudio enviado`, etc.), `whatsapp_id`, `media_ref` (URL CDN na Uazapi ou **id** de mídia na Meta) e agenda o buffer. O download e a transcrição/análise executam em [`runAiProcess`](../src/lib/ai-agent/run-process.ts) via [`processUnprocessedMedia`](../src/lib/ai-agent/media-processing.ts) **antes** de [`buildContext`](../src/lib/ai-agent/context-builder.ts).
- **Credenciais:** transcrição usa a chave OpenAI do workspace ou `OPENAI_API_KEY`; tenta `gpt-4o-mini-transcribe` e depois `whisper-1` (timeout ~25s por modelo); se falhar, fallback **Gemini** se existir chave Google (workspace ou `GOOGLE_API_KEY`).
- **Limites:** ficheiros até ~10 MB; timeouts de download/processamento definidos em `media-processing.ts`. API oficial: `downloadMediaOfficial` usa `meta_access_token` da instância.
- **Operação:** sem o fluxo buffer → `POST /api/ai/schedule` (e cron, se aplicável), a mídia fica pendente até `runAiProcess` correr. Em logs, procurar prefixos `[media-processing]`, `[downloadMediaUazapi]`, `transcribeAudio`.
- **Validação manual (E2E):** enviar PTT/áudio pela Uazapi e pela Cloud API; confirmar na BD `messages.body` com texto e `media_processed = true`. Sem chaves LLM, o `body` passa a mensagem de fallback amigável e `media_processed` fica definido.

## Lock partilhado (`try_ai_process_lock`)

O processamento principal do agente ([`schedule` → `runAiProcess`](../src/app/api/ai/schedule/route.ts)) e o envio de follow-ups ([`followup-due`](../src/lib/ai-agent/followup-due.ts)) usam a **mesma** função RPC `try_ai_process_lock` na tabela `public.ai_process_locks`, com chave `(workspace_slug, contact_id)`.

**Efeito:** para um dado contacto num workspace, só corre **uma** destas operações de cada vez (evita corridas e duplicados). A outra fica à espera até expirar o TTL do lock ou até ser libertado com `release_ai_process_lock` (tipicamente 45–90 segundos). Na prática, um follow-up pode atrasar-se ligeiramente se o agente estiver a processar a mesma conversa (e vice-versa); isso é intencional.

## Referência rápida de rotas

| Rota | Autenticação |
|------|----------------|
| `/api/ai/schedule` | Bearer `INTERNAL_AI_SECRET` ou `CRON_SECRET` (se definido) |
| `/api/ai/process` | Bearer `INTERNAL_AI_SECRET` ou `CRON_SECRET` (se definido) |
| `/api/ai/followup-cron` | Bearer `INTERNAL_AI_SECRET` ou `CRON_SECRET` (se definido) |
| `/api/cron/whatsapp-broadcast-queue` | Bearer `INTERNAL_BROADCAST_SECRET` se definido; senão `INTERNAL_AI_SECRET` |

## Checklist de segurança (produção)

- **Rotas internas de IA** — `INTERNAL_AI_SECRET` (e opcionalmente `CRON_SECRET`) como strings fortes; rotação se vazarem.
- **Webhook Uazapi** (`/api/whatsapp/webhook`):
  - O URL configurado na Uazapi inclui `?token=<instance_token>` — é um **segredo** com o mesmo poder que o webhook (forjar eventos para esse workspace). **Não** logues URLs completas de pedidos HTTP, traces APM com query string, nem partilhes tickets com o URL cru.
  - **Rotação:** se o token tiver vazado (log, referrer, screenshot), apaga/recria a instância na Uazapi ou atualiza `whatsapp_instances.instance_token` e o webhook na Uazapi.
  - **`WHATSAPP_WEBHOOK_RELAY_URL`** (opcional): se definido, a app configura o webhook da instância para esse relay (ex. n8n) em vez de `NEXT_PUBLIC_SITE_URL/api/whatsapp/webhook?token=…`, reduzindo exposição do URL com token no painel da Uazapi e em alguns proxies; o relay deve validar o pedido e encaminhar só o payload necessário.
- **Meta Cloud API** — Em produção, `META_APP_SECRET` obrigatório para validar `X-Hub-Signature-256` no webhook oficial; `META_WEBHOOK_VERIFY_TOKEN` alinhado com a app Meta.
- **Chaves LLM no painel** — Definir `WORKSPACE_LLM_KEYS_SECRET` para persistir chaves por workspace encriptadas (`ac:v1:`); ver [LLM_API_KEYS_STORAGE.md](./LLM_API_KEYS_STORAGE.md).
- **Webhooks N8N (tools do agente)** — Em produção (`NODE_ENV=production` ou deploy Vercel), só URLs **`https:`** são aceites em [`callN8nWebhook`](../src/lib/ai-agent/n8n-webhook.ts); em desenvolvimento local `http://` continua permitido para n8n em LAN. A validação de host bloqueia RFC1918/metadata; não substitui firewall nem allowlist dedicada se o risco SSRF for crítico.
- **RPC `tenant_exec`** — Usada pelo fallback em [`tenant-sql`](../src/lib/db/tenant-sql.ts) com `SUPABASE_SERVICE_ROLE_KEY`. Garante na Supabase que só o service role invoca esta função e que a função não aceita SQL arbitrário de clientes anónimos.

## Novas rotas API

Checklist de autorização para handlers em `src/app/api`: [API_ROUTE_AUTH_CHECKLIST.md](./API_ROUTE_AUTH_CHECKLIST.md).

## Rollout e rollback do provider oficial (Meta)

Rollout recomendado por workspace:

1. Configurar variáveis Meta no ambiente.
2. Conectar um workspace pelo botão `Conectar Meta Oficial`.
3. Confirmar webhook oficial em `/api/whatsapp/webhook/official`.
4. Validar envio manual e resposta da IA nesse workspace.
5. Repetir para os próximos workspaces.

Rollback rápido por workspace:

1. Reconfigurar o workspace para UAZAPI (`provider = uazapi` em `public.whatsapp_instances`).
2. Manter endpoint oficial ativo, mas sem workspace associado.
3. Validar envio em `/api/whatsapp/send` e retorno do webhook UAZAPI.
