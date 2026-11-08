# Configurando o Instagram no servidor MCP

Guia para o Renato. São 7 passos, na ordem. Regras de ouro:

- **Nunca cole tokens ou o App Secret em chats, e-mails ou commits.** Eles ficam só no arquivo `.env` do servidor.
- **Pare e avise antes de continuar** se a Meta pedir App Review, se o objeto `instagram` do app já tiver um webhook apontando para outro lugar, ou se for preciso mexer em produção (Nginx, container).

## Passo 1. Dar acesso ao usuário de sistema

No Business Manager (Configurações do negócio > Usuários > Usuários do sistema), abra "Fama Brain Reader" e atribua:

- a Página "Fama Negócios Imobiliários";
- a conta do Instagram @renatofaria.imoveis.

Marque controle total ou, no mínimo, as permissões de conteúdo, mensagens, comunidade e métricas.

## Passo 2. Preparar o app FamaChat

No painel do app (developers.facebook.com):

1. Adicione os produtos **Instagram** (via Facebook Login) e **Webhooks**.
2. Habilite as permissões: `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata` e `pages_messaging`.
3. Confira que o acesso **Standard** basta. Para contas próprias a Meta indica Standard; Advanced só é preciso para contas de terceiros. **Se a Meta exigir App Review, pare e me avise.**

## Passo 3. Novo token do usuário de sistema

Gere um novo token do usuário de sistema com as permissões de anúncios atuais **mais** as do passo 2. No `.env` do servidor, troque `META_ACCESS_TOKEN` pelo novo valor (edite o arquivo direto no servidor; não envie o token por mensagem).

## Passo 4. Trocar o App ID e o App Secret

No `.env`, troque `META_APP_ID` e `META_APP_SECRET` pelos do app **FamaChat** (Configurações > Básico). Faça isso **antes** do passo 7: a ferramenta de inscrição consulta o app do token e se recusa a continuar se ele for diferente de `META_APP_ID`.

Confira também no `.env`: `META_IG_USER_ID`, `META_PAGE_ID`, `META_WEBHOOK_VERIFY_TOKEN` (um texto secreto qualquer que você inventa, por exemplo `openssl rand -hex 24`), `DATA_DIR` e `PUBLIC_BASE_URL`. Depois rode `scripts/deploy.sh` para reconstruir o container e carregar as variáveis (um `docker restart` não relê o `--env-file`).

## Passo 5. Liberar o acesso às mensagens

No app do Instagram (celular): Configurações > Mensagens e interações > **Ferramentas conectadas**, e ative o acesso às mensagens para ferramentas conectadas.

## Passo 6. Webhook do Instagram no app FamaChat

1. No painel, Webhooks, escolha o objeto **Instagram** e **veja se já existe uma URL de callback**. **Se existir e apontar para outro lugar, pare e me avise.** Não sobrescreva.
2. Se estiver vazio, informe:
   - URL de callback: `https://mcp-facebook-ads.famachat.com.br/webhooks/meta`
   - Verificar token: o mesmo valor de `META_WEBHOOK_VERIFY_TOKEN`
3. Assine os campos: `comments`, `live_comments`, `mentions`, `messages`, `messaging_postbacks`, `message_reactions`, `messaging_seen`, `messaging_referral` e `story_insights`.
4. O app precisa estar em modo **Live**.

## Passo 7. Inscrever a Página no app

A Meta entrega os eventos do Instagram (caminho Facebook Login) só depois que a Página é inscrita no app com os mesmos campos escolhidos no painel (`POST /{page-id}/subscribed_apps` com `subscribed_fields`). Use a ferramenta, que une os campos novos aos já existentes e **preserva `leadgen`** do CRM. Peça ao assistente:

```
meta_ig_subscribe_page com fields:
["comments","live_comments","mentions","messages","messaging_postbacks","message_reactions","messaging_seen","messaging_referral","story_insights"]
```

Depois rode `meta_ig_get_page_subscription` e confirme que `leadgen` continua na lista junto com os novos.

Se a Graph responder com o erro `#100` dizendo que algum nome de campo não é aceito em `subscribed_fields`, isso é seguro: a inscrição não foi alterada e `leadgen` continua preservado. Leia no próprio erro quais são os valores permitidos, tente novamente com um campo de Página válido e confirme outra vez com `meta_ig_get_page_subscription`.

> Confirmar na documentação atual: a página "Set up Instagram Webhooks" da Meta diz que os campos da inscrição são os escolhidos no painel e remete à tabela "Instagram webhook fields and permissions" para a lista; ela não fixa um único valor obrigatório. Os nomes acima vêm dessa tabela (conferida em 2026-11-08). Os campos de mensagens aparecem como "não disponíveis" para Facebook Login em uma das colunas e são cobertos pela Instagram Messaging API (Messenger Platform), por isso vale conferir no teste real que os eventos de Direct chegam.

## Teste ponta a ponta (combinar antes: publica de verdade)

1. Publicar e apagar um story de teste.
2. Comentar num post e ver o evento chegar a um destino de teste (`meta_ig_add_webhook_destination`, URL https).
3. Mandar um Direct e responder (só dentro de 24 h da última mensagem da pessoa).
