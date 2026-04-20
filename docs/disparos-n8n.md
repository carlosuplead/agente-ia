# Disparos via n8n

**Objectivo:** mover o envio de campanhas WhatsApp (disparos) do worker directo
da plataforma para um fluxo n8n único e partilhado por todos os workspaces.

## Arquitectura

```
┌─── Plataforma ────────────────────────────┐     ┌─── n8n ───────────────────┐
│                                            │     │                            │
│  [whatsapp_broadcasts] + [queue]           │     │  [Webhook Trigger]         │
│           ↓                                │     │         ↓                  │
│  /api/cron/whatsapp-broadcast-queue        │     │  [Code: valida HMAC]       │
│     └── se N8N_DISPATCH_ENABLED=true:      │     │         ↓                  │
│           dispatchBatchToN8n()             │     │  [Responde 202 ao cliente] │
│                ↓                           │     │         ↓                  │
│          POST payload assinado ────────────┼────►│  [Loop Over Items]         │
│                                            │     │         ↓                  │
│                                            │     │  [IF: provider=official]   │
│                                            │     │         ↓                  │
│                                            │     │  [HTTP: Meta Cloud send]   │
│                                            │     │         ↓                  │
│  /api/n8n/broadcast-callback  ◄────────────┼─────┤  [Code: build+sign]        │
│  (HMAC valida, update queue)               │     │         ↓                  │
│                                            │     │  [HTTP: callback platform] │
└────────────────────────────────────────────┘     └────────────────────────────┘
```

**Uma instalação n8n — um fluxo — todos os workspaces.** Credenciais, template
e telefone do contacto vêm no payload de cada dispatch (passados pela plataforma
a partir do schema do workspace). Zero hardcode no n8n.

## Variáveis de ambiente (plataforma)

Adicionar ao `.env` local e à Vercel (ou wherever o agente-ia estiver deployed):

```
N8N_DISPATCH_ENABLED=true
N8N_WEBHOOK_URL=https://n8nsecundario.adventurecriative.com.br/webhook/agente-ia-disparos
N8N_WEBHOOK_SECRET=<string aleatória, 32+ bytes>
N8N_CALLBACK_BASE_URL=https://agente-ia-chi.vercel.app
```

Gerar o segredo (qualquer shell):

```
openssl rand -hex 32
# ou Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Guardar este mesmo valor **também** no n8n (passo a seguir).

## Instalação no n8n

1. **Importa o fluxo**: n8n → **Workflows** → `+` → **Import from File** →
   selecciona `docs/n8n-broadcast-flow.json`.

2. **Configura o segredo partilhado**:
   - n8n → **Settings** → **Variables** → `+ Variable`
   - Nome: `SHARED_SECRET`
   - Valor: o mesmo que puseste em `N8N_WEBHOOK_SECRET` no agente-ia.

3. **Activa o fluxo** (toggle `Active` no topo direito). A URL fica fixada em
   `https://<teu-n8n>/webhook/agente-ia-disparos`.

4. **Testa com curl** (do teu computador):

   ```bash
   BODY='{"dispatch_id":"test","platform_version":"local","items":[],"callback":{"url":"https://example.com","signature_header":"X-Broadcast-Signature"}}'
   SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "<SHARED_SECRET>" -hex | awk '{print $2}')
   curl -X POST https://n8nsecundario.adventurecriative.com.br/webhook/agente-ia-disparos \
     -H "Content-Type: application/json" \
     -H "X-Platform-Signature: $SIG" \
     -d "$BODY"
   ```

   Esperado: `HTTP 202 { "ok": true, "accepted": true }` (items vazio, não há nada a processar).

   Se enviares assinatura errada: `HTTP 401 { "error": "Invalid signature" }`.

## Como trigar o cron do dispatcher

O endpoint `/api/cron/whatsapp-broadcast-queue` continua a ser o ponto de entrada.
Com `N8N_DISPATCH_ENABLED=true`, ele delega a quem o chama. Podes triggá-lo por:

**Opção A: n8n agenda o cron (uma instalação, zero Vercel cron)**

Cria um segundo workflow simples no n8n:

```
[Schedule Trigger: cron "*/1 * * * *"]
   ↓
[HTTP Request: GET https://agente-ia-chi.vercel.app/api/cron/whatsapp-broadcast-queue?batch=10]
  Header Authorization: Bearer <INTERNAL_BROADCAST_SECRET ou INTERNAL_AI_SECRET>
```

**Opção B: Vercel cron** — adiciona a `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/whatsapp-broadcast-queue?batch=10", "schedule": "*/1 * * * *" }
  ]
}
```

**Opção C: cron-job.org** ou qualquer pinger externo com header `Authorization: Bearer <secret>`.

## Fluxo de estados da queue (inalterado)

```
 pending ──claim──► sending ──callback: sent──► sent        ✅
                         └─── callback: failed ──► pending (retry, next_attempt_at)
                                                   └───► failed (depois de 5 tentativas)
```

Quando todos os items do broadcast estão em `sent`/`failed`, a plataforma promove
o broadcast para `completed` (ou `failed` se 0 sent).

## Payloads

**Dispatch (plataforma → n8n)** — `POST N8N_WEBHOOK_URL`:

```json
{
  "dispatch_id": "uuid",
  "platform_version": "abc1234",
  "items": [
    {
      "queue_item_id": "uuid",
      "broadcast_id": "uuid",
      "workspace_slug": "joia-xyz",
      "contact_id": "uuid",
      "phone_e164_digits": "5521983916777",
      "provider": "official",
      "credentials": {
        "meta_phone_number_id": "1071...",
        "meta_access_token": "EAA..."
      },
      "message": {
        "kind": "template",
        "template_name": "v3",
        "template_language": "pt_BR",
        "template_components": []
      }
    }
  ],
  "callback": {
    "url": "https://agente-ia-chi.vercel.app/api/n8n/broadcast-callback",
    "signature_header": "X-Broadcast-Signature"
  }
}
```

Header: `X-Platform-Signature: <HMAC_SHA256(body, N8N_WEBHOOK_SECRET)>`.

**Callback (n8n → plataforma, 1x por item)** — `POST /api/n8n/broadcast-callback`:

```json
{
  "queue_item_id": "uuid",
  "dispatch_id": "uuid",
  "status": "sent",
  "whatsapp_message_id": "wamid.HB...",
  "error": null
}
```

ou em caso de falha:

```json
{
  "queue_item_id": "uuid",
  "dispatch_id": "uuid",
  "status": "failed",
  "whatsapp_message_id": null,
  "error": "descrição curta"
}
```

Header: `X-Broadcast-Signature: <HMAC_SHA256(body, N8N_WEBHOOK_SECRET)>`.

## Rollback de emergência

Se o fluxo n8n cair, basta `N8N_DISPATCH_ENABLED=false` (ou tirar a var) e fazer
re-deploy. O cron volta a usar o `broadcast-worker.ts` original, sem intervenção
em BD. Items que estavam em `sending` são reconciliados para `pending` após 5 min.

## Segurança

- **HMAC em ambas as direcções.** Nem plataforma nem n8n aceitam requests sem
  assinatura válida.
- **Credenciais sempre no payload, nunca persistidas no n8n.** Cada workspace
  traz a sua. Zero mistura.
- **Timeout de 20s no POST ao n8n**: se o n8n estiver em baixo, os items
  voltam a `pending` e tentam no próximo cron.
- **Idempotência do callback**: se o n8n fizer retry de um callback já processado,
  a plataforma responde 200 sem duplicar contadores.
