# Configuração direta do OAuth 2.1 com Auth0

Este guia descreve uma proteção direta do MCP usando Auth0 como Authorization Server. Em produção, o Meta Ads usa o gateway OAuth compartilhado com o AI Memory; para conectar o ChatGPT agora, siga [`docs/gateway-oauth-setup.md`](gateway-oauth-setup.md). A API key atual continua funcionando para clientes legados. Não cole tokens, client secrets ou valores do `.env` em chats, commits ou screenshots.

## 1. Criar a API no Auth0

No tenant Auth0 escolhido:

1. Crie uma API para o MCP.
2. Use como Identifier o valor que será colocado em `AUTH0_AUDIENCE` (um endereço HTTPS estável, por exemplo `https://mcp-facebook-ads.famachat.com.br` ou um identificador HTTPS dedicado).
3. Use assinatura **RS256**.
4. Crie a permissão `mcp:access` e habilite-a para o aplicativo/conexão que fará o login.
5. Mantenha a descoberta OIDC do tenant disponível em `https://<AUTH0_TENANT>/.well-known/openid-configuration`.

O Auth0 deve emitir o `aud` igual a `AUTH0_AUDIENCE`, o `iss` igual ao issuer com a barra final e o scope `mcp:access` (ou os scopes que você configurar).

## 2. Configurar o `.env`

No servidor, preencha:

```env
AUTH0_ISSUER=https://<AUTH0_TENANT>/
AUTH0_AUDIENCE=https://<MCP_AUDIENCE>
AUTH0_RESOURCE=https://mcp-facebook-ads.famachat.com.br
AUTH0_REQUIRED_SCOPES=mcp:access
```

`AUTH0_ISSUER` e `AUTH0_AUDIENCE` precisam ser informados juntos. O servidor valida assinatura RS256, issuer, audience, expiração e scopes usando o JWKS remoto do Auth0. A API key `API_KEY` permanece válida em paralelo.

Depois de editar o `.env`, rode `scripts/deploy.sh`; `docker restart` não relê o `--env-file` usado pelo deploy.

## 3. Conferir a descoberta do MCP

Com OAuth ativado, esta URL pública deve retornar JSON sem Bearer:

```text
https://mcp-facebook-ads.famachat.com.br/.well-known/oauth-protected-resource
```

Ela deve apontar `authorization_servers` para o issuer Auth0 e `resource` para `AUTH0_RESOURCE`. O endpoint de ferramentas continua sendo:

```text
https://mcp-facebook-ads.famachat.com.br/mcp
```

## 4. Conectar no ChatGPT

Na web do ChatGPT:

1. Abra **Plugins** → **Adicionar** → **Adicionar servidor MCP personalizado**.
2. Nome: `Fama Meta Ads e Instagram`.
3. URL: `https://mcp-facebook-ads.famachat.com.br/mcp`.
4. Escolha **OAuth**. Não escolha **No authentication** e não tente colar a API key: o ChatGPT precisa iniciar o fluxo OAuth.
5. Revise os scopes e confirme o aviso de risco.
6. No Auth0, permita o fluxo authorization code com **PKCE/S256**.
7. No aplicativo/registro OAuth do Auth0, cadastre exatamente o redirect que a tela de conexão do ChatGPT mostrar. Quando disponível, o redirect estável é `https://chatgpt.com/connector_platform_oauth_redirect`; versões que usam callback específico aparecem como `https://chatgpt.com/connector/oauth/<callback_id>`.
8. Conclua o login no Auth0 e aguarde a descoberta das ferramentas.

O ChatGPT envia o access token como `Authorization: Bearer ...` para `/mcp`. O MCP não recebe nem armazena o client secret do Auth0.

## 5. Teste seguro

Comece com uma leitura:

- peça para listar as ferramentas;
- chame `meta_list_ad_accounts`;
- confirme que uma chamada sem autorização retorna 401 e que a API key legada continua funcionando para os clientes antigos.

Não use publicação, envio de Direct ou alteração de campanhas como primeiro teste. Ações de escrita devem permanecer sob confirmação do cliente.

## Diagnóstico

- `/.well-known/oauth-protected-resource` retorna 404: OAuth não está ativado no `.env` ou o deploy ainda não foi executado.
- `401` com `WWW-Authenticate`: token ausente, issuer/audience incorretos, assinatura inválida, expirado ou sem `mcp:access`.
- `403` com API key: a API key legada está incorreta; OAuth válido continua sendo aceito quando configurado.
- Falha no login do ChatGPT: confira o issuer exato, o audience, o redirect exibido pelo ChatGPT, PKCE/S256 e se o scope foi permitido no Auth0.
