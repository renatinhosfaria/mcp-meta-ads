# Conexão do Meta Ads pelo gateway OAuth

Em produção, o Meta Ads usa o mesmo gateway OAuth do AI Memory. O ChatGPT não deve conectar diretamente em `mcp-facebook-ads.famachat.com.br`.

## Conexão no ChatGPT

- URL MCP: `https://mcp-auth.famachat.com.br/mcp`
- Autenticação: **OAuth**
- Não informe a API key do Meta Ads no ChatGPT.

O gateway faz o login OAuth, emite o token do cliente e encaminha ao backend Meta Ads usando a API key interna. A API key nunca é enviada ao ChatGPT.

## Backend configurado

O gateway tem o backend `meta-ads`:

```yaml
backends:
  meta-ads:
    url: http://127.0.0.1:3200/mcp
    auth:
      type: bearer
      token: ${META_ADS_AUTH_TOKEN}
```

Por segurança, `META_ADS_AUTH_TOKEN` fica no `.env` protegido do gateway. A configuração ativa não deve ser copiada para o repositório.

As ferramentas aparecem com namespace do backend, por exemplo:

```text
meta-ads_meta_list_ad_accounts
meta-ads_meta_ig_get_profile
```

## Verificações

```bash
curl -fsS https://mcp-auth.famachat.com.br/healthz
curl -fsS https://mcp-auth.famachat.com.br/.well-known/oauth-protected-resource/mcp
curl -fsS https://mcp-auth.famachat.com.br/.well-known/oauth-authorization-server
```

Uma chamada sem OAuth para `/mcp` deve retornar `401`. O backend direto continua protegido pela API key e não deve ser exposto sem autenticação.

## AI Memory

O backend existente `ai-memory` permanece configurado no mesmo gateway. Adicionar `meta-ads` não substitui nem altera o backend AI Memory.
