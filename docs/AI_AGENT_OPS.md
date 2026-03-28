# Operação do agente de IA (locks, cron, segredos)

## Variáveis de ambiente

- **`INTERNAL_AI_SECRET`** — Obrigatório para rotas internas protegidas com `Authorization: Bearer <segredo>`:
  - `POST /api/ai/schedule` (agendamento após o webhook)
  - `POST /api/ai/process` (processamento direto)
  - `GET` ou `POST /api/ai/followup-cron` (follow-ups automáticos)
  - `GET` ou `POST /api/cron/whatsapp-broadcast-queue` (fila de disparos por template Meta; query opcional `?batch=5&delay_ms=1500`)
- **`NEXT_PUBLIC_SITE_URL`** — URL pública da app (ex. `https://app.exemplo.com`). O [`buffer`](../src/lib/ai-agent/buffer.ts) chama `POST ${NEXT_PUBLIC_SITE_URL}/api/ai/schedule`; em produção tem de apontar para a instância que serve essa rota.
- Chaves do LLM (`GOOGLE_API_KEY` / `OPENAI_API_KEY`) conforme o provider configurado no workspace.
- Meta Cloud API:
  - `META_APP_ID`
  - `META_APP_SECRET`
  - `META_WEBHOOK_VERIFY_TOKEN` (ou `WHATSAPP_WEBHOOK_VERIFY_TOKEN`)
  - opcionais: `META_OAUTH_REDIRECT_URI`, `META_OAUTH_STATE_SECRET`
- Webhook Cloud API (receção de mensagens e estados): `https://<teu-dominio>/api/whatsapp/webhook/official` com o mesmo `META_WEBHOOK_VERIFY_TOKEN` configurado na app Meta.
- Tokens OAuth de longa duração expiram por volta de 60 dias; a coluna `meta_token_obtained_at` em `whatsapp_instances` regista quando o token foi guardado. O separador WhatsApp mostra um aviso após ~50 dias para voltares a correr o fluxo «Conectar Meta Oficial».

## Disparos (templates Meta)

Campanhas e fila: tabelas `public.whatsapp_broadcasts` e `public.whatsapp_broadcast_queue`. A UI está no separador **Disparos** do dashboard. Só funciona com `provider = official` e templates em estado **APPROVED** na WABA.

Sem o cron da fila, os itens ficam em `pending`. Configura o mesmo segredo `INTERNAL_AI_SECRET` num job periódico que chame `GET /api/cron/whatsapp-broadcast-queue`.

## Follow-ups automáticos

Os passos configurados em `ai_followup_steps` só são enviados se um **job externo** invocar periodicamente `/api/ai/followup-cron` com o header `Authorization: Bearer ${INTERNAL_AI_SECRET}` (GET ou POST). Sem esse cron, nenhum follow-up é disparado.

## Lock partilhado (`try_ai_process_lock`)

O processamento principal do agente ([`schedule` → `runAiProcess`](../src/app/api/ai/schedule/route.ts)) e o envio de follow-ups ([`followup-due`](../src/lib/ai-agent/followup-due.ts)) usam a **mesma** função RPC `try_ai_process_lock` na tabela `public.ai_process_locks`, com chave `(workspace_slug, contact_id)`.

**Efeito:** para um dado contacto num workspace, só corre **uma** destas operações de cada vez (evita corridas e duplicados). A outra fica à espera até expirar o TTL do lock ou até ser libertado com `release_ai_process_lock` (tipicamente 45–90 segundos). Na prática, um follow-up pode atrasar-se ligeiramente se o agente estiver a processar a mesma conversa (e vice-versa); isso é intencional.

## Referência rápida de rotas

| Rota | Autenticação |
|------|----------------|
| `/api/ai/schedule` | Bearer `INTERNAL_AI_SECRET` |
| `/api/ai/process` | Bearer `INTERNAL_AI_SECRET` |
| `/api/ai/followup-cron` | Bearer `INTERNAL_AI_SECRET` |
| `/api/cron/whatsapp-broadcast-queue` | Bearer `INTERNAL_AI_SECRET` |

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
