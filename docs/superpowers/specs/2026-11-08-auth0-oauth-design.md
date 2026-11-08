# OAuth 2.1 com Auth0 para o MCP Meta Ads

## Intenção

Permitir que o ChatGPT conecte-se ao MCP remoto por OAuth 2.1 usando Auth0, sem remover a API key Bearer usada pelos clientes atuais. O MCP continuará sendo o resource server: Auth0 autentica o usuário e emite o access token; o MCP valida assinatura, issuer, audience, expiração e escopos antes de aceitar chamadas protegidas.

## Estado atual

`src/auth.ts` aceita somente `Authorization: Bearer <API_KEY>`. O middleware é aplicado pelo `createMetaAdsApp` antes de `/mcp` e das rotas protegidas de upload. As rotas públicas (health, webhook e media) passam antes dele. O Nginx encaminha apenas caminhos explícitos, então a descoberta OAuth também precisa de um bloco público no Nginx.

## Objetivos

- Adicionar validação de JWT RS256 do Auth0 com JWKS remoto e cache da biblioteca `jose`.
- Publicar `GET /.well-known/oauth-protected-resource` com `resource`, `authorization_servers`, `scopes_supported` e documentação.
- Responder 401 com `WWW-Authenticate: Bearer resource_metadata=...` quando OAuth estiver configurado e a chamada não tiver credencial válida.
- Aceitar a API key atual exatamente como antes, como caminho de compatibilidade.
- Configurar issuer, audience, resource e escopos por variáveis de ambiente, sem segredos no repositório.
- Testar a combinação API key/OAuth, falhas de JWT, escopos e descoberta pública.
- Documentar a configuração do tenant Auth0 e a conexão no ChatGPT.

## Fora do escopo

- Implementar um Authorization Server próprio ou armazenar usuários no MCP.
- Substituir o token da Meta, a API key existente ou as rotas públicas de webhook/media.
- Fazer o MCP emitir ou renovar tokens.
- Permitir chamadas sem autenticação quando OAuth estiver desconfigurado.
- Fazer ações reais no Instagram durante a validação.

## Abordagens consideradas

1. **OAuth próprio no MCP**: daria controle total, mas exigiria implementar login, consentimento, armazenamento de clientes, PKCE, rotação e descoberta. É superfície de segurança desnecessária.
2. **Proxy OAuth separado**: deixaria o código do MCP quase intacto, mas acrescentaria outro serviço, outro deploy e uma fronteira difícil de testar para `/mcp`, uploads e descoberta.
3. **Auth0 como Authorization Server e middleware no MCP (escolhida)**: mantém o MCP como resource server, usa JWKS e discovery padronizados, preserva API key e reduz o componente novo a configuração e validação de tokens. Auth0 fornece o fluxo OAuth 2.1/OIDC e registro compatível com clientes MCP.

## Desenho escolhido

### Configuração

`loadConfig` ganhará:

- `auth0Issuer?: string` de `AUTH0_ISSUER`, obrigatório junto com `AUTH0_AUDIENCE`;
- `auth0Audience?: string` de `AUTH0_AUDIENCE`;
- `auth0Resource: string` de `AUTH0_RESOURCE`, padrão `PUBLIC_BASE_URL`;
- `auth0Scopes: string[]` de `AUTH0_REQUIRED_SCOPES`, padrão `mcp:access` quando OAuth estiver ativo.

Issuer e audience parciais serão erro de configuração. Issuer, resource e audience precisam ser HTTPS. O valor do issuer será usado exatamente na validação de `iss`, preservando a barra final emitida pelo Auth0.

### Middleware

`authMiddleware` receberá configuração e um verificador injetável nos testes. A ordem será:

1. Se o Bearer corresponder à API key, aceitar imediatamente.
2. Se OAuth estiver ativo, validar o token com `createRemoteJWKSet` e `jwtVerify` (`RS256`, issuer e audience).
3. Exigir todos os escopos configurados, aceitando `scope` separado por espaços e `permissions` quando Auth0 os emitir.
4. Em falha, responder 401 sem revelar detalhes do token e incluir `WWW-Authenticate` apontando para a metadata do resource server.
5. Se OAuth estiver desativado, manter os status e mensagens atuais da API key.

O token nunca será logado, armazenado ou devolvido em respostas. A identidade validada ficará em `res.locals.auth` para futuras políticas, sem alterar as ferramentas atuais.

### Descoberta OAuth

A aplicação responderá `GET /.well-known/oauth-protected-resource` apenas quando OAuth estiver configurado:

```json
{
  "resource": "https://mcp-facebook-ads.famachat.com.br",
  "authorization_servers": ["https://<tenant>.auth0.com/"],
  "scopes_supported": ["mcp:access"],
  "resource_documentation": "https://mcp-facebook-ads.famachat.com.br/docs/instagram-setup"
}
```

O Nginx encaminhará esse caminho ao backend, antes do fallback 404. A descoberta Auth0 (`/.well-known/openid-configuration`) continua no tenant Auth0 e não será copiada para o MCP.

### Auth0 e ChatGPT

A configuração documentada criará uma API no Auth0 cujo identifier é `AUTH0_AUDIENCE`, habilitará scopes necessários e usará a conexão de login escolhida. O app/registro OAuth deverá aceitar authorization code + PKCE/S256, o parâmetro `resource` e os redirects mostrados pelo ChatGPT (preferencialmente `https://chatgpt.com/connector_platform_oauth_redirect` quando o tenant atender RFC 9207; caso contrário, o callback específico exibido pela conexão). O ChatGPT receberá o access token e o enviará como Bearer ao `/mcp`.

### Compatibilidade e rollout

O deploy será gradual: primeiro publicar código e metadata com OAuth desativado, configurar Auth0, validar discovery e JWT em staging/local, depois ativar `AUTH0_ISSUER`, `AUTH0_AUDIENCE` e `AUTH0_REQUIRED_SCOPES` no `.env` e rodar `scripts/deploy.sh`. A API key continuará aceitando clientes existentes. A validação final incluirá health, metadata pública, uma sessão ChatGPT e uma chamada de leitura; nenhuma publicação, mensagem ou comentário será usada como teste inicial.

## Riscos e decisões abertas

- O tenant Auth0, audience e conexão de login ainda precisam ser fornecidos pelo Renato; serão variáveis de ambiente, nunca gravadas no código.
- A escolha de scopes pode ser `mcp:access` único para a primeira conexão ou scopes separados de leitura/escrita. A implementação aceitará a lista configurada para não prender o desenho a um único modelo.
- Enquanto OAuth estiver desativado, não haverá mudança de comportamento. Se for ativado com issuer/audience errados, chamadas OAuth falharão 401, mas a API key continuará funcionando.

## Verificação

- Testes unitários do middleware com API key, JWT válido, issuer/audience incorretos, expiração, assinatura inválida e escopo ausente.
- Testes HTTP da metadata e do cabeçalho `WWW-Authenticate`.
- Build TypeScript e suíte completa.
- Depois da configuração Auth0: `curl` da metadata, sessão MCP por OAuth no ChatGPT, listagem de ferramentas e `meta_list_ad_accounts` somente leitura.

