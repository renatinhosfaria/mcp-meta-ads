# Meta Ads Domain Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar novos domínios no MCP Meta Ads para Ad Library, Audiences, Assets, Creatives, Lead Forms, Previews e Conversions, preservando o estilo atual do servidor.

**Architecture:** A implementação fica dividida entre um core compartilhado em `src/client.ts`, `src/constants.ts` e `src/types.ts`, seguido de módulos novos em `src/tools/*.ts` registrados por `src/server.ts`. A cobertura será travada por testes de `node:test` antes da produção, com foco em registro de tools, payload builders, validações e mensagens de erro contextuais.

**Tech Stack:** TypeScript, Zod, axios, node:test, tsx, fetch/FormData nativo do Node

---

### Task 1: Lock The New Surface With Tests

**Files:**
- Create: `tests/meta-domain-expansion.test.ts`

**Step 1: Write the failing tests**

Cobrir:
- `createMcpServer()` registra as novas tools dos sete domínios
- `handleApiError()` distingue erro de `Page Access Token` e permissão insuficiente em Ad Library
- helper de upload rejeita múltiplas origens e aceita origem única válida
- helper de audiência monta payload de usuários com operação correta
- helper de CAPI exige `event_name` e `event_time`

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/meta-domain-expansion.test.ts`
Expected: FAIL por funções e módulos ainda ausentes.

### Task 2: Implement Shared Core

**Files:**
- Modify: `src/client.ts`
- Modify: `src/constants.ts`
- Modify: `src/types.ts`

**Step 1: Add request helpers**

Adicionar:
- override explícito de `accessToken`
- helper de upload multipart
- helper para `parseJsonString`
- melhor classificação de erros por contexto

**Step 2: Add new types and field constants**

Incluir tipos e fieldsets para archive, audiences, assets, creatives, forms, leads, previews e conversions.

**Step 3: Run targeted tests**

Run: `node --import tsx --test tests/meta-domain-expansion.test.ts`
Expected: ainda FAIL, mas com avanço nos casos cobertos pelo core.

### Task 3: Implement Assets, Creatives And Previews

**Files:**
- Create: `src/tools/assets.ts`
- Create: `src/tools/creatives.ts`
- Create: `src/tools/previews.ts`
- Modify: `src/server.ts`

**Step 1: Implement assets tools**

Cobrir:
- list/get/upload de imagens
- list/get/status/upload de vídeos

**Step 2: Implement creatives tools**

Cobrir:
- list/get/create/update com limite claro de mutabilidade

**Step 3: Implement previews tools**

Cobrir:
- preview por `ad_id`
- preview por `creative_id`

**Step 4: Run targeted tests**

Run: `node --import tsx --test tests/meta-domain-expansion.test.ts`
Expected: PASS nos cenários já cobertos desses domínios.

### Task 4: Implement Audiences, Lead Forms And Ad Library

**Files:**
- Create: `src/tools/audiences.ts`
- Create: `src/tools/lead-forms.ts`
- Create: `src/tools/ad-library.ts`
- Modify: `src/server.ts`

**Step 1: Implement audiences**

Cobrir:
- list/get/create/update/delete
- add/remove/replace de usuários
- lookalike

**Step 2: Implement lead forms**

Cobrir:
- list/get forms
- list/get leads
- suporte explícito a `page_access_token`

**Step 3: Implement ad library**

Cobrir:
- search read-only com filtros principais do `ads_archive`

**Step 4: Run targeted tests**

Run: `node --import tsx --test tests/meta-domain-expansion.test.ts`
Expected: PASS

### Task 5: Implement Conversions

**Files:**
- Create: `src/tools/conversions.ts`
- Modify: `src/server.ts`

**Step 1: Implement CAPI payload validation**

Cobrir:
- evento único
- batch
- validação mínima útil

**Step 2: Implement event sending**

Usar `/{pixel_id}/events` com `access_token` explícito.

**Step 3: Run targeted tests**

Run: `node --import tsx --test tests/meta-domain-expansion.test.ts`
Expected: PASS

### Task 6: Sync Documentation And Verify

**Files:**
- Modify: `DOCUMENTATION.md`

**Step 1: Document the new tool groups**

Adicionar uma seção de alto nível para as novas tools, incluindo os pré-requisitos críticos:
- permissão para Ads Archive
- `page_access_token` quando exigido por Lead Forms
- `pixel_id` para CAPI

**Step 2: Run targeted tests**

Run: `node --import tsx --test tests/meta-v25-fixes.test.ts tests/meta-domain-expansion.test.ts`
Expected: PASS

**Step 3: Build**

Run: `npm run build`
Expected: PASS
