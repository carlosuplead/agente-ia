# Checklist de paridade CR Pro → Agente Central

Use esta lista ao comparar com o código ou o comportamento do **CR Pro** original. Marca cada item quando confirmares no teu ambiente.

## Webhook Uazapi

- [ ] Variantes de payload: `EventType`, `event`, campos `message` / `chat` ausentes ou aninhados
- [ ] `wasSentByApi`, `fromMe`, mensagens duplicadas (`whatsapp_id`)
- [ ] Grupos ignorados; números Brasil (`normalizePhoneForBrazil`, variantes de 9 dígitos)
- [ ] Respostas a botões/listas (`buttonOrListid`, `buttonReply`)
- [ ] Mídia sem texto: corpo fallback “Mídia enviada” e eventual inclusão de URL/caption no contexto da IA
- [ ] Eventos de ligação (`connection`, `status`, `phone` / `owner`)

## Meta Cloud API (official)

- [x] OAuth start/callback com descoberta de `phone_number_id`
- [x] Webhook verify token (`hub.challenge`) e assinatura `x-hub-signature-256`
- [x] Deduplicação por `whatsapp_id`
- [x] Atualização de status (`sent`, `delivered`, `read`, `failed`)
- [x] Entrada Meta -> buffer IA -> resposta enviada
- [x] `meta_token_obtained_at` ao guardar token (OAuth / complete-pick / configure-official) + aviso no dashboard (>50 dias)
- [x] Listagem de templates (`GET /api/whatsapp/meta/templates`) e validação APPROVED ao criar campanha
- [x] Envio em massa só via API oficial: fila `whatsapp_broadcast_queue` + `GET /api/cron/whatsapp-broadcast-queue` (Bearer `INTERNAL_AI_SECRET`)

## Envio / API Uazapi

- [ ] `sendTextMessage`: formato de `number`, `delay`, `presence`
- [ ] Erros HTTP e retry (429, 5xx)
- [ ] Mensagens com mídia (se o CR Pro suportava)

## IA

- [ ] Modelos e temperatura por tenant
- [ ] Limite de mensagens por conversa + handoff
- [ ] Ferramenta / intenção “transferir humano” e texto de confirmação
- [ ] Contexto: quantas mensagens, ordem, etiquetas de remetente (contacto vs assistente vs IA)
- [ ] Streaming (se existia no CR Pro)

## Dados / multi-tenant

- [ ] Campos extra em `contacts` ou `messages` no CRM antigo que devam ser migrados
- [ ] Estados de conversa além de `active` / `handed_off`
- [ ] Métricas, logs ou auditoria que o produto novo ainda não grava

## Operação

- [ ] URL de webhook configurada na Uazapi por instância
- [ ] Rotação de `instance_token`
- [ ] Filas ou workers adicionais no CR Pro (campanhas UAZAPI no CR Pro; aqui disparos Meta usam cron da fila + locks em SQL no processamento IA)
- [ ] Rollback por workspace: `provider=official` -> `provider=uazapi` sem downtime

Quando tiveres acesso ao repositório CR Pro, cruza cada ficheiro de webhook, router LLM e cliente Uazapi com os caminhos equivalentes em `src/app/api/whatsapp/` e `src/lib/ai-agent/`.
