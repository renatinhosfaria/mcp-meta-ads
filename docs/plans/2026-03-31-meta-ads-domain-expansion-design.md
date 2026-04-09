# Meta Ads Domain Expansion Design

**Goal:** Expandir o MCP Meta Ads com cobertura máxima do que é realmente implementável hoje na API da Meta, mantendo o estilo atual de tools nomeadas por domínio e evitando transformar o servidor em um proxy genérico do Graph API.

**Design Principle:** Tudo que for tecnicamente implementável deve entrar. Quando uma tool depender de permissões, termos, Page token, Pixel ID, Business asset ou acesso adicional, ela continua entrando no MCP e deve falhar com erro claro e acionável.

**Architecture:** A base atual de `accounts`, `campaigns`, `adsets`, `ads` e `insights` permanece. A expansão entra em módulos novos por domínio:

- `src/tools/ad-library.ts`
- `src/tools/audiences.ts`
- `src/tools/assets.ts`
- `src/tools/creatives.ts`
- `src/tools/lead-forms.ts`
- `src/tools/previews.ts`
- `src/tools/conversions.ts`

O `src/server.ts` passa a registrar esses módulos sem misturar responsabilidades nos arquivos já existentes.

## Shared Core Changes

`src/client.ts` precisa ganhar:

- suporte a `multipart/form-data` para upload de imagens e vídeos
- resolução explícita de credenciais por contexto
- helpers para `file_path`, `file_url`, `base64_data` e payload JSON livre
- classificação de erro por causa provável

`src/types.ts` e `src/constants.ts` passam a incluir tipos e campos para:

- `AdImage`
- `AdVideo`
- `CustomAudience`
- `LeadgenForm`
- `Lead`
- `AdPreview`
- `AdsArchiveResult`
- `AdsPixel`
- `CapiEventResponse`

## Tool Surface

### Ad Library

Read-only:

- `meta_search_ad_library`

Escopo:

- usar `ads_archive`
- suportar `search_terms`, `search_type`, `ad_reached_countries`, `ad_type`, `media_type`, `publisher_platforms`, `search_page_ids`, `languages` e paginação
- devolver resultados normalizados com snapshot URL, dados da página e metadados relevantes

### Audiences

Read:

- `meta_list_audiences`
- `meta_get_audience`

Write:

- `meta_create_custom_audience`
- `meta_create_lookalike_audience`
- `meta_update_audience`
- `meta_delete_audience`
- `meta_add_audience_users`
- `meta_remove_audience_users`
- `meta_replace_audience_users`

Modelagem:

- campos estáveis tipados
- regras e specs variáveis aceitas em JSON controlado
- `meta_update_audience` só deve expor campos realmente mutáveis

### Assets

Read:

- `meta_list_ad_images`
- `meta_get_ad_image`
- `meta_list_ad_videos`
- `meta_get_ad_video`
- `meta_get_ad_video_status`

Write:

- `meta_upload_ad_image`
- `meta_upload_ad_video`

Entrada de upload:

- aceitar exatamente uma origem entre `file_path`, `file_url` e `base64_data`
- validar tamanho, existência local e tipo MIME antes da chamada

### Creatives

Read:

- `meta_list_ad_creatives`
- `meta_get_ad_creative`

Write:

- `meta_create_ad_creative`
- `meta_update_ad_creative`

Regra:

- criação aceita campos tipados + blocos JSON livres para estruturas variáveis como `object_story_spec`
- update não deve prometer mutações estruturais que a Meta não suporta; foco em campos mutáveis como `name`

### Lead Forms

Read:

- `meta_list_lead_forms`
- `meta_get_lead_form`
- `meta_list_form_leads`
- `meta_get_lead`

Opcional no mesmo módulo:

- `meta_download_form_leads`

Regra:

- tools de formulário aceitam `page_access_token` explícito quando necessário
- leitura de `/{form_id}` e `/{form_id}/leads` funciona mesmo quando a listagem via página exigir token de página

### Previews

Read:

- `meta_get_ad_preview`
- `meta_get_creative_preview`

Regra:

- suportar preview de anúncio existente via `ad_id`
- suportar preview pré-publicação via `creative_id`
- devolver `body` bruto e variante resumida/truncada para uso em MCP

### Conversions

Write:

- `meta_send_conversion_event`
- `meta_send_conversion_events_batch`
- `meta_validate_conversion_payload`

Regra:

- envio exige `pixel_id` explícito
- MCP valida mínimo útil do payload, sem tentar reimplementar toda a validação da Meta
- batch deve expor sucesso parcial quando houver rejeições por item

## Data Flow And Contracts

Cada tool segue o padrão atual:

1. validar input com `zod`
2. resolver ativo e credencial
3. normalizar payload
4. chamar Graph API
5. retornar `content` textual + `structuredContent`

Resolução de contexto:

- `ad_account_id`, `page_id`, `form_id`, `creative_id`, `audience_id`, `pixel_id`
- `META_ACCESS_TOKEN` como padrão
- `page_access_token` por request quando a Meta exigir contexto de página

Regra de modelagem:

- parâmetros estáveis viram campos tipados
- payloads voláteis entram como JSON string ou objeto livre controlado

## Error Handling

O formatter de erros deve distinguir pelo menos:

- `missing_permission`
- `missing_asset_access`
- `wrong_token_type`
- `invalid_payload`
- `validation_error`
- `rate_limited`
- `unsupported_operation`

As mensagens precisam apontar a causa provável e o próximo passo, por exemplo:

- permissão do app ausente em `ads_archive`
- `Page Access Token` ausente em `leadgen_forms`
- `pixel_id` faltando em CAPI
- operação não suportada para mutação de creative

## Testing Strategy

Seguir o padrão atual com `node:test`, cobrindo:

- schemas e validação
- normalização de entradas
- construção de payload
- formatters de resposta
- classificação de erros

Cobrir com mocks HTTP:

- upload de imagem
- upload e status de vídeo
- listagem/criação de audiência
- criação de lookalike
- preview por `creative_id`
- leitura de lead form
- leitura de leads
- envio de evento CAPI

Também incluir cenários de:

- token inadequado
- JSON inválido
- permissão ausente
- sucesso parcial em batch

## Validated Constraints As Of March 31, 2026

Validação prática feita no workspace local com `META_API_VERSION=v25.0`:

- `/{ad_account_id}/adimages` respondeu com sucesso
- `/{ad_account_id}/advideos` respondeu com sucesso
- `/{ad_account_id}/customaudiences` respondeu com sucesso
- `/{ad_account_id}/adcreatives` respondeu com sucesso
- `/{ad_id}/previews` respondeu com sucesso
- `/{creative_id}/previews` respondeu com sucesso
- `/{form_id}` respondeu com sucesso
- `/{form_id}/leads` respondeu com sucesso
- `/{page_id}/leadgen_forms` pediu `Page Access Token`
- `/ads_archive` existe, mas o app atual não tem permissão para usar a operação

## Sources

- https://developers.facebook.com/docs/marketing-api/reference/ad-creative/
- https://developers.facebook.com/docs/graph-api/reference/ads_archive/
- https://developers.facebook.com/docs/marketing-api/conversions-api/
- https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/
