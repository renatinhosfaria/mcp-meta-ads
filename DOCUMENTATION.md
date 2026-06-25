# Meta Ads MCP Server — Documentacao Completa

**Versao:** 1.0.0
**Descricao:** Servidor MCP (Model Context Protocol) para gerenciamento completo de anuncios na plataforma Meta (Facebook/Instagram) via Ads Manager.

---

## Sumario

1. [Introducao](#1-introducao)
2. [O que e o MCP (Model Context Protocol)](#2-o-que-e-o-mcp-model-context-protocol)
3. [Arquitetura do Sistema](#3-arquitetura-do-sistema)
4. [Instalacao e Configuracao](#4-instalacao-e-configuracao)
5. [Autenticacao e Seguranca](#5-autenticacao-e-seguranca)
6. [Endpoints HTTP](#6-endpoints-http)
7. [Referencia Completa de Tools](#7-referencia-completa-de-tools)
   - 7.1 [Contas de Anuncio](#71-contas-de-anuncio-2-tools)
   - 7.2 [Campanhas](#72-campanhas-5-tools)
   - 7.3 [Conjuntos de Anuncios (Ad Sets)](#73-conjuntos-de-anuncios-ad-sets-5-tools)
   - 7.4 [Anuncios (Ads)](#74-anuncios-ads-5-tools)
   - 7.5 [Insights e Metricas](#75-insights-e-metricas-3-tools)
8. [Cliente da API Meta](#8-cliente-da-api-meta)
9. [Tipos TypeScript](#9-tipos-typescript)
10. [Constantes e Enums](#10-constantes-e-enums)
11. [Middleware](#11-middleware)
12. [Deploy com Docker](#12-deploy-com-docker)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Introducao

O **Meta Ads MCP Server** e uma implementacao do protocolo MCP que permite que assistentes de IA (como Claude, ChatGPT, ou qualquer cliente MCP compativel) gerenciem campanhas de anuncios na plataforma Meta (Facebook e Instagram) de forma programatica.

### O que este servidor faz

- **Gerenciamento completo de campanhas**: criar, listar, visualizar, atualizar, pausar, ativar e deletar campanhas
- **Gerenciamento de conjuntos de anuncios (Ad Sets)**: configurar segmentacao de publico, orcamentos, lances e datas
- **Gerenciamento de anuncios (Ads)**: criar anuncios com criativos, monitorar status de revisao e problemas
- **Metricas e insights**: consultar gastos, impressoes, cliques, CTR, CPM, CPC, frequencia, alcance e conversoes
- **Gestao de contas**: listar e inspecionar contas de anuncio com dados financeiros

### Capacidades em numeros

| Recurso | Quantidade |
|---------|-----------|
| Tools disponiveis | 51 |
| Dominos cobertos | 12 (Contas, Campanhas, Ad Sets, Ads, Insights, Ad Library, Audiences, Assets, Creatives, Lead Forms, Previews, Conversions) |
| Versao Graph API | v21.0 (configuravel ate v25.0) |
| Paginacao automatica | Ate 500 itens por consulta |

---

## 2. O que e o MCP (Model Context Protocol)

O **Model Context Protocol (MCP)** e um protocolo aberto criado pela Anthropic que padroniza a forma como aplicacoes de IA se conectam a fontes de dados e servicos externos. Ele funciona como uma "ponte universal" entre modelos de linguagem e o mundo externo.

### Conceitos fundamentais

| Conceito | Descricao |
|----------|-----------|
| **MCP Server** | Aplicacao que expoe funcionalidades (tools) para clientes MCP. Este projeto e um MCP Server. |
| **MCP Client** | Aplicacao que se conecta a um MCP Server para usar suas tools. Ex: Claude Desktop, Claude Code, IDEs com suporte a MCP. |
| **Tools** | Funcoes que o servidor expoe e que o cliente pode invocar. Cada tool tem nome, descricao, parametros tipados e retorno estruturado. |
| **Transport** | Mecanismo de comunicacao. Este servidor usa HTTP + Server-Sent Events (SSE) via `StreamableHTTPServerTransport`. |
| **Session** | Conexao stateful entre cliente e servidor, identificada por UUID. |

### Como funciona o fluxo

```
Cliente MCP (Claude, IDE, etc.)
        |
        | 1. POST /mcp (initialize request)
        v
Meta Ads MCP Server
        |
        | 2. Cria sessao (UUID)
        | 3. Retorna session ID
        v
Cliente envia tool calls com session ID
        |
        | 4. POST /mcp + header mcp-session-id
        v
Servidor executa tool -> chama Meta Graph API -> retorna resultado
```

### Por que usar MCP?

- **Padronizacao**: Um unico protocolo para conectar qualquer IA a qualquer servico
- **Seguranca**: Autenticacao, rate limiting e validacao de entrada em cada chamada
- **Tipagem**: Schemas Zod garantem que os parametros sejam validos antes da execucao
- **Contexto**: O modelo de IA recebe descricoes detalhadas de cada tool, permitindo uso inteligente
- **Extensibilidade**: Novas tools podem ser adicionadas sem alterar clientes existentes

---

## 3. Arquitetura do Sistema

### Stack tecnologica

| Tecnologia | Versao | Funcao |
|-----------|--------|--------|
| **TypeScript** | 5.7.2 | Linguagem principal |
| **Node.js** | >= 18 | Runtime |
| **Express** | 4.21.2 | Servidor HTTP |
| **@modelcontextprotocol/sdk** | 1.6.1 | SDK oficial do MCP |
| **Axios** | 1.7.9 | Cliente HTTP para Meta API |
| **Zod** | 3.23.8 | Validacao de schemas |
| **Helmet** | 8.1.0 | Headers de seguranca HTTP |
| **express-rate-limit** | 7.5.0 | Rate limiting |
| **dotenv** | 16.4.5 | Variaveis de ambiente |

### Diagrama de arquitetura

```
                    +------------------+
                    |  Cliente MCP     |
                    |  (Claude, IDE)   |
                    +--------+---------+
                             |
                    HTTPS (Bearer Token)
                             |
                    +--------v---------+
                    |     Express      |
                    |  +-----------+   |
                    |  | Helmet    |   |
                    |  | Logger    |   |
                    |  | RateLimit |   |
                    |  | Auth      |   |
                    |  +-----------+   |
                    +--------+---------+
                             |
                    +--------v---------+
                    |   MCP Server     |
                    |  (McpServer)     |
                    |                  |
                    |  +-----------+   |
                    |  | Accounts  |   |
                    |  | Campaigns |   |
                    |  | Ad Sets   |   |
                    |  | Ads       |   |
                    |  | Insights  |   |
                    |  +-----------+   |
                    +--------+---------+
                             |
                         Axios + REST
                             |
                    +--------v---------+
                    |  Meta Graph API  |
                    |  (v21.0/v25.0)   |
                    +------------------+
```

### Estrutura de diretorios

```
meta-ads-mcp-server/
|-- src/
|   |-- index.ts              # Entry point: Express server, rotas HTTP, sessoes MCP
|   |-- server.ts             # Criacao do McpServer e registro de todas as tools
|   |-- auth.ts               # Middleware de autenticacao Bearer token
|   |-- client.ts             # Cliente Meta API: requests, paginacao, erros
|   |-- config.ts             # Carregamento de variaveis de ambiente
|   |-- constants.ts          # Campos da API, enums, limites
|   |-- types.ts              # Interfaces TypeScript para todas as entidades
|   |-- tools/
|   |   |-- accounts.ts       # Tools: meta_list_ad_accounts, meta_get_ad_account
|   |   |-- campaigns.ts      # Tools: list, get, create, update, delete campaigns
|   |   |-- adsets.ts         # Tools: list, get, create, update, delete ad sets
|   |   |-- ads.ts            # Tools: list, get, create, update, delete ads
|   |   |-- insights.ts       # Tools: get_insights, account_insights, campaign_insights
|   |   |-- ad-library.ts     # Tools: pesquisa publica na Ad Library
|   |   |-- audiences.ts      # Tools: custom audiences, lookalikes e memberships
|   |   |-- assets.ts         # Tools: upload e consulta de imagens/videos
|   |   |-- creatives.ts      # Tools: gestao de criativos separados
|   |   |-- lead-forms.ts     # Tools: formularios nativos e retrieval de leads
|   |   |-- previews.ts       # Tools: preview HTML de anuncios e criativos
|   |   |-- conversions.ts    # Tools: envio e validacao de eventos CAPI
|   |-- middleware/
|       |-- rate-limit.ts     # Rate limiter configuravel
|       |-- logger.ts         # Log de requisicoes com duracao
|       |-- error-handler.ts  # Handler global de erros
|-- dist/                     # JavaScript compilado (output do tsc)
|-- package.json
|-- tsconfig.json
|-- Dockerfile                # Build multi-stage para producao
|-- docker-compose.yml        # Deploy com Docker Swarm + Traefik
|-- .env                      # Credenciais (nao versionar)
|-- .env.example              # Template de configuracao
```

---

## 4. Instalacao e Configuracao

### Pre-requisitos

- **Node.js** >= 18
- **npm** (incluido com Node.js)
- **Conta Meta Developer** com app registrado
- **Token de acesso** com permissoes adequadas

### Instalacao local

```bash
# Clonar o repositorio
cd meta-ads-mcp-server

# Instalar dependencias
npm install

# Copiar e configurar variaveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais

# Build do TypeScript
npm run build

# Iniciar servidor
npm start
```

### Modo desenvolvimento (hot reload)

```bash
npm run dev
```

Usa `tsx watch` para recompilar automaticamente a cada alteracao.

### Variaveis de ambiente

| Variavel | Obrigatoria | Padrao | Descricao |
|----------|-------------|--------|-----------|
| `PORT` | Nao | `3200` | Porta do servidor HTTP |
| `API_KEY` | **Sim** | — | Chave de autenticacao Bearer para acessar o MCP. Gere com: `openssl rand -hex 32` |
| `RATE_LIMIT_RPM` | Nao | `60` | Limite de requisicoes por minuto |
| `META_ACCESS_TOKEN` | **Sim** | — | Token de acesso da Meta API (System User Token recomendado para producao) |
| `META_AD_ACCOUNT_ID` | **Sim** | — | ID da conta de anuncio padrao (formato: `act_XXXXXXXXXX`) |
| `META_APP_ID` | Nao | — | ID do app no Meta Developers |
| `META_APP_SECRET` | Nao | — | Secret do app no Meta Developers |
| `META_API_VERSION` | Nao | `v21.0` | Versao da Graph API (ex: `v21.0`, `v25.0`) |
| `META_BUSINESS_ID` | Nao | — | ID do Business Manager (para listar contas vinculadas) |

### Exemplo de .env

```env
PORT=3200
API_KEY=<generated-with-openssl-rand-hex-32>
RATE_LIMIT_RPM=60

META_ACCESS_TOKEN=<META_SYSTEM_USER_TOKEN>
META_AD_ACCOUNT_ID=act_24036721645944375
META_API_VERSION=v25.0
META_BUSINESS_ID=1190286072868410
```

### Obtendo credenciais da Meta

1. Acesse [Meta for Developers](https://developers.facebook.com/apps/) e crie um app
2. No **Business Manager** > **Configuracoes** > **Usuarios do Sistema**, crie um System User
3. Gere um **System User Token** com as permissoes:
   - `ads_management`
   - `ads_read`
   - `business_management`
   - `read_insights`
4. Em **Configuracoes** > **Contas de Anuncio**, copie o ID da conta (formato `act_XXXXXXXX`)
5. O **Business ID** esta em **Configuracoes do Business** > **Informacoes do Negocio**

---

## 5. Autenticacao e Seguranca

### Autenticacao Bearer Token

Todas as requisicoes ao MCP (exceto `/health`) exigem um header de autorizacao:

```
Authorization: Bearer <API_KEY>
```

O middleware de autenticacao (`src/auth.ts`) valida:
1. Presenca do header `Authorization`
2. Formato `Bearer <token>`
3. Token corresponde ao `API_KEY` configurado no `.env`

**Respostas de erro:**
- `401 Unauthorized`: Header ausente ou formato invalido
- `403 Forbidden`: Token invalido

### Camadas de seguranca

| Camada | Implementacao | Descricao |
|--------|--------------|-----------|
| **Autenticacao** | Bearer Token via `auth.ts` | Toda requisicao MCP precisa do token |
| **Rate Limiting** | `express-rate-limit` | 60 req/min por padrao (configuravel) |
| **Headers HTTP** | `helmet` | Headers de seguranca (CSP, HSTS, X-Frame-Options, etc.) |
| **Validacao de entrada** | `zod` schemas | Todos os parametros das tools sao validados antes da execucao |
| **Isolamento** | Docker non-root | Container roda como usuario `node`, nao como root |
| **HTTPS** | Traefik + Let's Encrypt | TLS automatico em producao via reverse proxy |

---

## 6. Endpoints HTTP

O servidor expoe 4 endpoints:

### GET /health

Health check para monitoramento. **Nao requer autenticacao nem rate limiting.**

```bash
curl http://localhost:3200/health
```

**Resposta:**
```json
{
  "status": "healthy",
  "service": "meta-ads-mcp-server",
  "version": "1.0.0",
  "timestamp": "2025-03-18T12:00:00.000Z"
}
```

### POST /mcp

Endpoint principal para requisicoes MCP. Usado para:
- **Inicializar sessao**: Enviar um `initialize` request (sem `mcp-session-id`)
- **Chamar tools**: Enviar `tools/call` requests (com `mcp-session-id`)

```bash
# Inicializar sessao
curl -X POST http://localhost:3200/mcp \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{}},"id":1}'
```

### GET /mcp

Stream SSE (Server-Sent Events) para receber notificacoes do servidor. Requer header `mcp-session-id`.

### DELETE /mcp

Encerra uma sessao MCP. Requer header `mcp-session-id`.

### Gerenciamento de sessoes

- Cada `initialize` request cria uma nova sessao com UUID unico
- Sessoes sao armazenadas em memoria (Map)
- O cliente deve enviar o `mcp-session-id` em todas as requisicoes subsequentes
- Ao encerrar via DELETE, a sessao e removida da memoria
- O servidor cria uma instancia MCP independente por sessao

---

## 7. Referencia Completa de Tools

O servidor expoe **51 tools** organizadas em 12 dominios. Cada tool possui:
- **Titulo**: Nome legivel
- **Descricao**: Explicacao detalhada do que faz e quando usar
- **Parametros**: Validados com Zod (tipo, obrigatoriedade, limites, valores validos)
- **Retorno**: JSON estruturado com dados ou mensagem de erro
- **Annotations**: Indicadores de comportamento (readOnly, destructive, idempotent)

---

### 7.1 Contas de Anuncio (2 tools)

#### `meta_list_ad_accounts`

Lista todas as contas de anuncio acessiveis pelo token configurado.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `business_id` | string | Nao | `META_BUSINESS_ID` do .env | ID do Business Manager. Se omitido, usa o env ou lista via `/me/adaccounts` |
| `limit` | number | Nao | 50 | Maximo de contas (1-500) |

**Retorno:**
```json
{
  "total": 3,
  "accounts": [
    {
      "id": "act_123456789",
      "name": "Minha Conta de Anuncios",
      "account_id": "123456789",
      "status": "ACTIVE",
      "currency": "BRL",
      "timezone": "America/Sao_Paulo",
      "amount_spent": "15430.50 BRL",
      "balance": "500.00 BRL",
      "spend_cap": "50000.00 BRL",
      "business": "Minha Empresa"
    }
  ]
}
```

**Status possiveis da conta:**

| Codigo | Label |
|--------|-------|
| 1 | ACTIVE |
| 2 | DISABLED |
| 3 | UNSETTLED |
| 7 | PENDING_RISK_REVIEW |
| 8 | PENDING_SETTLEMENT |
| 9 | IN_GRACE_PERIOD |
| 100 | PENDING_CLOSURE |
| 101 | CLOSED |
| 201 | ANY_ACTIVE |
| 202 | ANY_CLOSED |

---

#### `meta_get_ad_account`

Retorna detalhes completos de uma conta de anuncio especifica.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `ad_account_id` | string | Nao | `META_AD_ACCOUNT_ID` do .env | ID da conta (com ou sem prefixo `act_`) |

**Retorno:**
```json
{
  "id": "act_123456789",
  "name": "Minha Conta",
  "account_id": "123456789",
  "status": "ACTIVE",
  "status_code": 1,
  "currency": "BRL",
  "timezone": "America/Sao_Paulo",
  "amount_spent": "15430.50 BRL",
  "balance": "500.00 BRL",
  "spend_cap": "50000.00 BRL",
  "business": {
    "id": "1190286072868410",
    "name": "Minha Empresa Ltda"
  }
}
```

---

### 7.2 Campanhas (5 tools)

#### `meta_list_campaigns`

Lista todas as campanhas de uma conta de anuncio.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `ad_account_id` | string | Nao | `META_AD_ACCOUNT_ID` | ID da conta |
| `status_filter` | string[] | Nao | Todas | Filtrar por status: `ACTIVE`, `PAUSED`, `ARCHIVED` |
| `limit` | number | Nao | 50 | Maximo de campanhas (1-500) |

**Retorno:**
```json
{
  "total": 5,
  "ad_account_id": "act_123456789",
  "campaigns": [
    {
      "id": "120210000000000001",
      "name": "Campanha de Leads - SP",
      "status": "ACTIVE",
      "effective_status": "ACTIVE",
      "objective": "OUTCOME_LEADS",
      "daily_budget": "50.00",
      "lifetime_budget": null,
      "budget_remaining": "35.00",
      "spend_cap": null,
      "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
      "buying_type": "AUCTION",
      "start_time": "2025-03-01T00:00:00-0300",
      "stop_time": null,
      "special_ad_categories": ["NONE"],
      "created_time": "2025-02-28T15:30:00-0300",
      "updated_time": "2025-03-18T10:00:00-0300"
    }
  ]
}
```

---

#### `meta_get_campaign`

Retorna detalhes completos de uma campanha especifica.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Descricao |
|------|------|-------------|-----------|
| `campaign_id` | string | **Sim** | ID da campanha |

**Retorno:** Mesmo formato de um item do array `campaigns` acima.

---

#### `meta_create_campaign`

Cria uma nova campanha no Ads Manager.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Escrita |
| **Idempotente** | Nao |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `ad_account_id` | string | Nao | `META_AD_ACCOUNT_ID` | ID da conta |
| `name` | string | **Sim** | — | Nome da campanha (1-400 caracteres) |
| `objective` | enum | **Sim** | — | Objetivo (ver tabela abaixo) |
| `status` | enum | Nao | `PAUSED` | `ACTIVE` ou `PAUSED` |
| `special_ad_categories` | string[] | Nao | `["NONE"]` | Categorias especiais (ver tabela abaixo) |
| `daily_budget` | number | Nao | — | Orcamento diario em **centavos** (min: 100 = R$1,00). Mutuamente exclusivo com `lifetime_budget` |
| `lifetime_budget` | number | Nao | — | Orcamento total em **centavos**. Mutuamente exclusivo com `daily_budget` |
| `spend_cap` | number | Nao | — | Limite maximo de gasto em centavos |
| `start_time` | string | Nao | — | Inicio em ISO 8601 (ex: `2025-04-01T00:00:00-03:00`) |
| `stop_time` | string | Nao | — | Termino em ISO 8601. **Obrigatorio se usar `lifetime_budget`** |
| `bid_strategy` | enum | Nao | — | Estrategia de lance (ver tabela abaixo) |
| `is_adset_budget_sharing_enabled` | boolean | Nao | `false` | Campo exigido pela Meta API v25.0 para explicitar budget sharing em nivel de campanha |
| `validate_only` | boolean | Nao | `false` | Se `true`, valida sem criar |

**Objetivos disponiveis:**

| Valor | Descricao |
|-------|-----------|
| `OUTCOME_AWARENESS` | Reconhecimento de marca |
| `OUTCOME_ENGAGEMENT` | Engajamento |
| `OUTCOME_LEADS` | Geracao de leads |
| `OUTCOME_SALES` | Vendas/conversoes |
| `OUTCOME_TRAFFIC` | Trafego para site/app |
| `OUTCOME_APP_PROMOTION` | Promocao de app |

**Categorias especiais:**

| Valor | Descricao |
|-------|-----------|
| `NONE` | Sem categoria especial |
| `EMPLOYMENT` | Emprego |
| `HOUSING` | Imoveis/moradia |
| `CREDIT` | Credito financeiro |
| `ISSUES_ELECTIONS_POLITICS` | Questoes sociais/eleicoes/politica |
| `ONLINE_GAMBLING_AND_GAMING` | Jogos de azar/apostas online |

**Estrategias de lance:**

| Valor | Descricao |
|-------|-----------|
| `LOWEST_COST_WITHOUT_CAP` | Menor custo sem limite (padrao) |
| `LOWEST_COST_WITH_BID_CAP` | Menor custo com limite de lance |
| `COST_CAP` | Limite de custo por resultado |
| `LOWEST_COST_WITH_MIN_ROAS` | Menor custo com ROAS minimo |

**Retorno (criacao):**
```json
{
  "success": true,
  "campaign_id": "120210000000000001",
  "message": "Campanha \"Leads SP\" criada com sucesso. ID: 120210000000000001"
}
```

**Retorno (validacao):**
```json
{
  "success": true,
  "message": "Validacao bem-sucedida. Campanha nao criada (validate_only=true)."
}
```

---

#### `meta_update_campaign`

Atualiza campos de uma campanha existente. Envie apenas os campos que deseja alterar.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Escrita |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Descricao |
|------|------|-------------|-----------|
| `campaign_id` | string | **Sim** | ID da campanha |
| `name` | string | Nao | Novo nome (1-400 caracteres) |
| `status` | enum | Nao | `ACTIVE`, `PAUSED`, `ARCHIVED`, `DELETED` |
| `daily_budget` | number | Nao | Novo orcamento diario em centavos |
| `lifetime_budget` | number | Nao | Novo orcamento total em centavos |
| `spend_cap` | number | Nao | Novo limite de gasto (0 para remover) |
| `start_time` | string | Nao | Nova data de inicio (ISO 8601) |
| `stop_time` | string | Nao | Nova data de termino (ISO 8601) |
| `bid_strategy` | enum | Nao | Nova estrategia de lance |

**Retorno:**
```json
{
  "success": true,
  "campaign_id": "120210000000000001",
  "updated_fields": ["status", "daily_budget"],
  "message": "Campanha 120210000000000001 atualizada com sucesso."
}
```

---

#### `meta_delete_campaign`

Deleta permanentemente uma campanha e **todos** os seus ad sets e anuncios.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Escrita |
| **Idempotente** | Nao |
| **Destrutiva** | **SIM — IRREVERSIVEL** |

> **ATENCAO:** Esta acao e irreversivel. Considere usar `meta_update_campaign` com `status: "ARCHIVED"` para arquivar em vez de deletar.

**Parametros:**

| Nome | Tipo | Obrigatorio | Descricao |
|------|------|-------------|-----------|
| `campaign_id` | string | **Sim** | ID da campanha a deletar |

**Retorno:**
```json
{
  "success": true,
  "campaign_id": "120210000000000001",
  "message": "Campanha 120210000000000001 deletada com sucesso."
}
```

---

### 7.3 Conjuntos de Anuncios — Ad Sets (5 tools)

#### `meta_list_adsets`

Lista conjuntos de anuncios de uma conta ou campanha especifica.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `ad_account_id` | string | Nao | `META_AD_ACCOUNT_ID` | ID da conta |
| `campaign_id` | string | Nao | — | Filtrar ad sets desta campanha |
| `status_filter` | string[] | Nao | Todos | Filtrar por status: `ACTIVE`, `PAUSED`, `ARCHIVED` |
| `limit` | number | Nao | 50 | Maximo (1-500) |

**Retorno:**
```json
{
  "total": 3,
  "adsets": [
    {
      "id": "120210000000000002",
      "name": "Homens 25-45 SP - Interesse Imoveis",
      "status": "ACTIVE",
      "effective_status": "ACTIVE",
      "campaign_id": "120210000000000001",
      "daily_budget": "25.00",
      "lifetime_budget": null,
      "budget_remaining": "18.50",
      "optimization_goal": "LEAD_GENERATION",
      "billing_event": "IMPRESSIONS",
      "bid_amount": null,
      "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
      "targeting": {
        "age_min": 25,
        "age_max": 45,
        "genders": [1],
        "geo_locations": { "countries": ["BR"] },
        "interests": [{ "id": "6003139266461", "name": "Real estate" }]
      },
      "start_time": "2025-03-01T00:00:00-0300",
      "end_time": null,
      "created_time": "2025-02-28T16:00:00-0300",
      "updated_time": "2025-03-18T10:00:00-0300"
    }
  ]
}
```

---

#### `meta_get_adset`

Retorna detalhes completos de um ad set especifico.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Descricao |
|------|------|-------------|-----------|
| `adset_id` | string | **Sim** | ID do conjunto de anuncios |

**Retorno:** Mesmo formato de um item do array `adsets` acima.

---

#### `meta_create_adset`

Cria um novo conjunto de anuncios dentro de uma campanha.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Escrita |
| **Idempotente** | Nao |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `ad_account_id` | string | Nao | `META_AD_ACCOUNT_ID` | ID da conta |
| `campaign_id` | string | **Sim** | — | ID da campanha pai |
| `name` | string | **Sim** | — | Nome do ad set (1-400 caracteres) |
| `optimization_goal` | string | **Sim** | — | Objetivo de otimizacao (ver tabela abaixo) |
| `billing_event` | enum | **Sim** | — | Evento de cobranca: `IMPRESSIONS`, `LINK_CLICKS`, `APP_INSTALLS`, `VIDEO_VIEWS`, `THRUPLAY` |
| `daily_budget` | number | Nao | — | Orcamento diario em centavos (min: 100). Mutuamente exclusivo com `lifetime_budget` |
| `lifetime_budget` | number | Nao | — | Orcamento total em centavos (min: 100). Mutuamente exclusivo com `daily_budget` |
| `targeting` | string | **Sim** | — | **JSON string** de segmentacao de publico (ver estrutura abaixo) |
| `status` | enum | Nao | `PAUSED` | `ACTIVE` ou `PAUSED` |
| `bid_amount` | number | Nao | — | Lance em centavos (para estrategias manuais) |
| `bid_strategy` | enum | Nao | — | `LOWEST_COST_WITHOUT_CAP`, `LOWEST_COST_WITH_BID_CAP`, `COST_CAP` |
| `start_time` | string | Nao | — | Inicio (ISO 8601) |
| `end_time` | string | Nao | — | Termino (ISO 8601) |

**Objetivos de otimizacao comuns:**

| Valor | Descricao |
|-------|-----------|
| `LINK_CLICKS` | Cliques no link |
| `REACH` | Alcance maximo |
| `IMPRESSIONS` | Maximo de impressoes |
| `LEAD_GENERATION` | Geracao de leads |
| `OFFSITE_CONVERSIONS` | Conversoes no site |
| `APP_INSTALLS` | Instalacoes de app |
| `VIDEO_VIEWS` | Visualizacoes de video |
| `LANDING_PAGE_VIEWS` | Visualizacoes de pagina de destino |
| `QUALITY_LEAD` | Leads de qualidade |

**Estrutura do targeting (JSON):**

```json
{
  "age_min": 18,
  "age_max": 65,
  "genders": [1, 2],
  "geo_locations": {
    "countries": ["BR"],
    "regions": [{ "key": "3847" }],
    "cities": [{ "key": "2430536", "radius": 40, "distance_unit": "kilometer" }]
  },
  "interests": [
    { "id": "6003139266461", "name": "Real estate" }
  ],
  "behaviors": [
    { "id": "6002714895372", "name": "Frequent travelers" }
  ],
  "custom_audiences": [
    { "id": "23850000000000000" }
  ],
  "excluded_custom_audiences": [
    { "id": "23850000000000001" }
  ],
  "device_platforms": ["mobile", "desktop"],
  "publisher_platforms": ["facebook", "instagram"],
  "facebook_positions": ["feed", "story"],
  "instagram_positions": ["stream", "story"]
}
```

> **Nota:** O campo `targeting` deve ser enviado como **string JSON**, nao como objeto. O servidor faz o parse internamente.

**Retorno:**
```json
{
  "success": true,
  "adset_id": "120210000000000002",
  "message": "Ad Set \"Homens 25-45 SP\" criado com sucesso. ID: 120210000000000002"
}
```

---

#### `meta_update_adset`

Atualiza campos de um ad set existente.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Escrita |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Descricao |
|------|------|-------------|-----------|
| `adset_id` | string | **Sim** | ID do ad set |
| `name` | string | Nao | Novo nome (1-400 caracteres) |
| `status` | enum | Nao | `ACTIVE`, `PAUSED`, `ARCHIVED`, `DELETED` |
| `daily_budget` | number | Nao | Novo orcamento diario em centavos |
| `lifetime_budget` | number | Nao | Novo orcamento total em centavos |
| `targeting` | string | Nao | Novo JSON de segmentacao |
| `bid_amount` | number | Nao | Novo lance em centavos |
| `bid_strategy` | enum | Nao | Nova estrategia de lance |
| `start_time` | string | Nao | Nova data de inicio |
| `end_time` | string | Nao | Nova data de termino |

**Retorno:**
```json
{
  "success": true,
  "adset_id": "120210000000000002",
  "updated_fields": ["daily_budget", "targeting"],
  "message": "Ad Set 120210000000000002 atualizado com sucesso."
}
```

---

#### `meta_delete_adset`

Deleta permanentemente um ad set e **todos** os seus anuncios.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Escrita |
| **Idempotente** | Nao |
| **Destrutiva** | **SIM — IRREVERSIVEL** |

> **ATENCAO:** Considere usar `meta_update_adset` com `status: "ARCHIVED"` em vez de deletar.

**Parametros:**

| Nome | Tipo | Obrigatorio | Descricao |
|------|------|-------------|-----------|
| `adset_id` | string | **Sim** | ID do ad set a deletar |

**Retorno:**
```json
{
  "success": true,
  "adset_id": "120210000000000002",
  "message": "Ad Set 120210000000000002 deletado com sucesso."
}
```

---

### 7.4 Anuncios — Ads (5 tools)

#### `meta_list_ads`

Lista anuncios de uma conta, campanha ou ad set.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `ad_account_id` | string | Nao | `META_AD_ACCOUNT_ID` | ID da conta |
| `campaign_id` | string | Nao | — | Filtrar por campanha |
| `adset_id` | string | Nao | — | Filtrar por ad set (**precedencia sobre `campaign_id`**) |
| `status_filter` | string[] | Nao | Todos | Filtrar por status: `ACTIVE`, `PAUSED`, `ARCHIVED` |
| `limit` | number | Nao | 50 | Maximo (1-500) |

**Hierarquia de filtros:** Se `adset_id` e fornecido, ele tem precedencia. Caso contrario, usa `campaign_id`. Se nenhum for fornecido, lista todos da conta.

**Retorno:**
```json
{
  "total": 2,
  "ads": [
    {
      "id": "120210000000000003",
      "name": "Anuncio Link - Imovel SP v1",
      "status": "ACTIVE",
      "effective_status": "ACTIVE",
      "adset_id": "120210000000000002",
      "campaign_id": "120210000000000001",
      "creative": {
        "id": "120210000000000010",
        "name": "Criativo Imovel SP"
      },
      "bid_amount": null,
      "conversion_domain": "seusite.com.br",
      "issues": [],
      "review_feedback": null,
      "created_time": "2025-03-01T10:00:00-0300",
      "updated_time": "2025-03-18T10:00:00-0300"
    }
  ]
}
```

**Campo `issues`**: Lista de problemas detectados pela Meta (anuncios reprovados, violacoes de politica, etc.):
```json
{
  "level": "AD",
  "code": 1487171,
  "summary": "Ad Not Delivering",
  "message": "Your ad isn't running because it doesn't comply with our Advertising Policies."
}
```

---

#### `meta_get_ad`

Retorna detalhes completos de um anuncio, incluindo criativo, problemas e feedback de revisao.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Descricao |
|------|------|-------------|-----------|
| `ad_id` | string | **Sim** | ID do anuncio |

**Retorno:** Mesmo formato de um item do array `ads` acima.

---

#### `meta_create_ad`

Cria um novo anuncio dentro de um ad set.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Escrita |
| **Idempotente** | Nao |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `ad_account_id` | string | Nao | `META_AD_ACCOUNT_ID` | ID da conta |
| `adset_id` | string | **Sim** | — | ID do ad set pai |
| `name` | string | **Sim** | — | Nome do anuncio (1-400 caracteres) |
| `creative` | string | **Sim** | — | **JSON string** do criativo (ver exemplos abaixo) |
| `status` | enum | Nao | `PAUSED` | `ACTIVE` ou `PAUSED` |
| `bid_amount` | number | Nao | — | Lance em centavos (sobrescreve o do ad set) |
| `conversion_domain` | string | Nao | — | Dominio de conversao (ex: `seusite.com.br`) |
| `tracking_specs` | string | Nao | — | JSON de especificacoes de rastreamento |

**Formato do creative — Reutilizando criativo existente:**
```json
{"creative_id": "120210000000000010"}
```

**Formato do creative — Criativo inline com link:**
```json
{
  "object_story_spec": {
    "page_id": "PAGE_ID",
    "link_data": {
      "link": "https://seusite.com.br",
      "message": "Confira nossos imoveis em SP!",
      "name": "Apartamentos a partir de R$200k",
      "description": "Condominios com lazer completo",
      "call_to_action": {
        "type": "LEARN_MORE"
      }
    }
  }
}
```

> **Nota:** O campo `creative` deve ser enviado como **string JSON**, nao como objeto.

**Retorno:**
```json
{
  "success": true,
  "ad_id": "120210000000000003",
  "message": "Anuncio \"Anuncio Link v1\" criado com sucesso. ID: 120210000000000003"
}
```

---

#### `meta_update_ad`

Atualiza campos de um anuncio existente.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Escrita |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros:**

| Nome | Tipo | Obrigatorio | Descricao |
|------|------|-------------|-----------|
| `ad_id` | string | **Sim** | ID do anuncio |
| `name` | string | Nao | Novo nome (1-400 caracteres) |
| `status` | enum | Nao | `ACTIVE`, `PAUSED`, `ARCHIVED`, `DELETED` |
| `creative` | string | Nao | Novo JSON do criativo |
| `bid_amount` | number | Nao | Novo lance em centavos |
| `conversion_domain` | string | Nao | Novo dominio de conversao |

**Retorno:**
```json
{
  "success": true,
  "ad_id": "120210000000000003",
  "updated_fields": ["name", "status"],
  "message": "Anuncio 120210000000000003 atualizado com sucesso."
}
```

---

#### `meta_delete_ad`

Deleta permanentemente um anuncio.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Escrita |
| **Idempotente** | Nao |
| **Destrutiva** | **SIM — IRREVERSIVEL** |

> **ATENCAO:** Considere usar `meta_update_ad` com `status: "ARCHIVED"` em vez de deletar.

**Parametros:**

| Nome | Tipo | Obrigatorio | Descricao |
|------|------|-------------|-----------|
| `ad_id` | string | **Sim** | ID do anuncio a deletar |

**Retorno:**
```json
{
  "success": true,
  "ad_id": "120210000000000003",
  "message": "Anuncio 120210000000000003 deletado com sucesso."
}
```

---

### 7.5 Insights e Metricas (3 tools)

Todas as tools de insights compartilham um conjunto base de parametros:

**Parametros comuns de Insights:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `fields` | string | Nao | `spend,impressions,reach,clicks,ctr,cpm,cpc,frequency,actions,cost_per_action_type,date_start,date_stop,...` | Campos separados por virgula. Extras: `cost_per_result`, `quality_score_organic`, `quality_score_ectr`, `quality_score_ecvr`, `website_purchase_roas`, `outbound_clicks`, `landing_page_view` |
| `date_preset` | enum | Nao | `last_30d` | Periodo pre-definido (ver tabela abaixo) |
| `since` | string | Nao | — | Data de inicio personalizada (`YYYY-MM-DD`). Usar junto com `until` |
| `until` | string | Nao | — | Data de termino personalizada (`YYYY-MM-DD`). Usar junto com `since` |
| `breakdowns` | string[] | Nao | — | Dimensoes de segmentacao (ver tabela abaixo) |
| `level` | enum | Nao | Depende do contexto | Nivel de agregacao: `account`, `campaign`, `adset`, `ad` |
| `limit` | number | Nao | 100 | Maximo de linhas (1-500) |

**Periodos pre-definidos (date_preset):**

| Valor | Descricao |
|-------|-----------|
| `today` | Hoje |
| `yesterday` | Ontem |
| `this_week_sun_today` | Semana atual (dom-hoje) |
| `this_week_mon_today` | Semana atual (seg-hoje) |
| `last_week_sun_sat` | Semana passada (dom-sab) |
| `last_week_mon_sun` | Semana passada (seg-dom) |
| `this_month` | Mes atual |
| `last_month` | Mes passado |
| `this_quarter` | Trimestre atual |
| `last_quarter` | Trimestre passado |
| `last_3d` | Ultimos 3 dias |
| `last_7d` | Ultimos 7 dias |
| `last_14d` | Ultimos 14 dias |
| `last_28d` | Ultimos 28 dias |
| `last_30d` | Ultimos 30 dias |
| `last_90d` | Ultimos 90 dias |
| `last_year` | Ano passado |
| `this_year` | Ano atual |
| `maximum` | Todo o historico |

**Dimensoes de segmentacao (breakdowns):**

| Valor | Descricao |
|-------|-----------|
| `age` | Faixa etaria |
| `gender` | Genero |
| `country` | Pais |
| `region` | Regiao/estado |
| `dma` | Area metropolitana (DMA) |
| `publisher_platform` | Plataforma (Facebook, Instagram, Audience Network) |
| `impression_device` | Dispositivo (mobile, desktop, tablet) |
| `device_platform` | Plataforma do dispositivo (android, ios, desktop) |
| `product_id` | ID do produto (para catalogo) |

**Logica de periodo:**
1. Se `date_preset` e fornecido: usa o preset
2. Se `since` e `until` sao fornecidos: usa intervalo personalizado
3. Se nenhum e fornecido: usa `last_30d` como padrao

---

#### `meta_get_insights`

Busca metricas de performance para qualquer objeto do Ads Manager (conta, campanha, ad set ou anuncio).

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros especificos:**

| Nome | Tipo | Obrigatorio | Descricao |
|------|------|-------------|-----------|
| `object_id` | string | **Sim** | ID do objeto: conta (`act_XXXX`), campanha, ad set ou anuncio |
| + todos os parametros comuns de insights | | | |

**Retorno:**
```json
{
  "object_id": "act_123456789",
  "period": "last_7d",
  "total_rows": 1,
  "summary": {
    "spend": "1250.00",
    "impressions": "45.230",
    "reach": "32.100",
    "clicks": "890",
    "avg_ctr": "1.97%",
    "avg_cpm": "27.63",
    "avg_cpc": "1.40"
  },
  "data": [
    {
      "spend": "1250.00",
      "impressions": "45230",
      "reach": "32100",
      "clicks": "890",
      "ctr": "1.968039",
      "cpm": "27.633",
      "cpc": "1.404",
      "frequency": "1.409",
      "actions": [
        { "action_type": "link_click", "value": "890" },
        { "action_type": "lead", "value": "45" },
        { "action_type": "page_engagement", "value": "120" }
      ],
      "date_start": "2025-03-11",
      "date_stop": "2025-03-18"
    }
  ]
}
```

**Calculo do summary:**
- `spend`: Soma dos gastos (float, 2 casas decimais)
- `impressions`: Soma das impressoes (formatado com separador de milhar pt-BR)
- `reach`: Soma do alcance (formatado)
- `clicks`: Soma dos cliques (formatado)
- `avg_ctr`: (cliques / impressoes) * 100, com 2 casas decimais
- `avg_cpm`: (gasto / impressoes) * 1000, com 2 casas decimais
- `avg_cpc`: gasto / cliques, com 2 casas decimais

---

#### `meta_get_account_insights`

Resumo rapido de performance de toda a conta de anuncio.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros especificos:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `ad_account_id` | string | Nao | `META_AD_ACCOUNT_ID` | ID da conta |
| + todos os parametros comuns | | | `level: account`, `date_preset: last_30d` | |

**Retorno:**
```json
{
  "ad_account_id": "act_123456789",
  "period": "last_30d",
  "level": "account",
  "total_rows": 1,
  "summary": {
    "spend": "5430.00",
    "impressions": "180.500",
    "reach": "95.200",
    "clicks": "3.450",
    "avg_ctr": "1.91%",
    "avg_cpm": "30.08",
    "avg_cpc": "1.57"
  },
  "data": [...]
}
```

> **Dica:** Use `level: "campaign"` para ver quais campanhas gastaram mais no periodo.

---

#### `meta_get_campaign_insights`

Metricas de performance por campanha, com comparacao entre campanhas.

| Propriedade | Valor |
|-------------|-------|
| **Tipo** | Leitura |
| **Idempotente** | Sim |
| **Destrutiva** | Nao |

**Parametros especificos:**

| Nome | Tipo | Obrigatorio | Padrao | Descricao |
|------|------|-------------|--------|-----------|
| `ad_account_id` | string | Nao | `META_AD_ACCOUNT_ID` | ID da conta |
| `campaign_ids` | string[] | Nao | Todas | IDs de campanhas especificas. Se omitido, retorna todas |
| + todos os parametros comuns | | | `level: campaign`, `date_preset: last_30d` | |

**Comportamento:**
- Se `campaign_ids` e fornecido: busca insights para cada campanha individualmente e combina os resultados
- Se omitido: busca todos os insights da conta no nivel de campanha
- Resultados sao **ordenados por gasto (decrescente)**, facilitando identificar as campanhas que mais gastaram

**Retorno:**
```json
{
  "period": "last_30d",
  "total_campaigns": 3,
  "summary": {
    "spend": "5430.00",
    "impressions": "180.500",
    "reach": "95.200",
    "clicks": "3.450",
    "avg_ctr": "1.91%",
    "avg_cpm": "30.08",
    "avg_cpc": "1.57"
  },
  "campaigns": [
    {
      "campaign_id": "120210000000000001",
      "campaign_name": "Leads Imoveis SP",
      "spend": "3200.00",
      "impressions": "110000",
      "reach": "58000",
      "clicks": "2100",
      "ctr": "1.91%",
      "cpm": "29.09",
      "cpc": "1.52",
      "frequency": "1.90",
      "actions": [
        { "action_type": "lead", "value": "85" }
      ],
      "date_start": "2025-02-18",
      "date_stop": "2025-03-18"
    },
    {
      "campaign_id": "120210000000000004",
      "campaign_name": "Trafego Blog",
      "spend": "1500.00",
      "impressions": "50000",
      "reach": "28000",
      "clicks": "950",
      "ctr": "1.90%",
      "cpm": "30.00",
      "cpc": "1.58",
      "frequency": "1.79",
      "actions": [],
      "date_start": "2025-02-18",
      "date_stop": "2025-03-18"
    }
  ]
}
```

---

### 7.6 Ad Library (1 tool)

- `meta_search_ad_library`

**Pre-requisito importante:** esta tool pode exigir permissao adicional do app para acesso ao `ads_archive`.

---

### 7.7 Audiences (9 tools)

- `meta_list_audiences`
- `meta_get_audience`
- `meta_create_custom_audience`
- `meta_create_lookalike_audience`
- `meta_update_audience`
- `meta_delete_audience`
- `meta_add_audience_users`
- `meta_remove_audience_users`
- `meta_replace_audience_users`

---

### 7.8 Assets (7 tools)

- `meta_list_ad_images`
- `meta_get_ad_image`
- `meta_upload_ad_image`
- `meta_list_ad_videos`
- `meta_get_ad_video`
- `meta_get_ad_video_status`
- `meta_upload_ad_video`

**Entrada de upload:** cada tool aceita exatamente uma origem entre `file_path`, `file_url` e `base64_data`.

---

### 7.9 Creatives (4 tools)

- `meta_list_ad_creatives`
- `meta_get_ad_creative`
- `meta_create_ad_creative`
- `meta_update_ad_creative`

---

### 7.10 Lead Forms (5 tools)

- `meta_list_lead_forms`
- `meta_get_lead_form`
- `meta_list_form_leads`
- `meta_get_lead`
- `meta_download_form_leads`

**Pre-requisito importante:** a listagem por pagina pode exigir `page_access_token`.

---

### 7.11 Previews (2 tools)

- `meta_get_ad_preview`
- `meta_get_creative_preview`

---

### 7.12 Conversions (3 tools)

- `meta_send_conversion_event`
- `meta_send_conversion_events_batch`
- `meta_validate_conversion_payload`

**Pre-requisito importante:** envio exige `pixel_id` explicito.

---

## 8. Cliente da API Meta

O cliente (`src/client.ts`) encapsula toda a comunicacao com a Meta Graph API.

### Configuracao de conexao

| Propriedade | Valor |
|-------------|-------|
| **Base URL** | `https://graph.facebook.com/{META_API_VERSION}` |
| **Versao padrao** | `v21.0` |
| **Timeout** | 30 segundos |
| **Autenticacao** | `access_token` como query parameter |
| **Content-Type** | `application/json` |

### Funcoes principais

#### `makeRequest<T>(endpoint, method, params, data)`

Funcao central para todas as chamadas a Meta API.

| Parametro | Tipo | Padrao | Descricao |
|-----------|------|--------|-----------|
| `endpoint` | string | — | Caminho do endpoint (sem base URL) |
| `method` | `GET`, `POST`, `DELETE` | `GET` | Metodo HTTP |
| `params` | object | `{}` | Query parameters |
| `data` | object | — | Body (apenas POST) |

#### `paginate<T>(endpoint, params, maxItems)`

Paginacao automatica baseada em cursores.

| Propriedade | Valor |
|-------------|-------|
| **Itens por pagina** | 25 |
| **Maximo por chamada** | 500 (configuravel) |
| **Tipo de paginacao** | Cursor-based (campo `after`) |
| **Criterio de parada** | `maxItems` atingido ou sem proxima pagina |

#### `truncate(text, limit)`

Trunca respostas grandes para evitar estouro de contexto.

| Propriedade | Valor |
|-------------|-------|
| **Limite padrao** | 25.000 caracteres |
| **Sufixo de truncamento** | `... [truncado: N caracteres restantes]` |

#### `normalizeAdAccountId(id)`

Garante que o ID da conta tem o prefixo `act_`.

```
"123456789"     -> "act_123456789"
"act_123456789" -> "act_123456789"
```

### Tratamento de erros da API

O servidor mapeia os codigos de erro da Meta API para mensagens descritivas com orientacao de resolucao:

| Codigo | Subcoodigo | Erro | Orientacao |
|--------|-----------|------|------------|
| 190 | — | Token invalido ou expirado | Gere um novo token em Meta Business Manager > Usuarios do Sistema |
| 102 | 463 | Token expirado | Mesmo acima |
| 200, 10 | — | Permissao insuficiente | Verifique permissoes: `ads_management`, `ads_read`, `business_management`, `read_insights` |
| `OAuthException` | — | Erro de autorizacao | Mesmo acima |
| 17, 4, 32, 613 | — | Rate limit atingido | Aguarde alguns segundos e tente novamente |
| 100 | — | Parametro invalido | Verifique os campos e IDs fornecidos |
| 2635 | — | Conta nao encontrada | Verifique `META_AD_ACCOUNT_ID` e permissoes do token |
| HTTP 404 | — | Recurso nao encontrado | Verifique se o ID esta correto |
| HTTP 403 | — | Acesso negado | Verifique permissoes do token |
| `ECONNABORTED` | — | Timeout | Tente novamente |

---

## 9. Tipos TypeScript

Todas as interfaces estao definidas em `src/types.ts`.

### MetaApiResponse\<T\>

Resposta padrao da Meta Graph API com paginacao.

```typescript
interface MetaApiResponse<T> {
  data: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
  summary?: Record<string, unknown>;
}
```

### MetaApiError

Formato de erro retornado pela Meta API.

```typescript
interface MetaApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}
```

### AdAccount

```typescript
interface AdAccount {
  id: string;                    // "act_123456789"
  name: string;                  // Nome da conta
  account_id: string;            // "123456789" (sem prefixo)
  account_status: number;        // Codigo de status (1=ACTIVE, 2=DISABLED, etc.)
  currency: string;              // "BRL", "USD", etc.
  timezone_name: string;         // "America/Sao_Paulo"
  amount_spent: string;          // Total gasto (em centavos como string)
  balance: string;               // Saldo atual (em centavos como string)
  spend_cap?: string;            // Limite de gasto
  business?: {
    id: string;
    name: string;
  };
}
```

### Campaign

```typescript
interface Campaign {
  id: string;
  name: string;
  status: string;                  // "ACTIVE", "PAUSED", "ARCHIVED", "DELETED"
  effective_status: string;        // Status efetivo (pode diferir do status manual)
  objective: string;               // "OUTCOME_LEADS", etc.
  daily_budget?: string;           // Em centavos
  lifetime_budget?: string;        // Em centavos
  budget_remaining?: string;       // Em centavos
  spend_cap?: string;
  bid_strategy?: string;
  buying_type?: string;            // "AUCTION"
  start_time?: string;             // ISO 8601
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
  special_ad_categories?: string[];
}
```

### Targeting

```typescript
interface Targeting {
  age_min?: number;                // 13-65
  age_max?: number;                // 13-65
  genders?: number[];              // 1=Masculino, 2=Feminino
  geo_locations?: {
    countries?: string[];           // ["BR", "US"]
    regions?: Array<{ key: string }>;
    cities?: Array<{ key: string; radius: number; distance_unit: string }>;
  };
  interests?: Array<{ id: string; name: string }>;
  behaviors?: Array<{ id: string; name: string }>;
  custom_audiences?: Array<{ id: string }>;
  excluded_custom_audiences?: Array<{ id: string }>;
  device_platforms?: string[];      // ["mobile", "desktop"]
  publisher_platforms?: string[];   // ["facebook", "instagram"]
  facebook_positions?: string[];    // ["feed", "story", "right_hand_column"]
  instagram_positions?: string[];   // ["stream", "story", "explore"]
  flexible_spec?: Array<Record<string, unknown>>;
}
```

### AdSet

```typescript
interface AdSet {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_amount?: number;
  bid_strategy?: string;
  targeting?: Targeting;
  start_time?: string;
  end_time?: string;
  created_time?: string;
  updated_time?: string;
}
```

### AdCreative

```typescript
interface AdCreative {
  id?: string;
  name?: string;
  title?: string;
  body?: string;
  image_url?: string;
  video_id?: string;
  link_url?: string;
  call_to_action_type?: string;
  object_story_spec?: Record<string, unknown>;
}
```

### Ad

```typescript
interface Ad {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  adset_id: string;
  campaign_id?: string;
  creative?: AdCreative;
  bid_amount?: number;
  conversion_domain?: string;
  created_time?: string;
  updated_time?: string;
  issues_info?: Array<{
    level: string;
    error_code: number;
    error_summary: string;
    error_message: string;
  }>;
  ad_review_feedback?: Record<string, unknown>;
}
```

### Insight

```typescript
interface InsightAction {
  action_type: string;    // "link_click", "lead", "purchase", etc.
  value: string;          // Quantidade como string
}

interface Insight {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpm?: string;
  cpc?: string;
  frequency?: string;
  actions?: InsightAction[];
  cost_per_action_type?: InsightAction[];
  date_start?: string;    // "YYYY-MM-DD"
  date_stop?: string;
  account_id?: string;
  account_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
}
```

---

## 10. Constantes e Enums

Definidos em `src/constants.ts`.

### Configuracao da API

| Constante | Valor | Descricao |
|-----------|-------|-----------|
| `META_API_VERSION` | `v21.0` (ou env) | Versao da Graph API |
| `META_BASE_URL` | `https://graph.facebook.com/{version}` | URL base |
| `CHARACTER_LIMIT` | 25.000 | Limite de truncamento de respostas |
| `DEFAULT_PAGE_LIMIT` | 25 | Itens por pagina na paginacao |
| `MAX_PAGINATE_ITEMS` | 500 | Maximo de itens por chamada paginada |

### Campos solicitados por entidade

| Entidade | Quantidade | Campos |
|----------|-----------|--------|
| **Campaign** | 15 | id, name, status, effective_status, objective, daily_budget, lifetime_budget, budget_remaining, spend_cap, bid_strategy, buying_type, start_time, stop_time, created_time, updated_time, special_ad_categories |
| **Ad Set** | 17 | id, name, status, effective_status, campaign_id, daily_budget, lifetime_budget, budget_remaining, optimization_goal, billing_event, bid_amount, bid_strategy, targeting, start_time, end_time, created_time, updated_time |
| **Ad** | 13 | id, name, status, effective_status, adset_id, campaign_id, creative, bid_amount, conversion_domain, created_time, updated_time, issues_info, ad_review_feedback |
| **Ad Account** | 10 | id, name, account_id, account_status, currency, timezone_name, amount_spent, balance, business, spend_cap |
| **Insight** | 20 | spend, impressions, reach, clicks, ctr, cpm, cpc, frequency, actions, cost_per_action_type, date_start, date_stop, account_id, account_name, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name |

### Enums

**Objetivos de Campanha (CAMPAIGN_OBJECTIVES):**
`OUTCOME_AWARENESS`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_SALES`, `OUTCOME_TRAFFIC`, `OUTCOME_APP_PROMOTION`

**Status de Anuncio (AD_STATUSES):**
`ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED`

**Niveis de Insight (INSIGHT_LEVELS):**
`account`, `campaign`, `adset`, `ad`

**Breakdowns de Insight (INSIGHT_BREAKDOWNS):**
`age`, `gender`, `country`, `region`, `dma`, `publisher_platform`, `impression_device`, `device_platform`, `product_id`

**Presets de Data (DATE_PRESETS):** 19 opcoes de `today` a `maximum` (ver secao 7.5 para lista completa).

---

## 11. Middleware

### Logger (`src/middleware/logger.ts`)

Registra cada requisicao HTTP com tempo de resposta.

**Formato:**
```
[2025-03-18T12:00:00.000Z] POST /mcp 200 45ms - 192.168.1.100
```

**Dados registrados:**
- Timestamp ISO 8601
- Metodo HTTP
- Path
- Status code
- Duracao em milissegundos
- IP do cliente

### Rate Limiter (`src/middleware/rate-limit.ts`)

Limita o numero de requisicoes por minuto.

| Propriedade | Valor |
|-------------|-------|
| **Janela** | 60 segundos |
| **Limite** | `RATE_LIMIT_RPM` (padrao: 60) |
| **Headers** | Standard (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`) |
| **Excecao** | Endpoint `/health` nao e limitado |
| **Resposta ao exceder** | `{"error": "Too many requests, try again later"}` |

### Error Handler (`src/middleware/error-handler.ts`)

Captura erros nao tratados em qualquer parte do pipeline Express.

**Comportamento:**
- Loga a mensagem de erro e stack trace no console
- Retorna `500 Internal Server Error` com body generico
- Nao expoe detalhes internos ao cliente

---

## 12. Deploy com Docker

### Dockerfile (build multi-stage)

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3200
CMD ["node", "dist/index.js"]
```

**Caracteristicas:**
- **Base**: `node:20-alpine` (imagem leve)
- **Multi-stage**: Stage de build com devDependencies, stage de producao apenas com dependencias de runtime
- **Seguranca**: Roda como usuario `node` (nao root)
- **Tamanho reduzido**: Apenas `dist/` e `node_modules` de producao na imagem final

### Build da imagem

```bash
docker build -t mcp-facebook-ads:latest .
```

### Docker Compose (Swarm + Traefik)

O `docker-compose.yml` esta configurado para deploy em Docker Swarm com Traefik como reverse proxy:

**Recursos:**
- CPU: 0.5 core
- Memoria: 512 MB

**Health check:**
- Teste: `wget --spider http://127.0.0.1:3200/health`
- Intervalo: 30 segundos
- Timeout: 10 segundos
- Retries: 3
- Start period: 15 segundos

**Restart policy:**
- Condicao: qualquer falha
- Delay: 5 segundos
- Max attempts: 3
- Janela: 120 segundos

**HTTPS automatico via Traefik:**
- Dominio configurado: `mcp-facebook-ads.famachat.com.br`
- Certificado TLS via Let's Encrypt
- Entrypoint: `websecure` (HTTPS)

### Deploy

```bash
# Build da imagem
docker build -t mcp-facebook-ads:latest .

# Deploy no Swarm
docker stack deploy -c docker-compose.yml meta-ads
```

---

## 13. Troubleshooting

### Erros de autenticacao

| Sintoma | Causa provavel | Solucao |
|---------|---------------|---------|
| `401 Missing or invalid Authorization header` | Header Authorization ausente ou mal formatado | Envie `Authorization: Bearer <API_KEY>` |
| `403 Invalid API key` | Token nao corresponde ao API_KEY configurado | Verifique o valor de `API_KEY` no `.env` |
| `Token de acesso invalido ou expirado` | META_ACCESS_TOKEN expirou | Gere novo System User Token no Business Manager |
| `Permissao insuficiente` | Token sem permissoes necessarias | Adicione: `ads_management`, `ads_read`, `business_management`, `read_insights` |

### Erros de configuracao

| Sintoma | Causa provavel | Solucao |
|---------|---------------|---------|
| `API_KEY is required` | Variavel API_KEY nao definida | Defina `API_KEY` no `.env` |
| `META_ACCESS_TOKEN nao configurado` | Token da Meta ausente | Defina `META_ACCESS_TOKEN` no `.env` |
| `META_AD_ACCOUNT_ID nao configurado` | ID da conta ausente | Defina `META_AD_ACCOUNT_ID` no `.env` (formato: `act_XXXXXXXXXX`) |
| `Sessao invalida ou ausente` | Requisicao sem session ID | Envie um `initialize` request primeiro para obter o session ID |
| `Esta operacao exige um Page Access Token` | Tool de Lead Forms exigiu contexto de pagina | Envie `page_access_token` com acesso a pagina/formulario |

### Erros da Meta API

| Sintoma | Causa provavel | Solucao |
|---------|---------------|---------|
| `Rate limit atingido` | Muitas chamadas a API da Meta | Aguarde alguns segundos; considere aumentar intervalos entre chamadas |
| `Parametro invalido (code 100)` | Campo ou valor incorreto | Leia a `error_user_msg` retornada pela Meta; ela costuma apontar exatamente o parametro invalido |
| `Conta nao encontrada (code 2635)` | ID da conta incorreto ou sem acesso | Verifique `META_AD_ACCOUNT_ID` e permissoes do token |
| `Recurso nao encontrado (404)` | ID de campanha/ad set/anuncio invalido | Confirme que o ID existe e esta acessivel |
| `Timeout na requisicao` | Lentidao na API da Meta | Tente novamente; se persistir, verifique conectividade |
| `Permissao insuficiente` em Ad Library | O app nao possui acesso ao `ads_archive` | Verifique a configuracao/permissoes do app para Ads Archive / Ad Library |

### Erros de validacao

| Sintoma | Causa provavel | Solucao |
|---------|---------------|---------|
| `O campo targeting deve ser um JSON valido` | String de targeting mal formatada | Valide o JSON antes de enviar. Use `JSON.parse()` para testar |
| `O campo creative deve ser um JSON valido` | String de creative mal formatada | Valide o JSON. Exemplos na secao 7.4 |
| `Nenhum campo para atualizar fornecido` | Update sem campos | Envie ao menos um campo para alterar |
| `tracking_specs deve ser um JSON valido` | String de tracking specs mal formatada | Valide o JSON |
| `Informe exatamente uma origem de upload` | Foram enviados `file_path`, `file_url` e/ou `base64_data` ao mesmo tempo | Envie somente uma origem de arquivo por request |
| `pixel_id` ausente em Conversions | Tool de CAPI sem identificador do pixel/dataset | Informe explicitamente o `pixel_id` da integracao server-side |

### Dicas de debug

1. **Verifique os logs**: O middleware de logger registra cada requisicao com status e duracao
2. **Use o health check**: `curl http://localhost:3200/health` para verificar se o servidor esta rodando
3. **Teste o token da Meta**: Acesse `https://graph.facebook.com/v21.0/me?access_token=SEU_TOKEN` para verificar validade
4. **Verifique permissoes**: Acesse `https://graph.facebook.com/v21.0/me/permissions?access_token=SEU_TOKEN` para ver permissoes ativas
5. **Use `validate_only`**: Na tool `meta_create_campaign`, use `validate_only: true` para testar parametros sem criar recursos
6. **Inspecione erros estruturados**: Todas as tools retornam `isError: true` com mensagens descritivas em portugues quando falham
7. **Monitore rate limits**: Observe os headers `RateLimit-Remaining` nas respostas HTTP

---

*Documento gerado em marco de 2025. Para a versao mais atualizada, consulte o codigo-fonte do projeto.*
