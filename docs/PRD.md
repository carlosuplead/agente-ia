# PRD — Plataforma SaaS de IA para WhatsApp (agente-ia)

> Documento vivo. Atualizado a cada ciclo de desenvolvimento.
> Ultima atualização: 2026-04-08

---

## 1. Visão do Produto

Plataforma SaaS multi-tenant que permite a qualquer empresa conectar um número de WhatsApp e ter um agente de IA atendendo clientes automaticamente — com follow-ups, agendamentos, notificações à equipa, e transferência para atendimento humano.

**Proposta de valor:** Transformar o atendimento por WhatsApp em uma máquina autônoma que qualifica leads, responde perguntas, agenda reuniões e escala para humanos quando necessário.

---

## 2. Arquitetura

### Stack
| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 15 (App Router, TypeScript, React 19) |
| Backend | Next.js API Routes (serverless) |
| Banco | Supabase PostgreSQL (multi-tenant por schema) |
| Auth | Supabase Auth (email/senha) |
| WhatsApp | Uazapi (QR Code) + Meta Cloud API (oficial) |
| IA | Google Gemini, OpenAI, Anthropic Claude |
| Voz | ElevenLabs TTS |
| Agenda | Google Calendar API |
| Automação | N8N webhooks |
| Deploy | Vercel (Hobby) |
| Ícones | Lucide React |

### Multi-tenancy
- Cada workspace = 1 schema PostgreSQL isolado
- Tabelas por tenant: `ai_agent_config`, `contacts`, `messages`, `ai_conversations`, `llm_usage`
- Tabelas globais: `workspaces`, `workspace_members`, `platform_admins`, `whatsapp_instances`
- RLS em todas as tabelas tenant

### URLs
| Ambiente | URL |
|----------|-----|
| Produção | https://agente-ia-chi.vercel.app |
| Repositório | https://github.com/carlosuplead/agente-ia |

### Supabase
| Campo | Valor |
|-------|-------|
| Project ref | icvhhohsxkuwtmckmyrv |
| Region | sa-east-1 (São Paulo) |
| DB Host (direto) | db.icvhhohsxkuwtmckmyrv.supabase.co |
| DB Host (pooler) | aws-0-sa-east-1.pooler.supabase.com |

### WhatsApp (Uazapi)
| Campo | Valor |
|-------|-------|
| URL | https://atendsoft.uazapi.com |
| Admin Token | fK5r6UbDNrBO7PJEtEND6JESaTNA4VNAIPULqouc614xEHydnp |
| Webhook URL | https://agente-ia-chi.vercel.app/api/whatsapp/webhook?token={INSTANCE_TOKEN} |

---

## 3. Perfis de Usuário

### Platform Admin (Carlos)
- Acesso total ao painel interno
- Cria/gerencia workspaces
- Aprova novos usuários
- Vê todos os workspaces
- Painel Admin com lista de usuários

### Workspace Owner/Admin
- Configura o agente IA (prompt, modelo, temperatura, etc.)
- Conecta WhatsApp (QR Code ou API oficial)
- Gerencia follow-ups, notificações, calendário
- Convida clientes para o portal
- Vê mensagens e estatísticas

### Portal Client (cliente do workspace)
- Acesso somente ao `/portal`
- Vê estatísticas de uso do agente
- Vê QR Code / status da conexão
- Não vê configuração da IA

---

## 4. Módulos Implementados

### 4.1 Autenticação e Cadastro
- [x] Login com email/senha via Supabase Auth
- [x] Signup cria conta mas requer aprovação do admin
- [x] Tela "Aguardando aprovação" para usuários pendentes
- [x] Admin aprova e cria workspace automaticamente
- [x] Middleware protege rotas (auth, portal-only, admin)

### 4.2 Painel Admin
- [x] Lista de usuários com status (Pendente/Aprovado/Admin)
- [x] Botão "Aprovar" cria workspace + atribui owner
- [x] Gerenciamento de workspaces

### 4.3 Dashboard Interno
- [x] Sidebar com ícones Lucide SVG (LayoutGrid, MessageCircle, Bot, etc.)
- [x] Toggle claro/escuro com localStorage
- [x] Tema BotConversa (light-first, azul #2563eb)
- [x] Mobile responsive (drawer navigation)
- [x] Avatar de iniciais do usuário
- [x] Workspace grid com detalhes expandíveis (ID, slug, SQL)

### 4.4 Conexão WhatsApp
- [x] Uazapi: criar instância, QR Code, pairing code
- [x] Meta Cloud API: OAuth flow, seleção de número
- [x] Status em tempo real (connected/disconnected)
- [x] Webhook auto-configurado na criação da instância
- [x] Webhook handler (`/api/whatsapp/webhook`) com parsing robusto

### 4.5 Agente IA
- [x] Multi-provider: Gemini, OpenAI, Anthropic Claude
- [x] Provider de fallback automático
- [x] System prompt editável
- [x] Temperatura, máx mensagens, contexto configuráveis
- [x] Buffer de debounce (aguarda mensagens adicionais antes de processar)
- [x] Presença (digitando/gravando)
- [x] Rótulos personalizados (equipa/assistente)
- [x] Divisão de resposta em múltiplas mensagens (parágrafo/linha)
- [x] Modo testes (só números permitidos)
- [x] BYOK (chaves API por workspace)
- [x] Greeting message para novos contatos
- [x] Inatividade: nova sessão após X horas sem mensagem

### 4.6 Human Handoff
- [x] Transferência para humano via tool call
- [x] Palavras-chave de handoff configuráveis
- [x] Mensagem padrão de handoff
- [x] Pausa automática da IA quando atendente envia mensagem
- [x] Status `handed_off` na conversa

### 4.7 Follow-up Automático
- [x] Múltiplos passos com delay configurável (minutos/horas/dias)
- [x] Mensagem fixa por passo
- [x] **Prompt customizado para IA gerar follow-up baseado no histórico**
- [x] Fallback para mensagem fixa se IA falhar
- [x] Anchor reset quando cliente responde
- [x] Cron job `/api/ai/followup-cron`
- [x] Distributed locking para evitar duplicatas

### 4.8 Notificações à Equipa
- [x] Tool `notify_team_whatsapp` para o agente notificar a equipa
- [x] Lista de números autorizados
- [x] Descrição de quando notificar (instrução para IA)
- [x] Incluir trecho da conversa (opcional)
- [x] **Template de formato para lead summaries**
- [x] Template injetado automaticamente na tool description

### 4.9 Google Calendar
- [x] OAuth flow para conectar conta Google
- [x] Consultar disponibilidade
- [x] Criar eventos
- [x] Seleção de agenda específica
- [ ] Redirect URI configurado no Google Cloud Console
- [ ] Env vars `GOOGLE_CALENDAR_CLIENT_ID/SECRET` no Vercel

### 4.10 Integração N8N
- [x] Múltiplos webhooks configuráveis
- [x] Cada webhook = tool para o agente
- [x] Timeout configurável
- [x] Descrição personalizada

### 4.11 Voz (ElevenLabs)
- [x] Tool para enviar áudio de voz
- [x] Voice ID e model ID configuráveis
- [x] BYOK ElevenLabs

### 4.12 Disparos (Broadcasts)
- [x] Criar campanhas de disparo
- [x] Templates Meta Cloud API
- [x] Fila de envio com rate limiting
- [x] Estatísticas de entrega
- [x] Importação de contatos CSV

### 4.13 Portal do Cliente
- [x] Estatísticas de uso (mensagens, conversas, tokens)
- [x] Gráfico de atividade diária
- [x] Status da conexão WhatsApp
- [x] QR Code / pairing code
- [x] Seletor de agente

### 4.14 Workspace Settings
- [x] Editar nome do workspace
- [x] Convidar clientes para o portal
- [x] Gerenciar acessos (remover clientes)
- [x] URL do portal compartilhável
- [x] **Detalhes expandíveis (Workspace ID, Schema slug, SQL)**

---

## 5. Pendências e Próximos Passos

### Alta Prioridade
- [ ] Google Calendar: adicionar env vars no Vercel + redirect URI no Google Cloud
- [ ] Validar fluxo completo de follow-up com prompt IA em produção
- [ ] Testar notificação à equipa com template preenchido pela IA

### Melhorias Planejadas
- [ ] Dashboard analytics mais rico (gráficos de conversas, leads, conversão)
- [ ] Histórico de conversas navegável no painel
- [ ] Busca de contatos/conversas
- [ ] Exportar dados (CSV/Excel)
- [ ] Webhook de eventos para integração externa

### Infraestrutura
- [ ] Migrar para Vercel Pro quando necessário (limites do Hobby)
- [ ] Monitoramento/alertas (uptime, erros, latência)
- [ ] Backup automatizado do banco
- [ ] Rate limiting por workspace

---

## 6. Estrutura do Código

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # 37 API routes
│   │   ├── admin/          # Gerenciamento de users/workspaces
│   │   ├── ai/             # Config, processamento, cron, follow-up
│   │   ├── auth/           # Login, signup, OAuth (Google, Meta)
│   │   ├── messages/       # Recent, stats, token usage
│   │   ├── whatsapp/       # Instances, send, webhooks, broadcasts
│   │   ├── workspace/      # Contacts, Google Calendar
│   │   └── workspaces/     # CRUD workspaces, members
│   ├── admin/              # Painel admin (AdminPanel)
│   ├── login/              # Página de login
│   ├── portal/             # Portal do cliente
│   └── signup/             # Página de cadastro
├── components/
│   ├── client-portal/      # ClientPortalApp
│   └── dashboard/          # 14 componentes do painel
├── lib/
│   ├── ai-agent/           # 17 módulos (LLM, tools, follow-up, etc.)
│   ├── auth/               # Acesso, admin, redirects
│   ├── dashboard/          # State, types, validação
│   ├── db/                 # Tenant SQL helpers
│   ├── google/             # Calendar OAuth + client
│   ├── meta/               # Meta Graph API, OAuth, templates
│   ├── supabase/           # Client, server, middleware
│   └── whatsapp/           # Providers (Uazapi, Official), factory
└── middleware.ts            # Auth gatekeeper + route protection
```

---

## 7. Convenções

- **Linguagem do código:** Inglês (variáveis, funções, tipos)
- **Linguagem da UI:** Português (Brasil/Portugal mix)
- **CSS:** Custom properties, light-first, BotConversa-inspired
- **Estado:** React hooks + context (sem Redux/Zustand)
- **Ícones:** Lucide React (jamais emojis)
- **Commits:** Português, formato `tipo: descrição`
- **Banco:** Multi-tenant por schema, RLS obrigatório
