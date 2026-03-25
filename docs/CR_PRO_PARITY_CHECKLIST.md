# Checklist de paridade CR Pro → Agente Central

Use esta lista ao comparar com o código ou o comportamento do **CR Pro** original. Marca cada item quando confirmares no teu ambiente.

## Webhook Uazapi

- [ ] Variantes de payload: `EventType`, `event`, campos `message` / `chat` ausentes ou aninhados
- [ ] `wasSentByApi`, `fromMe`, mensagens duplicadas (`whatsapp_id`)
- [ ] Grupos ignorados; números Brasil (`normalizePhoneForBrazil`, variantes de 9 dígitos)
- [ ] Respostas a botões/listas (`buttonOrListid`, `buttonReply`)
- [ ] Mídia sem texto: corpo fallback “Mídia enviada” e eventual inclusão de URL/caption no contexto da IA
- [ ] Eventos de ligação (`connection`, `status`, `phone` / `owner`)

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
- [ ] Filas ou workers adicionais no CR Pro (substituídos aqui por `after()` + locks em SQL)

Quando tiveres acesso ao repositório CR Pro, cruza cada ficheiro de webhook, router LLM e cliente Uazapi com os caminhos equivalentes em `src/app/api/whatsapp/` e `src/lib/ai-agent/`.
