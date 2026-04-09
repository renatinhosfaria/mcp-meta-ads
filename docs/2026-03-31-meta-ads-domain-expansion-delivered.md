# Meta Ads MCP - Tudo Que Foi Implementado

Data: 2026-03-31
Status: implementado, validado e publicado no servico Docker

## Resumo executivo

Esta entrega expandiu o MCP de Meta Ads de 5 dominios operacionais para 12 dominios cobertos:

- Accounts
- Campaigns
- Ad Sets
- Ads
- Insights
- Ad Library
- Audiences
- Assets
- Creatives
- Lead Forms
- Previews
- Conversions

Foram adicionadas 31 tools novas, totalizando 51 tools no servidor.

## Arquivos criados

- `src/tools/ad-library.ts`
- `src/tools/audiences.ts`
- `src/tools/assets.ts`
- `src/tools/creatives.ts`
- `src/tools/lead-forms.ts`
- `src/tools/previews.ts`
- `src/tools/conversions.ts`
- `tests/meta-domain-expansion.test.ts`
- `docs/plans/2026-03-31-meta-ads-domain-expansion-design.md`
- `docs/plans/2026-03-31-meta-ads-domain-expansion-implementation-plan.md`
- `docs/2026-03-31-meta-ads-domain-expansion-delivered.md`

## Arquivos alterados

- `src/server.ts`
- `src/client.ts`
- `src/constants.ts`
- `src/types.ts`
- `DOCUMENTATION.md`

## Registro dos novos dominios no servidor

Os novos dominios foram registrados em `src/server.ts`:

- `registerAdLibraryTools`
- `registerAudienceTools`
- `registerAssetTools`
- `registerCreativeTools`
- `registerLeadFormTools`
- `registerPreviewTools`
- `registerConversionTools`

## Catalogo das tools implementadas

### 1. Ad Library

Arquivo: `src/tools/ad-library.ts`

Tools:

- `meta_search_ad_library`

Capacidades:

- pesquisa publica no `ads_archive`
- filtros por pais, tipo de anuncio, tipo de busca, media type, plataformas, idiomas e paginas
- retorno estruturado com `snapshot_url`, `page_id`, `page_name` e plataformas

Protecoes adicionadas:

- validacao para exigir `search_terms` ou `search_page_ids`

### 2. Audiences

Arquivo: `src/tools/audiences.ts`

Tools:

- `meta_list_audiences`
- `meta_get_audience`
- `meta_create_custom_audience`
- `meta_create_lookalike_audience`
- `meta_update_audience`
- `meta_delete_audience`
- `meta_add_audience_users`
- `meta_remove_audience_users`
- `meta_replace_audience_users`

Capacidades:

- CRUD de custom audiences
- criacao de lookalike audiences
- gestao de memberships via `/users` e `/usersreplace`
- suporte a `schema`, `users`, `data_source` e uploads em sessao
- suporte a payloads JSON para `rule` e `lookalike_spec`

Melhoria de corretude:

- quando `subtype_filter` e usado, a listagem faz over-fetch antes de aplicar o filtro para nao esconder resultados validos das paginas seguintes

### 3. Assets

Arquivo: `src/tools/assets.ts`

Tools:

- `meta_list_ad_images`
- `meta_get_ad_image`
- `meta_upload_ad_image`
- `meta_list_ad_videos`
- `meta_get_ad_video`
- `meta_get_ad_video_status`
- `meta_upload_ad_video`

Capacidades:

- listagem e consulta de imagens
- upload de imagens via `file_path`, `file_url` ou `base64_data`
- listagem e consulta de videos
- consulta de status de processamento/publicacao de video
- upload de video via URL ou multipart

Protecoes adicionadas:

- validacao de origem unica de upload
- validacao de `base64_data` para rejeitar payload corrompido antes de chamar a Meta
- normalizacao de nome de arquivo e MIME type

### 4. Creatives

Arquivo: `src/tools/creatives.ts`

Tools:

- `meta_list_ad_creatives`
- `meta_get_ad_creative`
- `meta_create_ad_creative`
- `meta_update_ad_creative`

Capacidades:

- listagem e consulta de criativos
- criacao de criativos com `object_story_spec`, `asset_feed_spec`, `degrees_of_freedom_spec` e `creative_json`
- suporte a fluxo tipado simples para link ads e video ads
- atualizacao de campos mutaveis, como `name`

### 5. Lead Forms

Arquivo: `src/tools/lead-forms.ts`

Tools:

- `meta_list_lead_forms`
- `meta_get_lead_form`
- `meta_list_form_leads`
- `meta_get_lead`
- `meta_download_form_leads`

Capacidades:

- listagem de formularios por pagina
- leitura de formulario individual
- leitura de leads por formulario
- leitura de lead individual
- exportacao estruturada + CSV simples

Melhoria de corretude:

- `meta_download_form_leads` passou a usar paginacao real ate o `limit`, em vez de ler apenas a primeira pagina

### 6. Previews

Arquivo: `src/tools/previews.ts`

Tools:

- `meta_get_ad_preview`
- `meta_get_creative_preview`

Capacidades:

- preview HTML de anuncio existente por `ad_id`
- preview HTML de criativo por `creative_id`
- retorno do `body` bruto e de um resumo textual truncado

### 7. Conversions

Arquivo: `src/tools/conversions.ts`

Tools:

- `meta_send_conversion_event`
- `meta_send_conversion_events_batch`
- `meta_validate_conversion_payload`

Capacidades:

- envio de evento unico para `/{pixel_id}/events`
- envio batch de eventos
- validacao local do payload antes do envio
- suporte a `user_data`, `custom_data`, `event_id`, `event_source_url`, `test_event_code` e `partner_agent`

## Mudancas compartilhadas no core

### `src/client.ts`

Mudancas implementadas:

- suporte a `accessToken` por request
- suporte a `FormData` e multipart
- helper `makeMultipartRequest`
- helper `parseJsonString`
- helper `toGraphArrayParam`
- paginacao generica reutilizavel
- truncamento de payloads grandes

Tratamento de erro melhorado:

- mensagem especifica para `Page Access Token`
- mensagem especifica para token expirado/invalido
- mensagem especifica para `Unsupported post request`
- mensagem especifica para rate limit
- mensagem especifica para conta inexistente/sem acesso
- fallback legivel para erros HTTP e erros gerais

### `src/constants.ts`

Campos e constantes novas:

- `AD_IMAGE_FIELDS`
- `AD_VIDEO_FIELDS`
- `AUDIENCE_FIELDS`
- `AD_CREATIVE_FIELDS`
- `LEAD_FORM_FIELDS`
- `LEAD_FIELDS`
- `AD_LIBRARY_FIELDS`
- `DEFAULT_PREVIEW_FIELDS`

### `src/types.ts`

Tipos novos:

- `AdImage`
- `AdVideo`
- `CustomAudience`
- `LeadgenForm`
- `Lead`
- `AdPreview`
- `AdsArchiveResult`
- `CapiEvent`
- `CapiEventResponse`

## Correcao dos findings do review

Apos o review tecnico, foram corrigidos os seguintes problemas:

1. `meta_download_form_leads` lia apenas a primeira pagina de leads.
   Resultado: agora usa paginacao real.

2. `handleApiError` mascarava `Unsupported post request` como erro generico de parametro.
   Resultado: agora retorna mensagem especifica de operacao/objeto nao suportado.

3. `meta_list_audiences` podia esconder matches validos quando `subtype_filter` era usado.
   Resultado: agora faz over-fetch e aplica o `limit` depois do filtro.

4. uploads com `base64_data` invalido eram aceitos e viravam bytes corrompidos.
   Resultado: agora o payload e validado antes do upload.

5. `meta_search_ad_library` aceitava busca vazia sem `search_page_ids`.
   Resultado: o schema passou a rejeitar esse input antes da chamada a API.

## Testes adicionados

Arquivo: `tests/meta-domain-expansion.test.ts`

Cobertura adicionada:

- registro das novas tools
- mensagens de erro para `Page Access Token`
- mensagens de erro para permissoes da Ad Library
- classificacao correta de `Unsupported post request`
- validacao de origem unica para uploads
- aceite de origem valida para uploads
- rejeicao de base64 invalido
- construcao do payload de audience replace
- estrategia de paginacao para audiences filtradas
- estrategia de paginacao para download de leads
- validacao de payload CAPI
- exigencia de `search_terms` ou `search_page_ids` na Ad Library

## Validacao executada

Verificacoes locais:

- `node --import tsx --test tests/meta-v25-fixes.test.ts tests/meta-domain-expansion.test.ts`
- `npm run build`

Resultado final local:

- 18 testes passando
- build TypeScript passando

## Publicacao e restart

Foi executado o ciclo de publicacao do servico Docker:

- `npm run build`
- `docker build -t mcp-facebook-ads:latest .`
- `docker service update --force --image mcp-facebook-ads:latest mcp-facebook-ads_mcp-facebook-ads`

Estado final observado:

- servico `mcp-facebook-ads_mcp-facebook-ads` convergido
- container novo em `healthy`
- imagem ativa reconstruida em 2026-03-31

## Dependencias operacionais e ressalvas

Algumas tools estao implementadas, mas continuam dependentes de permissoes ou ativos especificos da Meta:

- Ad Library pode exigir permissao adicional do app para `ads_archive`
- Lead Forms pode exigir `page_access_token`
- Conversions exige `pixel_id`
- Custom Audiences e Lookalikes dependem das permissoes e termos da conta/Business
- Uploads e previews continuam sujeitos as validacoes da Graph API

## Resultado final

O MCP agora cobre discovery, criativos, assets, audiencias, formularios nativos, previews e CAPI, sem virar um proxy generico da Graph API. A expansao foi entregue com:

- novos modulos por dominio
- schemas validados
- payloads hibridos para casos avancados
- erros operacionais mais claros
- testes de regressao para os problemas encontrados no review
- rebuild e restart do servico em producao
