# Chaves LLM por workspace (avaliação e opções)

## Estado atual

- Colunas `openai_api_key` e `google_api_key` em `ai_agent_config` (schema por tenant), em **texto** na base de dados.
- O dashboard nunca envia o valor real ao browser: [`sanitizeAiConfigForClient`](../src/lib/dashboard/ai-config.ts) substitui por flags `openai_api_key_set` / `google_api_key_set`.
- Risco residual: acesso à BD, backups, logs de queries ou dumps incluem segredos em claro.

## Opções (do mais simples ao mais robusto)

| Abordagem | Prós | Contras |
|-----------|------|--------|
| **Só variáveis de ambiente globais** (`OPENAI_API_KEY`, `GOOGLE_API_KEY`) | Nada sensível na BD; rotação centralizada | Um único billing/projeto para todos os workspaces |
| **Encriptação em aplicação (recomendado incremental)** | Continua na BD mas ilegível sem `WORKSPACE_LLM_KEYS_SECRET` no servidor | Chave mestra no runtime; rotação exige re-encriptar ou dual-read |
| **Vault externo** (Doppler, Vault, KMS por tenant) | Isolamento forte, auditoria | Integração e custo maiores |

## O que está implementado

Com a variável de ambiente **`WORKSPACE_LLM_KEYS_SECRET`** (string secreta longa; internamente usa SHA-256 para derivar chave AES-256):

- Ao **guardar** chaves no painel ([`/api/ai/config`](../src/app/api/ai/config/route.ts)), o servidor encripta com AES-256-GCM e prefixo `ac:v1:` ([`workspace-llm-keys.ts`](../src/lib/crypto/workspace-llm-keys.ts)).
- Ao **chamar o LLM** ([`llm-router.ts`](../src/lib/ai-agent/llm-router.ts)), valores `ac:v1:` são desencriptados antes do pedido à API.

Sem `WORKSPACE_LLM_KEYS_SECRET`, o comportamento permanece o de sempre (texto em claro na BD).

### Operação

- **Definir o segredo em produção** antes de confiar em chaves encriptadas; guarda-o no gestor de secrets (Vercel, etc.).
- **Não remover** `WORKSPACE_LLM_KEYS_SECRET` se já existirem linhas `ac:v1:` — o agente deixa de conseguir usar essas chaves até repores o segredo ou reintroduzires chaves em claro (não recomendado).
- **Rotação do segredo mestre:** gera novo segredo, desencripta com o antigo e re-grava no painel, ou script de migração batch; não há rotação automática na app.

### Alternativa futura

Para máxima separação por tenant, considerar referências opacas na BD (`vault_ref`) e resolução no servidor via API do fornecedor de secrets, em vez de colunas com material criptográfico.
