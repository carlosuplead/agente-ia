# Operação do agente de IA (locks, cron, segredos)

## Variáveis de ambiente

- **`INTERNAL_AI_SECRET`** — Obrigatório para rotas internas protegidas com `Authorization: Bearer <segredo>`:
  - `POST /api/ai/schedule` (agendamento após o webhook)
  - `POST /api/ai/process` (processamento direto)
  - `GET` ou `POST /api/ai/followup-cron` (follow-ups automáticos)
- **`NEXT_PUBLIC_SITE_URL`** — URL pública da app (ex. `https://app.exemplo.com`). O [`buffer`](../src/lib/ai-agent/buffer.ts) chama `POST ${NEXT_PUBLIC_SITE_URL}/api/ai/schedule`; em produção tem de apontar para a instância que serve essa rota.
- Chaves do LLM (`GOOGLE_API_KEY` / `OPENAI_API_KEY`) conforme o provider configurado no workspace.

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
