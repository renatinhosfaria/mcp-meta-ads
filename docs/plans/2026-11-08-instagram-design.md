# Design: ferramentas do Instagram no MCP Meta Ads

## Intenção

Renato quer que o MCP Meta Ads também opere a conta profissional do Instagram, não só os anúncios. Um assistente controlado por ele deve poder publicar conteúdo, acompanhar comentários e mensagens do Direct, responder e consultar tudo o que a API oficial expõe. O pedido foi "o mais completo possível": se a API oficial permite, o MCP deve oferecer.

O cliente que vai usar o MCP ainda não foi escolhido. Por isso, tudo o que envolve integração (avisos de eventos, envio de arquivos) precisa ser genérico e funcionar com qualquer cliente MCP.

## Metas

1. Cobrir tudo o que a API oficial do Instagram permite para a conta @renatofaria.imoveis:
   - publicar no feed (foto e carrossel), em reels e em stories;
   - listar e consultar publicações e stories ativos;
   - ler, responder, ocultar e apagar comentários, ligar e desligar comentários de um post e responder a um comentário por mensagem privada;
   - ler e enviar mensagens do Direct;
   - ver menções e marcações;
   - consultar métricas da conta e de cada publicação;
   - buscar hashtags;
   - consultar dados públicos de outras contas profissionais (business discovery);
   - ler o perfil (bio, site, seguidores e totais).
2. Receber da Meta, por webhook, cada comentário, mensagem do Direct, menção e resposta a story, e:
   - repassar cada evento na hora para os endereços que o cliente cadastrar, com assinatura;
   - guardar os eventos para o cliente consultar "o que há de novo" e marcar como visto.
3. Aceitar arquivos para publicação de três jeitos: link público, upload direto ao servidor e conteúdo embutido na chamada (só imagens pequenas).
4. Manter funcionando, sem mudança de comportamento, as 101 ferramentas de anúncios que já existem.

## Fora do escopo

- **Editar bio, nome, site ou foto do perfil.** A API oficial não permite. Ferramentas não oficiais que imitam o app não serão usadas, porque arriscam bloquear a conta.
- Contas pessoais, curtir, seguir e ler o feed de outras pessoas, porque a API não permite.
- A conta @renatosfaria, que também está no Business Manager. Por enquanto, só a @renatofaria.imoveis.
- Agendar publicações dentro do MCP. Quem agenda é o cliente, chamando a publicação na hora certa. **(minha escolha)**
- Avisar o Renato diretamente, por WhatsApp ou outro canal. Isso é papel do cliente, que recebe os webhooks do MCP.
- Etapa de confirmação no MCP antes de publicar ou responder. Quem controla é o assistente do Renato, e o MCP executa o que ele pedir.
- Publicações orgânicas na Página do Facebook.
- A tag "Human Agent" do Direct, que permite responder até 7 dias depois da última mensagem. Ela exige App Review da Meta e fica para depois. Sem ela, vale a janela de 24 horas.

## Anti-metas (seria um fracasso mesmo funcionando)

- Quebrar ou alterar o comportamento das ferramentas de anúncios atuais.
- Vazar segredos. **O repositório `renatinhosfaria/mcp-meta-ads` é público no GitHub:** tokens, segredos de app, chaves de assinatura e o `.env` nunca entram em commits, logs, respostas de ferramentas ou payloads de webhook.
- Perder eventos sem ninguém saber. Um evento que chegou da Meta precisa ficar guardado mesmo que todos os destinos estejam fora do ar.
- Deixar arquivos enviados acessíveis para sempre em links previsíveis.
- **Derrubar a entrada de leads do FamaChat.** A Página está inscrita no app com o campo `leadgen`, e o `POST /{page-id}/subscribed_apps` define a lista de campos inscritos. Qualquer inscrição feita pelo MCP precisa primeiro ler os campos atuais (`GET /{page-id}/subscribed_apps`) e enviar a lista unida, sem nunca remover `leadgen`.

## Situação atual (levantada em 08/11/2026)

- O servidor roda em Docker na VPS vmi2510860. O container `mcp-meta-ads` foi criado com `docker run` a partir da imagem `mcp-meta-ads:migrated-20260922`, com política de reinício `unless-stopped`, **sem volumes** e com a porta publicada em `127.0.0.1:3200`. O `docker-compose.yml` do repositório está em formato Swarm, com labels do Traefik e a imagem `mcp-facebook-ads:latest`, e não é o que roda hoje.
- O Nginx publica `mcp-facebook-ads.famachat.com.br` e encaminha **apenas** `= /health` e `= /mcp`. Qualquer outro caminho devolve 404. O limite padrão de corpo de requisição do Nginx é 1 MB.
- No Express (`src/app.ts`), `/health` fica antes do rate limiter (60 req/min, global) e do `authMiddleware` (Bearer `API_KEY`). Tudo o que é registrado depois passa pelos dois. O `/mcp` aceita JSON de até 1 MB.
- O token (`META_ACCESS_TOKEN`) é de um usuário de sistema, "Fama Brain Reader", gerado pelo app da Meta **"FamaChat"** (id `1600246764019855`). Ele tem só `ads_management`, `ads_read`, `business_management`, `leads_retrieval`, `public_profile` e `read_insights`, e não tem nenhuma Página atribuída.
- `META_APP_ID` e `META_APP_SECRET` do `.env` apontam para **outro** app, que a Meta responde com "API access blocked". O código não usa essas variáveis hoje.
- O Business Manager "Fama Negócios Imobiliários" é verificado. A Página "Fama Negócios Imobiliários" é dele e está ligada ao Instagram @renatofaria.imoveis. Os IDs ficam no `.env` de produção e não neste documento.
- O FamaChat (`/var/www/famachat`) recebe webhooks de leads da Página em `server/routes/webhooks/facebook-leads.routes.ts`. O handler ignora qualquer objeto que não seja `page` e qualquer campo que não seja `leadgen`, então eventos extras da Página não o quebram. Não foi possível confirmar por API se o app FamaChat já tem uma inscrição de webhook para o objeto `instagram`.
- Os testes usam `node:test` com `tsx` e montam o servidor com `InMemoryTransport` (veja `tests/meta-domain-expansion.test.ts`). O `package.json` não tem script de teste.

## Decisões

### Do Renato
- Cobrir tudo o que a API oficial permite. A bio fica de fora por limitação da API.
- Os avisos ao Renato são configurados no cliente. O MCP só entrega os eventos.
- O cliente ainda não foi escolhido, então a integração tem que ser genérica e ficar pronta.
- O cliente recebe os arquivos do Renato e os repassa ao MCP.
- Sem etapa de confirmação no MCP.
- Uma conta só por enquanto, a @renatofaria.imoveis.

### Minhas escolhas (o Renato pode mudar)
1. **Caminho da API: Instagram API com Facebook Login** (`graph.facebook.com`, mesma versão `META_API_VERSION`), usando o mesmo token de usuário de sistema, que não expira. A alternativa, Instagram Login, exigiria renovar o token a cada 60 dias.
2. **Um token só.** O `META_ACCESS_TOKEN` é regenerado no mesmo usuário de sistema e no mesmo app, com as permissões de anúncios atuais mais as de Instagram e Página. Para chamadas que exigem token de Página (Direct e resposta privada), o MCP obtém o token da Página com `GET /{page-id}?fields=access_token` e o guarda em memória.
3. **App da Meta para webhooks: o FamaChat**, que já é o app do token e pertence a um Business verificado. Hoje o FamaChat só usa o objeto `page` (leads). O objeto `instagram` aponta para o MCP. Se o FamaChat precisar de eventos do Instagram no futuro, ele pode virar um dos destinos de webhook do próprio MCP. `META_APP_ID` e `META_APP_SECRET` passam a ser os do FamaChat. **Se a configuração revelar uma inscrição do objeto `instagram` já apontando para outro lugar, pare e pergunte ao Renato.**
4. **Conta padrão por variável de ambiente**, como já acontece com `META_AD_ACCOUNT_ID`. Novas variáveis: `META_IG_USER_ID` e `META_PAGE_ID`. Toda ferramenta aceita `ig_user_id` opcional, que sobrescreve o padrão.
5. **Prefixo `meta_ig_`** nas ferramentas novas, seguindo o padrão `meta_` existente, com descrições em português como as atuais.
6. **Destinos de webhook gerenciados por ferramentas MCP** (cadastrar, listar, remover, testar) e guardados no banco. Assim o cliente se configura sozinho, sem acesso à VPS.
7. **Filtro opcional de conjuntos de ferramentas.** Com mais de 140 ferramentas no total, alguns clientes podem estourar o limite de ferramentas. Um parâmetro de query no `initialize`, por exemplo `/mcp?toolsets=instagram`, registra só um subconjunto. Sem parâmetro, o comportamento continua o de hoje: todas as ferramentas.
8. **Leitura direta da API como plano B** para "o que há de novo", caso os webhooks não estejam chegando. Fica como um parâmetro da ferramenta (por exemplo, `source: "api"`) e não como troca automática. É menos completo, porque não pega menções nem respostas a stories de forma confiável.
9. **Se a Meta exigir App Review** para alguma permissão ou para os webhooks em produção, o construtor para e avisa o Renato, que é quem envia a revisão. Não há como contornar isso por código.
10. **A implantação pode ter alguns segundos de indisponibilidade** ao recriar o container, como já acontece hoje em cada deploy.

## Como funciona

### Ferramentas novas (escopo mínimo, por grupo)

O construtor deve conferir cada item na documentação atual da Meta (v25 ou posterior) e incluir campos e opções que a API oferecer. Os grupos abaixo são o mínimo esperado.

**Conta e perfil (leitura)**
- Dados do perfil: username, nome, bio, site, foto, seguidores, seguindo e total de publicações.
- Contas do Instagram disponíveis via Business e Página.
- Limite de publicação em uso (`content_publishing_limit`).

**Publicação**
- Foto no feed: legenda, marcação de pessoas, local e texto alternativo.
- Carrossel: de 2 a 10 itens, misturando fotos e vídeos.
- Reels: legenda, capa ou `thumb_offset`, `share_to_feed`, colaboradores, nome do áudio e trial reels, se disponível.
- Story: foto ou vídeo.
- Fluxo da Meta: criar o contêiner, aguardar `status_code = FINISHED` e chamar `media_publish`. A ferramenta de publicação espera o processamento até um limite de tempo e, se ele estourar, devolve o ID do contêiner. Há também uma ferramenta para consultar o status e publicar depois.
- Vídeos grandes usam upload resumível (`upload_type=resumable`, `rupload.facebook.com`) quando o arquivo está no servidor, e `video_url` quando é um link público.

**Publicações**
- Listar publicações, ver detalhes (incluindo os itens de um carrossel), listar stories ativos, listar publicações em que a conta foi marcada e ligar ou desligar os comentários de um post.
- Apagar uma publicação **só se** a API atual suportar. O construtor confirma; se não suportar, a ferramenta não existe.

**Comentários**
- Listar comentários de uma publicação e as respostas de cada um.
- Responder, ocultar, mostrar de novo e apagar.
- Responder a um comentário por mensagem privada (private reply).

**Menções**
- Ler a publicação ou o comentário em que a conta foi mencionada, a partir dos IDs que chegam no webhook, e responder a comentários de menção.

**Direct**
- Listar conversas, ordenadas pela mais recente, e as mensagens de uma conversa.
- Ver o perfil de quem mandou (nome, username, foto, se segue a conta).
- Enviar texto, imagem, vídeo, áudio e figurinha de coração, reagir a uma mensagem e marcar como lida.
- Enviar respostas rápidas e templates que a API suportar.
- Configurar ice breakers e menu persistente.
- Quando a janela de 24 horas tiver fechado, o erro diz isso em linguagem clara.

**Métricas**
- Métricas da conta por período, incluindo dados demográficos de seguidores quando disponíveis.
- Métricas por publicação, com as métricas certas para cada tipo (feed, reels, story, carrossel).

**Descoberta**
- Buscar o ID de uma hashtag e listar as publicações mais populares e as recentes. A Meta limita a 30 hashtags diferentes a cada 7 dias, e a ferramenta deve deixar isso claro.
- Business discovery: dados e publicações públicas de outra conta profissional, pelo username.

**Eventos**
- `o que há de novo`: lista os eventos guardados ainda não vistos, com filtro por tipo e paginação por cursor.
- Marcar eventos como vistos.
- Cadastrar, listar, remover e testar destinos de webhook.
- Inscrever ou verificar a inscrição da Página no app (`subscribed_apps`), para ajudar na configuração.

As ferramentas novas seguem o padrão atual: `server.registerTool`, schema `zod` com `.strict()`, `annotations` corretas (`readOnlyHint`, `destructiveHint`), retorno `{ content, structuredContent }` e erros via `handleApiError`. O `handleApiError` ganha mensagens para erros típicos do Instagram: janela de 24 horas fechada, limite de publicação atingido, contêiner com erro de processamento e permissão de Instagram ausente.

### Webhooks de entrada (Meta para o MCP)
- Rota pública `GET` e `POST /webhooks/meta`, registrada **antes** do `authMiddleware` e do rate limiter global de `/mcp`, com rate limiter próprio e mais folgado.
- `GET`: responde ao desafio de verificação (`hub.mode`, `hub.verify_token`, `hub.challenge`) usando o `META_WEBHOOK_VERIFY_TOKEN`.
- `POST`: lê o corpo bruto e valida `X-Hub-Signature-256` (HMAC-SHA256 com `META_APP_SECRET`). Se a assinatura for inválida, responde 401 e não guarda nada.
- Grava cada mudança (`entry[].changes[]` e `entry[].messaging[]`) como um evento normalizado: id próprio, tipo, conta, data, IDs relevantes e payload original. A gravação é idempotente: se a Meta reenviar o mesmo evento, ele não é duplicado.
- Responde 200 rápido. O repasse para os destinos acontece depois, fora da requisição.
- Campos assinados no objeto `instagram`: `comments`, `live_comments`, `mentions`, `messages`, `messaging_postbacks`, `message_reactions`, `messaging_seen`, `messaging_referral` e `story_insights`, conforme a documentação atual.

### Webhooks de saída (MCP para o cliente)
- Cada evento guardado é enviado por `POST` para cada destino cadastrado, em JSON com versão do formato, id do evento, tipo, data e dados normalizados, mais o payload original da Meta.
- Assinatura em cabeçalho: HMAC-SHA256 de `timestamp.corpo` com um segredo próprio de cada destino, gerado no cadastro e mostrado uma única vez. O id do evento também vai em cabeçalho, para o cliente descartar repetidos.
- Entrega "pelo menos uma vez": reenvio com espera crescente por até cerca de 24 horas. Depois disso, o envio é marcado como falho, mas o evento continua disponível em "o que há de novo".
- A fila de entrega fica no banco e é retomada quando o servidor reinicia.
- Os destinos só aceitam HTTPS. **(minha escolha)**

### Arquivos para publicação
- **Link público:** a ferramenta repassa a URL para a Meta.
- **Upload direto:** `POST /uploads`, protegido pelo mesmo Bearer `API_KEY`. Aceita imagem ou vídeo até o maior limite da Meta para o tipo e devolve um `upload_id` para usar nas ferramentas de publicação. O corpo é gravado em disco por streaming, nunca inteiro na memória, porque o processo roda com `--max-old-space-size=384`.
- **Embutido:** base64 na própria chamada, só para imagens pequenas, porque o `/mcp` limita o corpo a 1 MB. Dá para reaproveitar `normalizeUploadSource` de `src/tools/assets.ts`.
- Para fotos (a Meta exige URL), o servidor publica o arquivo em `GET /media/<id-aleatório-longo>`, com links impossíveis de adivinhar e sem listagem.
- Os arquivos são apagados depois da publicação bem-sucedida ou, no máximo, em 48 horas. **(minha escolha)**

### Armazenamento
- Eventos, destinos, tentativas de entrega e metadados de upload ficam em um banco persistente. Sugestão: SQLite em um volume Docker montado em `/app/data`. Os arquivos enviados ficam no mesmo volume.
- O construtor escolhe a biblioteca. Restrições: a imagem é `node:20-alpine`, e um módulo nativo precisa compilar ou ter binário pronto para musl. Uma alternativa é atualizar a base para Node 22 e usar `node:sqlite`.
- Eventos vistos podem ser apagados depois de 90 dias. **(minha escolha)**

### Infraestrutura e implantação
- **Nginx:** adicionar `location = /webhooks/meta`, `location = /uploads` (com `client_max_body_size` suficiente para vídeos, sem buffer de requisição e com timeouts longos) e `location ^~ /media/`.
- **Docker:** recriar o container com o volume de dados e as novas variáveis de ambiente, preservando a porta `127.0.0.1:3200` e a política de reinício. Passar `GIT_SHA` e `BUILD_TIME` no build, para o `/health` identificar a versão. O comando usado deve ficar registrado no repositório, porque hoje o container real não bate com o `docker-compose.yml`.
- **Novas variáveis no `.env.example`:** `META_IG_USER_ID`, `META_PAGE_ID`, `META_WEBHOOK_VERIFY_TOKEN` e `DATA_DIR`, com placeholders e sem valores reais.

### Configuração na Meta (o Renato faz, com um passo a passo que o construtor escreve)
1. No Business Manager, dar ao usuário de sistema "Fama Brain Reader" acesso à Página "Fama Negócios Imobiliários" e à conta @renatofaria.imoveis, com permissão de conteúdo, mensagens, comunidade e métricas.
2. No app FamaChat:
   - adicionar o produto de Instagram (via Facebook Login) e o de Webhooks;
   - habilitar as permissões `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata` e `pages_messaging`;
   - conferir que o nível de acesso Standard basta. A Meta indica Standard Access para contas próprias e Advanced Access só para contas de terceiros.
3. Gerar um novo token do usuário de sistema com as permissões de anúncios atuais mais as novas, e trocar o `META_ACCESS_TOKEN`.
4. Trocar `META_APP_ID` e `META_APP_SECRET` pelos do app FamaChat.
5. No app do Instagram, em Configurações > Mensagens, ativar o acesso de ferramentas conectadas às mensagens.
6. Ainda no app FamaChat, conferir se o objeto `instagram` já tem webhook. Se não tiver, apontar para `https://mcp-facebook-ads.famachat.com.br/webhooks/meta` com o verify token e assinar os campos listados acima. O app precisa estar em modo Live.
7. Inscrever a Página no app pela ferramenta de eventos, que une os campos novos aos atuais e preserva `leadgen` (veja as anti-metas).

## Testes e verificação
- Testes automatizados no padrão atual (`node:test` + `tsx`) para:
  - cada grupo de ferramentas, com o axios simulado;
  - verificação de assinatura e desafio do webhook de entrada;
  - idempotência dos eventos;
  - assinatura, reenvio e desistência do webhook de saída;
  - upload com limite de tamanho, autenticação e expiração;
  - filtro de conjuntos de ferramentas.
- Adicionar o script `test` ao `package.json`.
- Antes de publicar, rodar build e testes, e confirmar que `tools/list` sem filtro continua trazendo as 101 ferramentas antigas mais as novas.
- Depois da configuração na Meta, fazer um teste real ponta a ponta, combinado antes com o Renato porque publica de verdade na conta:
  - publicar e apagar (ou arquivar manualmente) um story de teste;
  - comentar num post e ver o evento chegar a um destino de teste;
  - mandar um Direct e responder.

## O que fica com o construtor
- Nomes exatos das ferramentas, organização dos arquivos em `src/tools/` e como dividir os grupos.
- Biblioteca de banco, esquema das tabelas e agenda de reenvio.
- Formato exato do evento normalizado, desde que versionado e documentado.
- Limites de tempo da espera de processamento de vídeo.
- Documentar o formato dos webhooks de saída e o uso das ferramentas novas no `DOCUMENTATION.md`.
