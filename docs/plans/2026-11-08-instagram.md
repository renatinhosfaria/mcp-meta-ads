# Instagram no MCP Meta Ads: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** adicionar ao MCP Meta Ads cerca de 45 ferramentas `meta_ig_*` cobrindo a API oficial do Instagram, mais:
- webhooks de entrada (Meta para o MCP) e de saída (MCP para o cliente), com fila persistente;
- upload de arquivos para publicação;
- filtro `?toolsets=`.

**Arquitetura:**
- **Ferramentas:** em `src/tools/instagram/`, uma por área, registradas por `registerInstagramTools(server, deps)`.
- **Estado em disco:** eventos, destinos, entregas e uploads ficam em SQLite (`node:sqlite`), em `DATA_DIR`.
- **Rotas HTTP novas:**
  - `/webhooks/meta` e `/media/*`: públicas, montadas antes da autenticação;
  - `/uploads`: protegida pela mesma autenticação de `/mcp`.
- **Entrega dos webhooks:** um worker em processo entrega aos destinos com reenvio.

**Stack:** TypeScript (ESM, Node16), Express 4, `@modelcontextprotocol/sdk`, zod 3, axios, `node:sqlite`, `fetch` global e `node:test` + `tsx`.

**Spec:** `docs/plans/2026-11-08-instagram-design.md`. Leia antes de começar. O plano argumenta a partir dela.

## Restrições globais

- Branch `feat/instagram`. Nunca commitar em `main`. Não incluir nos commits as alterações já existentes de `.claude/settings.json` e `docs/meta-ads-mcp-server.code-workspace`.
- **Node e dependências:**
  - Node `>=22.13` (exigido por `node:sqlite`). A imagem Docker passa a ser `node:24-alpine` e `@types/node` vai para `^24`.
  - Nenhuma dependência de runtime nova: usar `node:sqlite`, `fetch` global e o que já está no `package.json`.
- **Comandos:**
  - testes: `npm test`, que roda `node --import tsx --test tests/*.test.ts`;
  - build: `npm run build`;
  - os dois precisam passar ao fim de cada task.
- **Graph API:** `META_BASE_URL` existente (`https://graph.facebook.com/${META_API_VERSION}`), hoje `v25.0`. Payloads de `POST` vão no corpo JSON (argumento `data` de `makeRequest`), não na query, exceto onde o plano disser o contrário.
- **Padrão das ferramentas:**
  - prefixo `meta_ig_`, descrições em português;
  - schema zod com `.strict()` e `annotations` corretas (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: true`);
  - retorno sempre por `toolResult` ou `toolError` (Task 3);
  - os registradores só usam `deps` dentro dos handlers, nunca no momento do registro. O teste da Task 2 registra com `{}`.
- **Contas padrão:** toda ferramenta aceita `ig_user_id` opcional, com padrão `META_IG_USER_ID`. As que usam a Página aceitam `page_id` opcional, com padrão `META_PAGE_ID`.
- **O repositório é público:**
  - nunca logar nem devolver tokens, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` ou segredos de destino;
  - a única exceção é o segredo de destino, mostrado uma vez, na resposta da criação;
  - nunca commitar valores reais de `.env`.
- **Inscrição da Página no app:** sempre une os campos atuais aos novos e nunca remove `leadgen`.
- **Uploads:**
  - tipos aceitos: `image/jpeg` até 8 MiB, `video/mp4` e `video/quicktime` até 300 MiB;
  - id com 32 caracteres base64url;
  - o arquivo some após a publicação bem-sucedida ou em 48 h.
- **Entrega de webhooks:**
  - destinos só `https://`;
  - esperas entre tentativas: `[30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000, 21_600_000, 43_200_000]` ms;
  - depois da última, a entrega fica `failed`.
- **Retenção:** eventos vistos são apagados após 90 dias.
- **Ferramentas de anúncios:** as 101 atuais continuam idênticas. `tools/list` sem `toolsets` traz todas, antigas e novas.
- **Pare e pergunte ao Renato** se:
  - a Meta exigir App Review;
  - o objeto `instagram` do app FamaChat já tiver webhook apontando para outro lugar;
  - for preciso mexer em produção (Nginx, container, configuração na Meta). A Task 13 tem pontos de parada explícitos.

## Foco da revisão

1. **Horário do evento:** a Meta manda `entry.time` em segundos em `changes` e `timestamp` em milissegundos em `messaging`. O `occurred_at` tem que sair certo nos dois casos. Teste na Task 10.
2. **Upload interrompido ou acima do limite no meio do envio:** apagar o arquivo parcial, não gravar registro e responder 413. Teste na Task 7.
3. **Foto PNG ou HEIC, comum vinda do celular:** responder 415 com mensagem clara pedindo JPEG, porque a Meta só publica JPEG. Teste na Task 7.
4. **Destino fora do ar por horas e servidor reiniciando no meio:** a entrega retoma do banco, termina `failed` depois da última tentativa, e o evento continua em `meta_ig_list_events`. Teste na Task 11.
5. **Vídeo ainda processando quando o tempo de espera acaba:** a ferramenta devolve `IN_PROGRESS` com `container_id` e **não** apaga o upload, para `meta_ig_publish_container` funcionar depois. Teste na Task 9.

---

### Task 1: Base (branch, Node 24, script de teste, config e banco)

**Arquivos:**
- Modificar: `package.json`, `Dockerfile` (as duas linhas `FROM`), `src/config.ts`, `tests/config.test.ts`
- Criar: `src/storage/database.ts`, `tests/storage-database.test.ts`

**Interfaces:**
- Produz:
  - `openDatabase(dataDir: string): DatabaseSync` (de `node:sqlite`);
  - campos novos em `loadConfig`: `metaAppSecret?: string`, `webhookVerifyToken?: string`, `dataDir: string`, `publicBaseUrl: string`.

- [ ] **Passo 1: Criar a branch e commitar spec e plano**

```bash
git switch -c feat/instagram
git add docs/plans/2026-11-08-instagram-design.md docs/plans/2026-11-08-instagram.md
git commit -m "docs: add Instagram design and implementation plan"
```

- [ ] **Passo 2: `package.json`**
  - script `"test": "node --import tsx --test tests/*.test.ts"`;
  - `engines.node` para `">=22.13"`;
  - `@types/node` para `^24`;
  - rodar `npm install`.

  No `Dockerfile`, trocar as duas linhas `FROM node:20-alpine` por `node:24-alpine`. Rodar `npm test` e conferir que tudo continua passando.

- [ ] **Passo 3: Escrever os testes que falham**

```ts
// tests/config.test.ts (acrescentar)
test('loadConfig applies Instagram defaults', () => {
  const c = loadConfig({ API_KEY: 'k' });
  assert.equal(c.dataDir, './data');
  assert.equal(c.publicBaseUrl, 'https://mcp-facebook-ads.famachat.com.br');
  assert.equal(c.metaAppSecret, undefined);
});
test('loadConfig strips trailing slash and rejects non-https PUBLIC_BASE_URL', () => {
  assert.equal(loadConfig({ API_KEY: 'k', PUBLIC_BASE_URL: 'https://x.test/' }).publicBaseUrl, 'https://x.test');
  assert.throws(() => loadConfig({ API_KEY: 'k', PUBLIC_BASE_URL: 'http://x.test' }), /PUBLIC_BASE_URL/);
});

// tests/storage-database.test.ts
test('openDatabase creates schema v1 and reopens idempotently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-db-'));
  const db = openDatabase(dir);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
  for (const t of ['events', 'destinations', 'deliveries', 'uploads']) assert.ok(tables.includes(t));
  db.close();
  const again = openDatabase(dir);
  assert.equal((again.prepare('PRAGMA user_version').get() as any).user_version, 1);
  again.close();
});
```

- [ ] **Passo 4: Rodar e ver falhar**

  Rodar `node --import tsx --test tests/config.test.ts tests/storage-database.test.ts`. O esperado é FAIL.

- [ ] **Passo 5: Implementar**

  Em `config.ts`, ler `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `DATA_DIR` e `PUBLIC_BASE_URL`, com os padrões dos testes.

  `openDatabase` faz:
  - `mkdirSync(dataDir, { recursive: true })`;
  - abre `${dataDir}/mcp.sqlite`;
  - executa `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000`;
  - se `user_version < 1`, aplica o esquema abaixo e grava `user_version = 1`, numa transação.

```sql
CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
  ig_user_id TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, seen_at TEXT,
  summary_json TEXT NOT NULL, raw_json TEXT NOT NULL);
CREATE INDEX events_unseen ON events(seen_at, seq);
CREATE TABLE destinations (id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT NOT NULL,
  event_types_json TEXT, description TEXT, created_at TEXT NOT NULL);
CREATE TABLE deliveries (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','delivered','failed')), attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL, last_error TEXT, PRIMARY KEY (event_id, destination_id));
CREATE INDEX deliveries_due ON deliveries(status, next_attempt_at);
CREATE TABLE uploads (id TEXT PRIMARY KEY, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
```

- [ ] **Passo 6: Rodar `npm test` e `npm run build`**

  Os dois precisam passar.

- [ ] **Passo 7: Commit**

  Mensagem: `feat: add sqlite storage and Instagram config`.

---

### Task 2: Filtro de toolsets e ligação do servidor

**Arquivos:**
- Criar: `src/toolsets.ts`, `src/tools/instagram/index.ts`, `tests/toolsets.test.ts`
- Modificar: `src/server.ts`, `src/app.ts` (o tipo `createServer` e o ramo de initialize)

**Interfaces:**
- Produz:
  - `TOOLSETS = ['ads', 'instagram'] as const`, `type Toolset`;
  - `parseToolsets(raw: unknown): Toolset[] | undefined`, que devolve `undefined` quando não há valor ou ele está vazio e lança `InvalidToolsetError` com valor desconhecido. Aceita string separada por vírgula, sem diferenciar maiúsculas e ignorando espaços;
  - `export interface InstagramDeps {}`, que as Tasks 7, 10 e 11 completam;
  - `registerInstagramTools(server: McpServer, deps: InstagramDeps): void`, que as tasks seguintes completam;
  - `createMcpServer(options: { toolsets?: Toolset[]; instagram?: InstagramDeps } = {})`;
  - em `CreateMetaAdsAppOptions`, `createServer(context: { toolsets?: Toolset[] }): TServer`.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
test('parseToolsets', () => {
  assert.equal(parseToolsets(undefined), undefined);
  assert.equal(parseToolsets(''), undefined);
  assert.deepEqual(parseToolsets(' Instagram , ads'), ['instagram', 'ads']);
  assert.throws(() => parseToolsets('ads,bogus'), InvalidToolsetError);
});
test('ads toolset keeps exactly the 101 existing tools', async () => {
  const names = await listToolNames(createMcpServer({ toolsets: ['ads'] }));
  assert.equal(names.length, 101);
  assert.ok(!names.some((n) => n.startsWith('meta_ig_')));
});
test('instagram toolset only registers meta_ig_ tools', async () => {
  const names = await listToolNames(createMcpServer({ toolsets: ['instagram'], instagram: {} as InstagramDeps }));
  assert.ok(names.every((n) => n.startsWith('meta_ig_')));
});
test('initialize with ?toolsets=bogus returns 400; ?toolsets=instagram reaches createServer', async () => { /* createMetaAdsApp com fakes, como em tests/session-http-lifecycle.test.ts */ });
```

`listToolNames` conecta um `Client` por `InMemoryTransport.createLinkedPair()` e chama `listTools()`.

- [ ] **Passo 2: Rodar e ver falhar**

  `node --import tsx --test tests/toolsets.test.ts`.

- [ ] **Passo 3: Implementar**

  - `createMcpServer` registra os 24 registradores de anúncios quando `toolsets` é `undefined` ou inclui `ads`. Registra `registerInstagramTools` quando inclui `instagram` (ou é `undefined`) **e** `options.instagram` existe.
  - Em `app.ts`, chamar `parseToolsets(req.query.toolsets)` antes de `options.createServer(...)`, só no ramo de initialize.
  - Para `InvalidToolsetError`, responder 400 com `{ jsonrpc: '2.0', error: { code: -32602, message: 'toolsets inválido: <valor>. Use: ads, instagram' }, id: null }`.
  - Em `index.ts`, ajustar a chamada para `createServer: ({ toolsets }) => createMcpServer({ toolsets })`. A ligação definitiva com o runtime fica para a Task 12.

- [ ] **Passo 4: Rodar `npm test` e `npm run build`**

  Os dois precisam passar.

- [ ] **Passo 5: Commit**

  Mensagem: `feat: add toolsets filter and Instagram registration hook`.

---

### Task 3: Base comum do Instagram

**Arquivos:**
- Criar: `src/instagram/context.ts`, `src/instagram/tool-helpers.ts`, `tests/helpers/graph-mock.ts`, `tests/instagram-core.test.ts`
- Modificar: `src/client.ts` (`handleApiError`: novo ramo **antes** de todos os outros)

**Interfaces:**
- Produz:
  - `resolveIgUserId(override?: string): string` e `resolvePageId(override?: string): string`. Leem `META_IG_USER_ID` e `META_PAGE_ID`, com erro em português quando faltam;
  - `getPageAccessToken(pageId: string): Promise<string>`: faz `GET {pageId}?fields=access_token` com o token do sistema e guarda em cache por 1 h;
  - `clearPageTokenCache(): void`;
  - `toolResult(data: unknown)`, que devolve `{ content: [{ type: 'text', text: toJson(data) }], structuredContent }`, onde `structuredContent` é o próprio objeto ou `{ items: data }` se for array;
  - `toolError(error: unknown)`, que devolve `{ isError: true, content: [{ type: 'text', text: handleApiError(error) }] }`;
  - fragmentos zod `igUserIdField`, `pageIdField` e `limitField(max: number, def: number)`;
  - para os testes, em `tests/helpers/graph-mock.ts`:
    - `captureTools(register)`, igual ao de `tests/meta-domain-expansion.test.ts`;
    - `type GraphCall = { method: string; url: string; params: Record<string, unknown>; data: unknown; headers: Record<string, string> }`;
    - `withGraphMock(responder: (call: GraphCall) => unknown, fn: (calls: GraphCall[]) => Promise<void>)`, que troca `axios.defaults.adapter`, define `META_ACCESS_TOKEN=test-token`, `META_IG_USER_ID=ig-1` e `META_PAGE_ID=page-1` e restaura tudo no fim. Se o responder lançar um `metaError(...)`, o adapter rejeita;
    - `metaError(code: number, subcode: number | undefined, message: string): AxiosError`.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
test('resolveIgUserId prefers override, then env, else Portuguese error', ...);
test('getPageAccessToken fetches once and caches', async () => withGraphMock(
  () => ({ access_token: 'page-token', id: 'page-1' }),
  async (calls) => {
    clearPageTokenCache();
    assert.equal(await getPageAccessToken('page-1'), 'page-token');
    await getPageAccessToken('page-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.fields, 'access_token');
  }));
test('handleApiError maps Instagram errors', () => {
  assert.match(handleApiError(metaError(10, 2534022, 'This message is sent outside of allowed window.')), /janela de 24 horas/);
  assert.match(handleApiError(metaError(9, 2207042, 'max posts')), /Limite de publicações/);
  assert.match(handleApiError(metaError(9007, 2207027, 'Media ID is not available')), /ainda não está pronta/);
  assert.match(handleApiError(metaError(10, undefined, 'requires instagram_content_publish permission')), /permissão de Instagram/);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

  `node --import tsx --test tests/instagram-core.test.ts`.

- [ ] **Passo 3: Implementar**

  Texto exato do ramo novo em `handleApiError`. Ele também casa a janela de 24 h pelo subcode 2018278 ou pela regex `/outside of allowed window/i`.
  - Janela de 24 h: `Erro: A janela de 24 horas para responder esta conversa no Direct já fechou. Só é possível responder depois que a pessoa mandar uma nova mensagem. Detalhes: ${detail}`
  - Limite de publicação: `Erro: Limite de publicações via API atingido nas últimas 24 horas. Consulte meta_ig_get_publishing_limit. Detalhes: ${detail}`
  - Mídia não pronta: `Erro: A mídia ainda não está pronta para publicar. Consulte meta_ig_get_container_status e tente de novo. Detalhes: ${detail}`
  - Permissão ausente (código 10 ou 200, mensagem com `/instagram/i`): `Erro: O token não tem a permissão de Instagram necessária. Veja docs/instagram-setup.md. Detalhes: ${detail}`

- [ ] **Passo 4: Rodar `npm test` e ver passar**

- [ ] **Passo 5: Commit**

  Mensagem: `feat: add Instagram context, tool helpers and error mapping`.

---

### Task 4: Ferramentas de conta e publicações

**Arquivos:**
- Criar: `src/tools/instagram/account.ts`, `src/tools/instagram/media.ts`, `tests/instagram-account-media.test.ts`
- Modificar: `src/tools/instagram/index.ts` (chamar os dois registradores)

**Interfaces:**
- Consome: tudo da Task 3, mais `makeRequest` e `paginate` de `src/client.ts`.
- Produz: `registerInstagramAccountTools(server)`, `registerInstagramMediaTools(server)` e `MEDIA_FIELDS` exportado de `media.ts`:

```
id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,is_comment_enabled,shortcode
```

| Ferramenta | Chamada |
|---|---|
| `meta_ig_get_profile` | `GET {ig}` com fields `id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count` |
| `meta_ig_list_accounts` | `GET {business_id ?? META_BUSINESS_ID}/owned_instagram_accounts` (fields `id,username`) mais `GET {page}` (fields `instagram_business_account{id,username}`), unidos sem repetir |
| `meta_ig_get_publishing_limit` | `GET {ig}/content_publishing_limit` com fields `config,quota_usage` |
| `meta_ig_list_media` | `paginate {ig}/media` com `MEDIA_FIELDS`, `since` e `until` opcionais (ISO, convertidos para unix), limite com padrão 25 e máximo 100 |
| `meta_ig_get_media` | `GET {media_id}` com `MEDIA_FIELDS + ',children{id,media_type,media_url,thumbnail_url}'` |
| `meta_ig_list_stories` | `paginate {ig}/stories` com `MEDIA_FIELDS` |
| `meta_ig_list_tagged_media` | `paginate {ig}/tags` com fields `id,caption,media_type,permalink,timestamp,username` |
| `meta_ig_set_comments_enabled` | `POST {media_id}` com corpo `{ comment_enabled: boolean }` |
| `meta_ig_delete_media` | **Só se** a documentação atual de IG Media listar `DELETE`. Se listar: `DELETE {media_id}`. Se não listar: não criar e anotar no `DOCUMENTATION.md` |

- [ ] **Passo 1: Escrever os testes que falham**

  - todos os nomes da tabela registrados, menos o condicional;
  - `meta_ig_get_profile` sem argumentos chama `.../ig-1` com `fields` contendo `biography`;
  - com `ig_user_id: 'ig-2'`, chama `.../ig-2`;
  - `meta_ig_set_comments_enabled({ media_id: 'm1', enabled: false })` faz `POST .../m1` com corpo `{ comment_enabled: false }`;
  - `meta_ig_list_media({ limit: 3 })` devolve no máximo 3 itens, mesmo que a resposta simulada traga 5.

- [ ] **Passo 2: Rodar e ver falhar**

  `node --import tsx --test tests/instagram-account-media.test.ts`.

- [ ] **Passo 3: Implementar os dois arquivos**

  Seguir a tabela, conferindo cada endpoint e campo na documentação atual da Meta.

- [ ] **Passo 4: Rodar `npm test` e ver passar**

- [ ] **Passo 5: Commit**

  Mensagem: `feat: add Instagram account and media tools`.

---

### Task 5: Comentários e menções

**Arquivos:**
- Criar: `src/tools/instagram/comments.ts`, `tests/instagram-comments.test.ts`
- Modificar: `src/tools/instagram/index.ts`

**Interfaces:**
- Consome: `getPageAccessToken` e `resolvePageId` (Task 3).
- Produz: `registerInstagramCommentTools(server)`.

| Ferramenta | Chamada |
|---|---|
| `meta_ig_list_comments` | `paginate {media_id}/comments` com fields `id,text,username,timestamp,like_count,hidden,parent_id,from{id,username},replies{id,text,username,timestamp,hidden}` |
| `meta_ig_list_comment_replies` | `paginate {comment_id}/replies` com fields `id,text,username,timestamp,like_count,hidden,from{id,username}` |
| `meta_ig_comment_on_media` | `POST {media_id}/comments` com `{ message }` |
| `meta_ig_reply_comment` | `POST {comment_id}/replies` com `{ message }` |
| `meta_ig_hide_comment` | `POST {comment_id}` com `{ hide: boolean }` |
| `meta_ig_delete_comment` | `DELETE {comment_id}` |
| `meta_ig_private_reply` | `POST {page}/messages` com o **token da Página** e `{ recipient: { comment_id }, message: { text } }` |
| `meta_ig_get_mention` | `GET {ig}` com fields `mentioned_media.media_id(<media_id>){id,caption,media_type,media_url,permalink,timestamp,username,like_count,comments_count}`; se vier `comment_id`, `mentioned_comment.comment_id(<comment_id>){id,text,timestamp,like_count,media{id,permalink}}` |
| `meta_ig_reply_mention` | `POST {ig}/mentions` com `{ media_id, comment_id?, message }` |

IDs usados dentro de expansão de campos (`media_id`, `comment_id`) precisam casar com `/^\d+$/`. Se não casarem, é erro de validação.

- [ ] **Passo 1: Escrever os testes que falham**

  - `private_reply` faz primeiro `GET page-1` (access_token) e depois `POST page-1/messages` com `params.access_token === 'page-token'` e corpo `{ recipient: { comment_id: 'c1' }, message: { text: 'Oi' } }`;
  - `hide_comment({ comment_id: 'c1', hide: true })` envia `{ hide: true }`;
  - `delete_comment` usa o método `DELETE`;
  - `get_mention({ media_id: '123' })` gera fields contendo `mentioned_media.media_id(123)`;
  - `get_mention({ media_id: '1){x}' })` é rejeitado pelo schema.

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

- [ ] **Passo 4: Rodar `npm test` e ver passar**

- [ ] **Passo 5: Commit**

  Mensagem: `feat: add Instagram comment and mention tools`.

---

### Task 6: Métricas e descoberta

**Arquivos:**
- Criar: `src/tools/instagram/insights.ts`, `src/tools/instagram/discovery.ts`, `tests/instagram-insights-discovery.test.ts`
- Modificar: `src/tools/instagram/index.ts`

**Interfaces:**
- Produz: `registerInstagramInsightTools(server)`, `registerInstagramDiscoveryTools(server)` e `defaultMediaMetrics(mediaProductType: string, mediaType: string): string[]`.

**Métricas padrão.** Conferir na documentação atual e remover o que a API recusar:

- **Conta:** `reach,views,accounts_engaged,total_interactions,likes,comments,shares,saves,replies,follows_and_unfollows,profile_links_taps`
- **Post do feed e carrossel:** `reach,views,likes,comments,shares,saved,total_interactions,profile_visits,follows`
- **Reels:** `reach,views,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time`
- **Story:** `reach,views,replies,shares,total_interactions,navigation,follows,profile_visits`

| Ferramenta | Chamada |
|---|---|
| `meta_ig_get_account_insights` | `GET {ig}/insights` com `{ metric, period: 'day', metric_type: 'total_value', since, until, breakdown? }`. O período padrão são os últimos 7 dias. Datas `YYYY-MM-DD` viram unix (segundos). Se o intervalo passar de 30 dias, devolver erro de validação em português |
| `meta_ig_get_follower_demographics` | `GET {ig}/insights` com `metric` igual a `follower_demographics` (ou `engaged_audience_demographics` quando `audience: 'engaged'`), `period: 'lifetime'`, `metric_type: 'total_value'`, `timeframe` (padrão `this_month`) e `breakdown` entre `age`, `gender`, `city` e `country` |
| `meta_ig_get_media_insights` | `GET {media_id}` (fields `media_type,media_product_type`) para escolher as métricas padrão, depois `GET {media_id}/insights` com `metric`. O parâmetro `metrics` substitui o padrão |
| `meta_ig_search_hashtag` | `GET ig_hashtag_search` com `{ user_id: ig, q }`. A descrição avisa do limite de 30 hashtags diferentes a cada 7 dias |
| `meta_ig_get_hashtag_media` | `GET {hashtag_id}/top_media` ou `/recent_media` (`edge: 'top' \| 'recent'`) com `{ user_id: ig, fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count' }` |
| `meta_ig_business_discovery` | `GET {ig}` com fields `business_discovery.username(<u>){id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,media.limit(<n>){id,caption,media_type,permalink,timestamp,like_count,comments_count}}`. O `username` precisa casar com `/^[A-Za-z0-9._]{1,30}$/` |

- [ ] **Passo 1: Escrever os testes que falham**

  - `defaultMediaMetrics('REELS', 'VIDEO')` inclui `ig_reels_avg_watch_time`;
  - `defaultMediaMetrics('STORY', 'IMAGE')` inclui `navigation`;
  - `get_media_insights` faz duas chamadas, a segunda com `metric` igual às métricas padrão de reels;
  - intervalo de 31 dias é rejeitado;
  - `business_discovery({ username: 'a){x}' })` é rejeitado;
  - `search_hashtag` envia `user_id: 'ig-1'`.

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

- [ ] **Passo 4: Rodar `npm test` e ver passar**

- [ ] **Passo 5: Commit**

  Mensagem: `feat: add Instagram insights and discovery tools`.

---

### Task 7: Uploads e origem de mídia

**Arquivos:**
- Criar: `src/uploads/upload-store.ts`, `src/uploads/upload-router.ts`, `src/instagram/media-source.ts`, `tests/uploads.test.ts`, `tests/helpers/instagram-deps.ts`
- Modificar: `src/tools/instagram/index.ts` (acrescentar `uploads: UploadStore` em `InstagramDeps`)

**Interfaces:**
- Consome: `openDatabase` (Task 1).
- Produz, em `upload-store.ts`:

```ts
export const UPLOAD_LIMITS: Record<string, { kind: 'image' | 'video'; ext: 'jpg' | 'mp4' | 'mov'; maxBytes: number }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg', maxBytes: 8 * 1024 * 1024 },
  'video/mp4': { kind: 'video', ext: 'mp4', maxBytes: 300 * 1024 * 1024 },
  'video/quicktime': { kind: 'video', ext: 'mov', maxBytes: 300 * 1024 * 1024 },
};
export const UPLOAD_TTL_MS = 48 * 60 * 60 * 1000;
export type UploadRecord = { id: string; fileName: string; path: string; mimeType: string; kind: 'image' | 'video';
  sizeBytes: number; createdAt: number; expiresAt: number };
export class UnsupportedMediaTypeError extends Error {}
export class UploadTooLargeError extends Error {}
export class UploadStore {
  constructor(opts: { db: DatabaseSync; dataDir: string; publicBaseUrl: string; now?: () => number });
  saveStream(source: Readable, mimeType: string): Promise<UploadRecord>;
  saveBuffer(buffer: Buffer, mimeType: string): Promise<UploadRecord>;
  get(id: string): UploadRecord | undefined;           // undefined se expirou ou não existe
  publicUrl(record: UploadRecord): string;             // `${publicBaseUrl}/media/${fileName}`
  remove(id: string): Promise<void>;
  purgeExpired(): Promise<number>;
}
```

- Produz também:
  - `createUploadRouter(uploads: UploadStore): express.Router`, com `POST /uploads`;
  - `createMediaRouter(uploads: UploadStore): express.Router`, com `GET /media/:fileName`;
  - em `media-source.ts`:
    - `type MediaInput = { url?: string; upload_id?: string; base64?: string }`;
    - `mediaInputSchema`, um objeto zod `.strict()` que exige exatamente uma das três origens;
    - `resolveMediaSource(input: MediaInput, expected: 'image' | 'video', uploads: UploadStore): Promise<{ url: string; upload?: UploadRecord }>`;
  - `createTestDeps(): { deps: InstagramDeps; dataDir: string }` em `tests/helpers/instagram-deps.ts`. Usa um diretório temporário e é ampliado nas Tasks 10 e 11.

**Comportamento:**
- `POST /uploads` recebe o corpo **bruto**, com `Content-Type` igual ao tipo do arquivo e cabeçalho opcional `X-Filename`, que fica só no log. O corpo é gravado em disco por streaming (`pipeline`), contando bytes. Se passar do limite, aborta, apaga o arquivo parcial e responde 413.
- Os arquivos ficam em `${dataDir}/uploads/`, com nome `${id}.${ext}`. O id sai de `randomBytes(24).toString('base64url')`.
- Respostas:
  - sucesso: `201 { upload_id, kind, size_bytes, expires_at (ISO) }`;
  - tipo não aceito: `415 { error: 'Tipo não suportado: <tipo>. A Meta só publica fotos em JPEG; converta antes de enviar. Vídeos: MP4 ou MOV.' }`.
- `GET /media/:fileName` só aceita `^[A-Za-z0-9_-]{32}\.(jpg|mp4|mov)$` e um registro que ainda não expirou. Fora disso, 404. Envia o arquivo com o `Content-Type` do registro.
- Em `resolveMediaSource`:
  - `base64` aceita só imagem e passa por `saveBuffer` com `image/jpeg`;
  - um `upload_id` de tipo diferente do esperado dá erro `O upload <id> é <tipo>, mas esta publicação precisa de <esperado>.`;
  - um `upload_id` inexistente dá erro `Upload <id> não encontrado ou expirado.`.

- [ ] **Passo 1: Escrever os testes que falham**

  **Store:**
  - um stream JPEG gera `kind: 'image'`, o arquivo existe e o tamanho confere;
  - um stream de 8 MiB + 1 dá `UploadTooLargeError`, sem arquivo em `uploads/` e sem linha na tabela (foco da revisão 2);
  - `image/png` dá `UnsupportedMediaTypeError` com mensagem que casa `/JPEG/` (foco da revisão 3);
  - com `now` avançado em 48 h + 1 ms, `get` devolve `undefined` e `purgeExpired()` devolve 1 e apaga o arquivo.

  **Router**, com um middleware de autenticação falso que deixa passar:
  - `POST /uploads` com `video/mp4` responde 201 com a forma descrita;
  - `GET /media/<fileName>` responde 200 com os mesmos bytes e `content-type: video/mp4`;
  - `GET /media/..%2Fmcp.sqlite` responde 404;
  - `GET /media/curto.jpg` responde 404.

  **`resolveMediaSource`:**
  - duas origens ao mesmo tempo são rejeitadas pelo schema;
  - um upload de vídeo pedido como imagem dá a mensagem de tipo diferente;
  - `base64` de imagem devolve uma `url` que começa com `https://` e termina em `.jpg`.

- [ ] **Passo 2: Rodar e ver falhar**

  `node --import tsx --test tests/uploads.test.ts`.

- [ ] **Passo 3: Implementar**

  Os três módulos e o helper de testes.

- [ ] **Passo 4: Rodar `npm test` e ver passar**

- [ ] **Passo 5: Commit**

  Mensagem: `feat: add media uploads with expiring public links`.

---

### Task 8: Direct

**Arquivos:**
- Criar: `src/tools/instagram/messaging.ts`, `tests/instagram-messaging.test.ts`
- Modificar: `src/tools/instagram/index.ts`

**Interfaces:**
- Consome: `getPageAccessToken` e `resolvePageId` (Task 3); `UploadStore` e `resolveMediaSource` (Task 7).
- Produz: `registerInstagramMessagingTools(server, deps: InstagramDeps)`.

Todas as chamadas usam o **token da Página**. Onde aparece `platform=instagram`, ele vai na query (`params`).

| Ferramenta | Chamada |
|---|---|
| `meta_ig_list_conversations` | `GET {page}/conversations` com `platform=instagram` e `fields=id,updated_time,participants,messages.limit(1){id,created_time,from,message}` |
| `meta_ig_get_conversation_messages` | `GET {conversation_id}` com fields `messages.limit(<n>){id,created_time,from,to,message,attachments,story,shares,reactions}`, n com padrão 25 e máximo 100 |
| `meta_ig_get_message` | `GET {message_id}` com os mesmos campos de mensagem |
| `meta_ig_get_user_profile` | `GET {igsid}` com fields `name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user` |
| `meta_ig_send_message` | `POST {page}/messages` com `{ recipient: { id }, message }`, onde `message` tem **exatamente um** destes conteúdos: `text` (aceita `quick_replies` com até 13 itens `{ title, payload }`); `attachment: { type: image\|video\|audio\|file, media: MediaInput }`, que vira `{ attachment: { type, payload: { url } } }`; `like_heart: true`, que vira `{ attachment: { type: 'like_heart' } }`; `generic_template.elements` com até 10 itens |
| `meta_ig_react_message` | `POST {page}/messages` com `{ recipient: { id }, sender_action: 'react' \| 'unreact', payload: { message_id, reaction: 'love' } }` |
| `meta_ig_send_sender_action` | `POST {page}/messages` com `{ recipient: { id }, sender_action: 'mark_seen' \| 'typing_on' \| 'typing_off' }` |
| `meta_ig_get_messaging_profile` | `GET {page}/messenger_profile` com `platform=instagram` e `fields=ice_breakers,persistent_menu` |
| `meta_ig_set_ice_breakers` | `POST {page}/messenger_profile` com `platform=instagram` e corpo `{ ice_breakers: [{ locale: 'default', call_to_actions: [{ question, payload }] }] }`, até 4 perguntas |
| `meta_ig_set_persistent_menu` | `POST {page}/messenger_profile` com `platform=instagram` e corpo `{ persistent_menu: [{ locale: 'default', call_to_actions: [...] }] }`, onde cada item é `{ type: 'postback', title, payload }` ou `{ type: 'web_url', title, url }` |
| `meta_ig_delete_messaging_profile_fields` | `DELETE {page}/messenger_profile` com `platform=instagram` e corpo `{ fields: [...] }`, com valores `ice_breakers` ou `persistent_menu` |

- [ ] **Passo 1: Escrever os testes que falham**

  - `send_message({ recipient_id: 'u1', text: 'Olá' })` faz `POST page-1/messages` com `params.access_token === 'page-token'` e corpo `{ recipient: { id: 'u1' }, message: { text: 'Olá' } }`;
  - `text` junto com `like_heart` é rejeitado;
  - `quick_replies` sem `text` é rejeitado;
  - um `attachment` com `upload_id` de imagem envia `payload.url` igual a `uploads.publicUrl(...)`;
  - um `metaError(10, 2534022, ...)` devolve `isError` com `/janela de 24 horas/`;
  - `set_ice_breakers` com 5 perguntas é rejeitado.

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

- [ ] **Passo 4: Rodar `npm test` e ver passar**

- [ ] **Passo 5: Commit**

  Mensagem: `feat: add Instagram Direct messaging tools`.

---

### Task 9: Publicação

**Arquivos:**
- Criar: `src/instagram/container.ts`, `src/tools/instagram/publishing.ts`, `tests/instagram-publishing.test.ts`
- Modificar: `src/tools/instagram/index.ts`

**Interfaces:**
- Consome: `resolveMediaSource` e `UploadStore` (Task 7); `getAccessToken` de `src/client.ts`.
- Produz:

```ts
export type ContainerStatusCode = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
export function createContainer(igUserId: string, body: Record<string, unknown>): Promise<string>;
export function createResumableVideoContainer(igUserId: string, body: Record<string, unknown>, upload: UploadRecord): Promise<string>;
export function getContainerStatus(containerId: string): Promise<{ status_code: ContainerStatusCode; status?: string }>;
export function waitForContainer(containerId: string, opts: { timeoutMs: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> }): Promise<{ status_code: ContainerStatusCode; status?: string }>;
export function publishContainer(igUserId: string, containerId: string): Promise<string>;
export type PublishOutcome =
  | { status: 'PUBLISHED'; media_id: string; permalink?: string }
  | { status: 'IN_PROGRESS'; container_id: string; message: string }
  | { status: 'ERROR'; container_id: string; detail: string };
export function runPublish(opts: { igUserId: string; containerId: string; waitSeconds: number; uploads: UploadRecord[];
  uploadStore: UploadStore; sleep?: (ms: number) => Promise<void> }): Promise<PublishOutcome>;
// src/tools/instagram/publishing.ts
export function registerInstagramPublishingTools(server: McpServer, deps: InstagramDeps): void;
```

**Regras:**
- `createResumableVideoContainer` faz `POST {ig}/media` com `{ ...body, upload_type: 'resumable' }`, recebe `{ id, uri }` e depois chama `axios.post(uri, createReadStream(upload.path), { headers: { Authorization: 'OAuth <token>', offset: '0', file_size: String(upload.sizeBytes) }, maxBodyLength: Infinity })`.
- `waitForContainer` consulta a cada `intervalMs`, com padrão de 3000, até `status_code !== 'IN_PROGRESS'` ou até estourar o tempo.
- `runPublish` espera o contêiner:
  - se ficar `FINISHED`, chama `publishContainer`, busca o `permalink`, faz `uploadStore.remove` de cada upload e devolve `PUBLISHED`;
  - se o tempo acabar com o contêiner ainda em `IN_PROGRESS`, devolve `IN_PROGRESS` com a mensagem `Ainda processando. Chame meta_ig_publish_container com este container_id em alguns instantes.`, **sem** remover uploads;
  - se o contêiner ficar `ERROR` ou `EXPIRED`, devolve `ERROR` com `status` em `detail`.
- `wait_seconds` tem padrão 45 e máximo 120.

| Ferramenta | Contêiner |
|---|---|
| `meta_ig_publish_photo` | `{ image_url, caption?, user_tags?: [{ username, x, y }], location_id?, alt_text? }` |
| `meta_ig_publish_carousel` | de 2 a 10 `items: [{ media_type: 'image' \| 'video', media }]`. Cada filho é criado com `is_carousel_item: true` (`image_url`, ou `media_type: 'VIDEO'` com `video_url`) e espera ficar `FINISHED`. O pai é `{ media_type: 'CAROUSEL', children: ids.join(','), caption?, location_id?, collaborators? }` |
| `meta_ig_publish_reel` | `{ media_type: 'REELS', caption?, cover_url? (a partir de cover: MediaInput de imagem), thumb_offset?, share_to_feed (padrão true), collaborators? (até 3), audio_name?, location_id?, user_tags?, trial_params? }`. Um `upload_id` usa o upload resumível; uma `url` usa `video_url` |
| `meta_ig_publish_story` | `{ media_type: 'STORIES' }` mais `image_url`, ou o vídeo (upload resumível com `upload_id`, `video_url` com `url`). Os campos de entrada são `story_media_type: 'image' \| 'video'` e `media` |
| `meta_ig_get_container_status` | `getContainerStatus` |
| `meta_ig_publish_container` | `waitForContainer` com no máximo 10 s e depois `publishContainer`. Remove os uploads que estavam associados a esse contêiner (ver abaixo) |

Para `meta_ig_publish_container` conseguir apagar os uploads depois, `runPublish` guarda o vínculo entre contêiner e uploads em memória (`Map<containerId, uploadIds[]>`). Se o servidor reiniciar, os uploads expiram sozinhos em 48 h.

- [ ] **Passo 1: Escrever os testes que falham**

  Usar `sleep` falso.
  - `publish_photo` com `url` faz, nesta ordem: `POST ig-1/media` com `{ image_url, caption }`; `GET <container>` com `fields=status_code,status`; `POST ig-1/media_publish` com `{ creation_id }`; `GET <media>` para o permalink. O resultado é `PUBLISHED`.
  - `publish_photo` com `upload_id`, depois de `PUBLISHED`, faz `uploads.get(id)` devolver `undefined`.
  - Com o status sempre `IN_PROGRESS` e `wait_seconds: 3`, o resultado é `IN_PROGRESS` com `container_id`, e o upload continua existindo (foco da revisão 5).
  - Com status `ERROR`, o resultado é `ERROR`, e o `detail` contém o `status` da Meta.
  - `publish_carousel` com 1 item é rejeitado. Com 2 itens, cria dois filhos com `is_carousel_item: true` e o pai com `children: 'c1,c2'`.
  - `publish_reel` com `upload_id` faz uma segunda chamada para o `uri` devolvido, com os cabeçalhos `offset: '0'` e `file_size`.

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar `container.ts` e depois `publishing.ts`**

- [ ] **Passo 4: Rodar `npm test` e ver passar**

- [ ] **Passo 5: Commit**

  Mensagem: `feat: add Instagram publishing tools`.

---

### Task 10: Eventos de entrada (Meta para o MCP)

**Arquivos:**
- Criar: `src/events/normalize.ts`, `src/events/event-store.ts`, `src/events/signature.ts`, `src/webhooks/meta-webhook-router.ts`, `tests/events-inbound.test.ts`
- Modificar: `src/tools/instagram/index.ts` (acrescentar `events: EventStore` em `InstagramDeps`), `tests/helpers/instagram-deps.ts`

**Interfaces:**
- Produz:

```ts
export type EventType = 'comment' | 'live_comment' | 'mention' | 'story_insights' | 'message' | 'message_echo'
  | 'message_reaction' | 'message_read' | 'postback' | 'referral' | 'unknown';
export type NormalizedEvent = { id: string; version: 1; type: EventType; ig_user_id: string; occurred_at: string;
  received_at: string; summary: Record<string, unknown>; raw: unknown };
export function normalizeMetaWebhook(payload: unknown, receivedAt: Date): NormalizedEvent[];
export function toIsoTimestamp(value: number | undefined, fallback: Date): string; // valor < 1e12 é tratado como segundos
export class EventStore {
  constructor(db: DatabaseSync);
  insert(event: NormalizedEvent): boolean;                       // false quando o id já existe
  get(id: string): NormalizedEvent | undefined;
  listUnseen(opts: { types?: EventType[]; afterSeq?: number; limit: number }):
    { events: Array<NormalizedEvent & { seq: number }>; next_cursor: number | null };
  markSeen(ids: string[], at?: Date): number;
  purgeSeen(olderThanDays: number, now?: Date): number;
}
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean;
export function signPayload(secret: string, timestamp: string, body: string): string; // 'sha256=' + hex HMAC de `${timestamp}.${body}`
export function createMetaWebhookRouter(deps: { verifyToken?: string; appSecret?: string; events: EventStore;
  onEventStored: (event: NormalizedEvent) => void; now?: () => Date }): express.Router;
```

**Regras:**
- **Id do evento:** `sha256(entryId + '|' + field + '|' + JSON.stringify(item))`, com os 32 primeiros caracteres hex.
- **Mapeamento de `changes[].field`:**
  - `comments` vira `comment`, e `live_comments` vira `live_comment`. O `summary` é `{ comment_id, text, from_id, from_username, media_id, parent_id }`;
  - `mentions` vira `mention`, com `summary` `{ media_id, comment_id }`;
  - `story_insights` vira o tipo de mesmo nome, com `summary` igual a `value`.
- **Mapeamento de `messaging[]`:**
  - `message` com `is_echo` vira `message_echo`; sem `is_echo`, vira `message`;
  - `reaction` vira `message_reaction`; `read` vira `message_read`; `postback` e `referral` mantêm o nome;
  - o `summary` é `{ sender_id, recipient_id, mid, text, attachments: [{ type, url }] }`.
- **Objeto diferente de `instagram`:** a função devolve `[]`.
- **Router:** monta `GET` e `POST /webhooks/meta` com `express.raw({ type: '*/*', limit: '1mb' })` e um limitador próprio de 600 req/min.
  - `GET`: se `verifyToken` não estiver configurado, responde 503. Com `hub.mode=subscribe` e `hub.verify_token` correto, responde 200 com `hub.challenge`. Caso contrário, 403.
  - `POST`: se `appSecret` não estiver configurado, responde 503. Com assinatura inválida, 401. Senão, normaliza, chama `insert` em cada evento, chama `onEventStored` só nos que foram inseridos e responde `200 'EVENT_RECEIVED'`.

- [ ] **Passo 1: Escrever os testes que falham**

  **Funções:**
  - `toIsoTimestamp(1731000000, x)` e `toIsoTimestamp(1731000000000, x)` dão o mesmo ISO (foco da revisão 1);
  - um payload de comentário real (exemplo da documentação da Meta) gera 1 evento `comment` com `summary.text`;
  - uma mensagem com `is_echo: true` vira `message_echo`;
  - `{ object: 'page' }` gera `[]`.

  **Store:**
  - inserir o mesmo evento duas vezes dá `true` e depois `false`;
  - `listUnseen` pagina por `afterSeq`;
  - `markSeen` tira o evento de `listUnseen`;
  - `purgeSeen(90)` apaga um evento visto há 91 dias e mantém um não visto de 91 dias.

  **Router:**
  - o desafio responde 200 com o token certo, 403 com o errado e 503 sem configuração;
  - um `POST` com assinatura errada responde 401 e não grava nada;
  - um `POST` válido enviado duas vezes deixa 1 evento e chama `onEventStored` uma vez.

- [ ] **Passo 2: Rodar e ver falhar**

  `node --import tsx --test tests/events-inbound.test.ts`.

- [ ] **Passo 3: Implementar**

  Os quatro módulos.

- [ ] **Passo 4: Rodar `npm test` e ver passar**

- [ ] **Passo 5: Commit**

  Mensagem: `feat: receive and store Meta Instagram webhooks`.

---

### Task 11: Entrega aos destinos e ferramentas de eventos

**Arquivos:**
- Criar: `src/events/destinations.ts`, `src/events/delivery.ts`, `src/events/api-poll.ts`, `src/tools/instagram/events.ts`, `tests/events-delivery.test.ts`
- Modificar: `src/tools/instagram/index.ts` (acrescentar `destinations` e `delivery` em `InstagramDeps`), `tests/helpers/instagram-deps.ts`

**Interfaces:**
- Consome: `EventStore`, `NormalizedEvent`, `EventType` e `signPayload` (Task 10).
- Produz:

```ts
export type Destination = { id: string; url: string; event_types: EventType[] | null; description: string | null; created_at: string };
export class DestinationStore {
  constructor(db: DatabaseSync);
  add(input: { url: string; event_types?: EventType[]; description?: string }): { destination: Destination; secret: string }; // lança erro se não for https
  list(): Destination[];                                   // nunca inclui o segredo
  remove(id: string): boolean;
  getWithSecret(id: string): (Destination & { secret: string }) | undefined;
  activeFor(type: EventType): Array<Destination & { secret: string }>;
}
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000, 21_600_000, 43_200_000];
export type Sender = (url: string, init: { headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<{ status: number }>;
export class DeliveryWorker {
  constructor(opts: { db: DatabaseSync; destinations: DestinationStore; events: EventStore; send?: Sender;
    now?: () => number; log?: (line: string) => void });
  enqueue(event: NormalizedEvent): number;                 // uma linha por destino ativo para o tipo
  tick(): Promise<{ delivered: number; retried: number; failed: number }>;
  sendTest(destinationId: string): Promise<{ ok: boolean; status?: number; error?: string }>;
  start(intervalMs?: number): void;                        // padrão 5000; o timer usa unref()
  stop(): void;
}
export function pollRecentActivity(opts: { igUserId: string; pageId: string; since: Date; mediaLimit?: number }): Promise<NormalizedEvent[]>;
export function registerInstagramEventTools(server: McpServer, deps: InstagramDeps): void;
```

**Regras:**
- **Segredo do destino:** `'whsec_' + randomBytes(32).toString('base64url')`.
- **Envio:** `POST` com corpo `{"version":1,"attempt":n,"event":<NormalizedEvent>}` e os cabeçalhos:
  - `Content-Type: application/json`;
  - `X-Meta-MCP-Event-Id`;
  - `X-Meta-MCP-Timestamp` (unix em segundos);
  - `X-Meta-MCP-Signature: signPayload(secret, timestamp, body)`.
- **Resultado:** resposta 2xx marca `delivered`. Qualquer outra resposta, ou erro, incrementa `attempts` e agenda a próxima tentativa com `RETRY_DELAYS_MS[attempts-1]`. Quando não há mais espera na lista, marca `failed` e grava `last_error`.
- **Lote:** `tick` processa até 50 entregas vencidas e com `status='pending'`, por ordem de `next_attempt_at`.
- **Sender padrão:** `fetch` com `AbortSignal.timeout(10_000)`.
- **`pollRecentActivity`:**
  - busca as últimas `mediaLimit` publicações (padrão 10) com `comments.limit(50){id,text,username,timestamp,parent_id}` e filtra por `since`;
  - busca as conversas com o token da Página, `platform=instagram`, `fields=id,updated_time,messages.limit(10){id,created_time,from,message}`, e filtra por `since`;
  - os eventos ganham id `'api:' + <id da Meta>` e não são gravados.

| Ferramenta | Comportamento |
|---|---|
| `meta_ig_list_events` | `{ source?: 'store' \| 'api' (padrão store), types?, cursor?, limit? (padrão 50, máximo 200), since? (só com api, padrão 24 h atrás) }` |
| `meta_ig_mark_events_seen` | `{ event_ids }` (até 500), devolve `{ marked }` |
| `meta_ig_add_webhook_destination` | devolve `{ destination, secret, aviso: 'Guarde este segredo agora: ele não será mostrado de novo.' }` |
| `meta_ig_list_webhook_destinations` | `list()`, mais contagem de entregas `pending` e `failed` por destino |
| `meta_ig_remove_webhook_destination` | `remove()` |
| `meta_ig_test_webhook_destination` | `sendTest()`, com um evento sintético `type: 'unknown'` e `summary: { test: true }`, sem gravar |
| `meta_ig_get_page_subscription` | `GET {page}/subscribed_apps` (token da Página) |
| `meta_ig_subscribe_page` | `{ fields: string[] (obrigatório), page_id? }`. Lê os campos atuais do app cujo `id === META_APP_ID` (sem `META_APP_ID`, erro em português), une com os pedidos e faz `POST {page}/subscribed_apps` com `params.subscribed_fields = união.join(',')`. Devolve antes e depois |

- [ ] **Passo 1: Escrever os testes que falham**

  **Destinos:**
  - `add` com `http://` lança erro;
  - `list()` não contém `secret`.

  **Fila:**
  - com 2 destinos (um filtrando `['message']`), `enqueue` de um `comment` cria 1 linha.

  **Envio e tentativas:**
  - um `tick` com sucesso deixa a entrega `delivered`, e `verify(signPayload(secret, ts, body)) === header`;
  - uma falha deixa `attempts=1` e `next_attempt_at = now + 30_000`;
  - nove falhas seguidas, avançando o `now`, deixam a entrega `failed`, e o evento continua em `listUnseen` (foco da revisão 4);
  - um `DeliveryWorker` **novo** sobre o mesmo banco entrega uma linha `pending` vencida (retomada após reinício, foco da revisão 4).

  **Inscrição da Página:**
  - `subscribe_page({ fields: ['feed'] })` com o atual `['leadgen']` envia `subscribed_fields: 'leadgen,feed'`;
  - `subscribe_page({ fields: [] })` nunca envia uma lista sem `leadgen`.

  **Leitura direta:**
  - `list_events({ source: 'api' })` com a Graph simulada devolve ids que começam com `api:`.

- [ ] **Passo 2: Rodar e ver falhar**

  `node --import tsx --test tests/events-delivery.test.ts`.

- [ ] **Passo 3: Implementar**

- [ ] **Passo 4: Rodar `npm test` e ver passar**

- [ ] **Passo 5: Commit**

  Mensagem: `feat: deliver Instagram events to webhook destinations`.

---

### Task 12: Ligar tudo no servidor e documentar

**Arquivos:**
- Criar: `src/instagram/runtime.ts`, `tests/instagram-runtime.test.ts`, `docs/instagram-setup.md`
- Modificar: `src/app.ts` (opções `publicRoutes` e `protectedRoutes`), `src/index.ts`, `.env.example`, `DOCUMENTATION.md`

**Interfaces:**
- Produz:

```ts
export type InstagramRuntime = { deps: InstagramDeps; db: DatabaseSync; publicRoutes: express.Router[];
  protectedRoutes: express.Router[]; start(): void; stop(): Promise<void> };
export function createInstagramRuntime(cfg: { dataDir: string; publicBaseUrl: string; appSecret?: string;
  verifyToken?: string }): InstagramRuntime;
```

- Em `CreateMetaAdsAppOptions`:
  - `publicRoutes?: RequestHandler[]`, montadas depois de `helmet` e do logger e **antes** do `rateLimiter`;
  - `protectedRoutes?: RequestHandler[]`, montadas depois do `authMiddleware` e antes de `/mcp`.

**Regras:**
- `publicRoutes` são o webhook e o media router; `protectedRoutes`, o upload router.
- O webhook router recebe `onEventStored: (event) => delivery.enqueue(event)`.
- `start()` liga `delivery.start(5000)`, `uploads.purgeExpired()` a cada 15 min e `events.purgeSeen(90)` a cada 24 h, todos com `unref()`.
- `stop()` para os timers e fecha o banco.
- `index.ts`:
  - cria o runtime com os dados de `config`;
  - passa as rotas para o app e `createServer: ({ toolsets }) => createMcpServer({ toolsets, instagram: runtime.deps })`;
  - chama `runtime.start()` depois do `listen` e `runtime.stop()` no shutdown;
  - registra no log se `META_APP_SECRET` ou `META_WEBHOOK_VERIFY_TOKEN` estiverem ausentes, só os nomes e nunca os valores.

- [ ] **Passo 1: Escrever os testes que falham**

  - Com um app montado com rotas públicas e protegidas e um `authMiddleware` falso que responde 401, `GET /media/x` responde 404 (rota pública, sem 401) e `POST /uploads` responde 401.
  - Um teste integrado com `createInstagramRuntime` num diretório temporário e um servidor HTTP local de destino:
    - um webhook assinado chega a `/webhooks/meta`;
    - `meta_ig_list_events` devolve o evento;
    - depois de `tick()`, o destino recebeu `X-Meta-MCP-Signature` válida.
  - `tools/list` sem `toolsets` e com deps tem 101 ferramentas sem o prefixo `meta_ig_` e todas as `meta_ig_*` das Tasks 4 a 11.

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar a ligação**

- [ ] **Passo 4: Rodar `npm test` e `npm run build`**

  Os dois precisam passar.

- [ ] **Passo 5: Documentação**

  - **`.env.example`:** acrescentar `META_IG_USER_ID`, `META_PAGE_ID`, `META_WEBHOOK_VERIFY_TOKEN`, `DATA_DIR=/app/data` e `PUBLIC_BASE_URL`, todos com placeholders.
  - **`DOCUMENTATION.md`, seção "Instagram":**
    - lista das ferramentas;
    - `?toolsets=`;
    - upload com `curl --data-binary @video.mp4 -H 'Content-Type: video/mp4' -H 'Authorization: Bearer …' https://…/uploads`;
    - formato do webhook de saída;
    - como verificar a assinatura (exemplo em Node);
    - limites (JPEG, 8 MiB e 300 MiB; 48 h; janela de 24 h; 30 hashtags a cada 7 dias).
  - **`docs/instagram-setup.md`, em português e para o Renato:** os 7 passos da seção "Configuração na Meta" da spec, com:
    - o campo de inscrição da Página que a documentação atual da Meta exige para os webhooks do Instagram, confirmado e com o comando de `meta_ig_subscribe_page` correspondente;
    - o aviso para parar se o objeto `instagram` já tiver outro webhook.

- [ ] **Passo 6: Commit**

  Mensagem: `feat: wire Instagram runtime and document setup`.

---

### Task 13: Implantação e verificação em produção

**Arquivos:**
- Modificar: `Dockerfile` (antes de `USER node`: `RUN mkdir -p /app/data && chown node:node /app/data`), `DOCUMENTATION.md` (seção de deploy)
- Criar: `scripts/deploy.sh`, `deploy/nginx/mcp-facebook-ads.locations.conf`

**`scripts/deploy.sh`** usa `set -euo pipefail` e faz, em ordem:
1. Guarda a imagem atual em `PREV_IMAGE=$(docker inspect -f '{{.Config.Image}}' mcp-meta-ads)`.
2. Roda `docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) --build-arg BUILD_TIME=$(date -u +%FT%TZ) --build-arg DEPLOYMENT_ID=<sha>-<epoch> -t mcp-meta-ads:<sha> .`.
3. Roda `docker volume create mcp-meta-ads-data`.
4. Roda `docker stop mcp-meta-ads && docker rm mcp-meta-ads`.
5. Roda `docker run -d --name mcp-meta-ads --restart unless-stopped --env-file .env -e DATA_DIR=/app/data -p 127.0.0.1:3200:3200 -v mcp-meta-ads-data:/app/data mcp-meta-ads:<sha>`.
6. Espera até 60 s por `curl -fsS http://127.0.0.1:3200/health`. Se não responder, mostra `docker logs --tail 50`, recria o container com `$PREV_IMAGE` e termina com `exit 1`.

**`deploy/nginx/mcp-facebook-ads.locations.conf`** tem os três blocos, com os mesmos `proxy_set_header` de `/mcp`:
- `location = /webhooks/meta`: `proxy_pass http://127.0.0.1:3200/webhooks/meta`, `client_max_body_size 2m`;
- `location = /uploads`: `proxy_pass http://127.0.0.1:3200/uploads`, `client_max_body_size 310m`, `proxy_request_buffering off`, `proxy_read_timeout 300s`, `proxy_send_timeout 300s`;
- `location ^~ /media/`: `proxy_pass http://127.0.0.1:3200`.

- [ ] **Passo 1: Criar os arquivos e testar o build**

  Criar `Dockerfile`, `scripts/deploy.sh` e o snippet do Nginx. Rodar `bash -n scripts/deploy.sh` e `docker build -t mcp-meta-ads:test .`. O esperado é sintaxe ok e build concluído.

- [ ] **Passo 2: Commit**

  Mensagem: `chore: add deploy script and nginx locations for Instagram`.

- [ ] **Passo 3: Parada (confirmar com o Renato)**

  Pedir confirmação antes de mexer em produção, informando:
  - o container vai ser recriado, com alguns segundos fora do ar;
  - o Nginx vai ganhar três `location`.

  Só seguir com o "sim" dele.

- [ ] **Passo 4: Nginx**

  Inserir os três blocos em `/etc/nginx/sites-available/mcp-facebook-ads.famachat.com.br`, antes de `location / { return 404; }`, e guardar uma cópia `.bak-<data>`. Rodar `nginx -t && systemctl reload nginx`. O esperado é `syntax is ok` e o reload sem erro.

- [ ] **Passo 5: Deploy**

  Acrescentar ao `.env` de produção `DATA_DIR=/app/data` e `META_WEBHOOK_VERIFY_TOKEN` (gerar com `openssl rand -hex 24`), sem mostrar o valor. Rodar `scripts/deploy.sh`.

  Conferir que:
  - `/health` local e público respondem 200 com `git_sha` igual ao commit;
  - uma sessão MCP de verificação (como a de 08/11) traz 101 ferramentas sem `meta_ig_` mais as novas;
  - `meta_list_ad_accounts` continua funcionando;
  - `curl -s -o /dev/null -w '%{http_code}' 'https://mcp-facebook-ads.famachat.com.br/webhooks/meta?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1'` devolve `403`.

- [ ] **Passo 6: Parada (configuração na Meta pelo Renato)**

  Entregar `docs/instagram-setup.md` e esperar o Renato concluir. Se ele relatar App Review obrigatório ou um webhook `instagram` já existente apontando para outro lugar, parar e decidir com ele. Depois:
  - trocar `META_ACCESS_TOKEN`, `META_APP_ID`, `META_APP_SECRET`, `META_IG_USER_ID` e `META_PAGE_ID` no `.env`;
  - rodar `scripts/deploy.sh` de novo;
  - chamar `meta_ig_subscribe_page` com o campo indicado no guia e conferir em `meta_ig_get_page_subscription` que `leadgen` continua lá.

- [ ] **Passo 7: Teste real, combinado com o Renato**

  Sem publicar nada no feed:
  - `meta_ig_get_profile` e `meta_ig_get_publishing_limit` respondem;
  - cadastrar um destino de teste HTTPS e rodar `meta_ig_test_webhook_destination`;
  - o Renato comenta num post e manda um Direct, e os dois eventos aparecem em `meta_ig_list_events` e no destino;
  - responder o Direct com `meta_ig_send_message`;
  - **com autorização explícita**, publicar um story de teste com `meta_ig_publish_story`, e o Renato o apaga pelo app se quiser;
  - remover o destino de teste.

- [ ] **Passo 8: Encerrar**

  Atualizar `projetos/mcp-meta-ads.md` no ai-memory com o estado final, só fatos e sem segredos. Seguir com `superpowers:finishing-a-development-branch`.
