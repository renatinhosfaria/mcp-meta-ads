import test from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleApiError } from '../src/client.ts';
import { registerAdLibraryTools } from '../src/tools/ad-library.ts';
import { MAX_PAGINATE_ITEMS } from '../src/constants.ts';
import {
  registerAudienceTools,
  buildAudienceUsersPayload,
  getAudiencePaginationLimit,
} from '../src/tools/audiences.ts';
import { registerAssetTools, normalizeUploadSource } from '../src/tools/assets.ts';
import { registerCreativeTools } from '../src/tools/creatives.ts';
import {
  registerLeadFormTools,
  loadLeadsForDownload,
} from '../src/tools/lead-forms.ts';
import { registerPreviewTools } from '../src/tools/previews.ts';
import { registerConversionTools, buildCapiPayload } from '../src/tools/conversions.ts';

type ToolRegistration = {
  config: {
    inputSchema: {
      parse: (input: unknown) => unknown;
    };
  };
  handler: (input: unknown) => Promise<unknown>;
};

function captureTools(
  register: (server: { registerTool: (name: string, config: unknown, handler: (input: unknown) => Promise<unknown>) => void }) => void
): Map<string, ToolRegistration> {
  const tools = new Map<string, ToolRegistration>();

  register({
    registerTool(name, config, handler) {
      tools.set(name, {
        config: config as ToolRegistration['config'],
        handler,
      });
    },
  });

  return tools;
}

function createMetaAxiosError(metaError: Record<string, unknown>): AxiosError {
  const config = {
    headers: new AxiosHeaders(),
  } as InternalAxiosRequestConfig;

  const response = {
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config,
    data: {
      error: metaError,
    },
  } as AxiosResponse;

  return new AxiosError(
    String(metaError.message ?? 'Meta error'),
    'ERR_BAD_REQUEST',
    config,
    {},
    response
  );
}

test('new domain modules register the expected tools', () => {
  const adLibraryTools = captureTools(registerAdLibraryTools as never);
  const audienceTools = captureTools(registerAudienceTools as never);
  const assetTools = captureTools(registerAssetTools as never);
  const creativeTools = captureTools(registerCreativeTools as never);
  const leadFormTools = captureTools(registerLeadFormTools as never);
  const previewTools = captureTools(registerPreviewTools as never);
  const conversionTools = captureTools(registerConversionTools as never);

  const expectedToolNames = [
    ['meta_search_ad_library', adLibraryTools],
    ['meta_list_audiences', audienceTools],
    ['meta_create_lookalike_audience', audienceTools],
    ['meta_replace_audience_users', audienceTools],
    ['meta_upload_ad_image', assetTools],
    ['meta_get_ad_video_status', assetTools],
    ['meta_create_ad_creative', creativeTools],
    ['meta_get_lead_form', leadFormTools],
    ['meta_list_form_leads', leadFormTools],
    ['meta_get_creative_preview', previewTools],
    ['meta_send_conversion_event', conversionTools],
    ['meta_send_conversion_events_batch', conversionTools],
  ] as const;

  for (const [toolName, toolMap] of expectedToolNames) {
    assert.ok(toolMap.get(toolName), `${toolName} should be registered`);
  }
});

test('handleApiError explains when a Page Access Token is required', () => {
  const message = handleApiError(createMetaAxiosError({
    code: 190,
    type: 'OAuthException',
    message: '(#190) This method must be called with a Page Access Token',
  }));

  assert.match(message, /Page Access Token/i);
});

test('handleApiError explains missing permissions for ad library requests', () => {
  const message = handleApiError(createMetaAxiosError({
    code: 10,
    type: 'OAuthException',
    message: 'Application does not have permission for this action',
  }));

  assert.match(message, /Permissão insuficiente/i);
  assert.match(message, /ads archive|ad library|permiss/i);
});

test('handleApiError classifies unsupported post request as unsupported operation', () => {
  const message = handleApiError(createMetaAxiosError({
    code: 100,
    type: 'GraphMethodException',
    message: "Unsupported post request. Object with ID '123' does not exist",
  }));

  assert.match(message, /Operação não suportada/i);
});

test('normalizeUploadSource rejects multiple upload origins', async () => {
  await assert.rejects(
    () => normalizeUploadSource({
      file_path: '/tmp/example.png',
      file_url: 'https://example.com/example.png',
    }),
    /exatamente uma origem/i
  );
});

test('normalizeUploadSource accepts a single upload origin', async () => {
  const source = await normalizeUploadSource({
    base64_data: Buffer.from('hello world').toString('base64'),
    filename: 'hello.txt',
  });

  assert.equal(source.filename, 'hello.txt');
  assert.ok(source.blob);
});

test('normalizeUploadSource rejects invalid base64 payloads', async () => {
  await assert.rejects(
    () => normalizeUploadSource({
      base64_data: '%%%not-base64%%%',
      filename: 'broken.bin',
    }),
    /base64 válido/i
  );
});

test('buildAudienceUsersPayload omits is_raw for hashed customer data', () => {
  const payload = buildAudienceUsersPayload({
    schema: ['EMAIL'],
    users: [['user@example.com']],
    operation: 'replace',
  });

  assert.deepEqual(payload.payload.schema, ['EMAIL']);
  assert.deepEqual(payload.payload.data, [['user@example.com']]);
  assert.equal('is_raw' in payload, false);
});

test('buildAudienceUsersPayload preserves a numeric session ID', () => {
  const payload = buildAudienceUsersPayload({
    schema: ['PHONE'],
    users: [['a'.repeat(64)]],
    operation: 'replace',
    session: {
      session_id: 1783703797460,
      estimated_num_total: 1,
      batch_seq: 1,
      last_batch_flag: true,
    },
  });

  assert.equal(payload.session?.session_id, 1783703797460);
});

test('audience user tool schema accepts a numeric session ID', () => {
  const audienceTools = captureTools(registerAudienceTools as never);
  const tool = audienceTools.get('meta_replace_audience_users');

  assert.ok(tool, 'meta_replace_audience_users should be registered');
  const input = tool.config.inputSchema.parse({
    audience_id: 'audience_123',
    schema: ['PHONE'],
    users: [['a'.repeat(64)]],
    session_id: 1783703797460,
  }) as { session_id: number };

  assert.equal(input.session_id, 1783703797460);
});

test('audience user tool schema accepts and normalizes a numeric string session ID', () => {
  const audienceTools = captureTools(registerAudienceTools as never);
  const tool = audienceTools.get('meta_add_audience_users');

  assert.ok(tool, 'meta_add_audience_users should be registered');
  const input = tool.config.inputSchema.parse({
    audience_id: 'audience_123',
    schema: ['PHONE'],
    users: [['a'.repeat(64)]],
    session_id: '1783703797460',
  }) as { session_id: number };

  assert.equal(input.session_id, 1783703797460);
});

test('audience user tool schema rejects a non-numeric session ID', () => {
  const audienceTools = captureTools(registerAudienceTools as never);
  const tool = audienceTools.get('meta_add_audience_users');

  assert.ok(tool, 'meta_add_audience_users should be registered');
  assert.throws(() => tool.config.inputSchema.parse({
    audience_id: 'audience_123',
    schema: ['PHONE'],
    users: [['a'.repeat(64)]],
    session_id: 'batch-one',
  }));
});

test('tools/list publishes both accepted session ID input types', async () => {
  const server = new McpServer({ name: 'audience-contract-test', version: '1.0.0' });
  registerAudienceTools(server);
  const client = new Client({ name: 'audience-contract-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const { tools } = await client.listTools();
    const tool = tools.find(({ name }) => name === 'meta_add_audience_users');
    assert.ok(tool, 'meta_add_audience_users should be published');
    const sessionSchema = (tool.inputSchema.properties as Record<string, {
      anyOf?: Array<{ type?: string }>;
      type?: string;
    }>).session_id;
    const publishedTypes = new Set(
      sessionSchema.anyOf?.map(({ type }) => type).filter(Boolean)
        ?? (sessionSchema.type ? [sessionSchema.type] : []),
    );

    assert.deepEqual(publishedTypes, new Set(['integer', 'string']));
  } finally {
    await client.close();
    await server.close();
  }
});

test('audience handler sends a normalized numeric session ID to the Graph API', async () => {
  const audienceTools = captureTools(registerAudienceTools as never);
  const tool = audienceTools.get('meta_add_audience_users');
  assert.ok(tool, 'meta_add_audience_users should be registered');
  const input = tool.config.inputSchema.parse({
    audience_id: 'audience_123',
    schema: ['PHONE'],
    users: [['a'.repeat(64)]],
    session_id: '1783703797460',
    estimated_num_total: 1,
    batch_seq: 1,
    last_batch_flag: true,
  });
  const originalAdapter = axios.defaults.adapter;
  const originalAccessToken = process.env.META_ACCESS_TOKEN;
  let graphPayload: Record<string, unknown> | undefined;
  axios.defaults.adapter = async (config) => {
    graphPayload = (typeof config.data === 'string'
      ? JSON.parse(config.data)
      : config.data) as Record<string, unknown>;
    return {
      data: { num_received: 1 },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  process.env.META_ACCESS_TOKEN = 'contract-test-token';

  try {
    await tool.handler(input);
    assert.deepEqual(graphPayload?.session, {
      session_id: 1783703797460,
      estimated_num_total: 1,
      batch_seq: 1,
      last_batch_flag: true,
    });
  } finally {
    axios.defaults.adapter = originalAdapter;
    if (originalAccessToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = originalAccessToken;
  }
});

test('getAudiencePaginationLimit over-fetches when subtype_filter is applied', () => {
  assert.equal(getAudiencePaginationLimit(undefined, 50), 50);
  assert.equal(getAudiencePaginationLimit([], 50), 50);
  assert.equal(getAudiencePaginationLimit(['LOOKALIKE'], 50), MAX_PAGINATE_ITEMS);
});

test('loadLeadsForDownload uses paginated loader semantics', async () => {
  const calls: Array<{
    endpoint: string;
    params: Record<string, unknown>;
    maxItems: number;
    options?: { accessToken?: string };
  }> = [];

  const leads = await loadLeadsForDownload(async (endpoint, params, maxItems, options) => {
    calls.push({ endpoint, params, maxItems, options });
    return [{ id: 'lead_1' }];
  }, {
    form_id: 'form_123',
    page_access_token: 'page-token',
    limit: 200,
  });

  assert.equal(leads.length, 1);
  assert.deepEqual(calls, [{
    endpoint: 'form_123/leads',
    params: { fields: 'id,created_time,ad_id,form_id,field_data,platform,is_organic' },
    maxItems: 200,
    options: { accessToken: 'page-token' },
  }]);
});

test('buildCapiPayload requires event_name and event_time', () => {
  assert.throws(
    () => buildCapiPayload({
      data: [{}],
    }),
    /event_name/i
  );
});

test('buildCapiPayload preserves batch metadata and test_event_code', () => {
  const payload = buildCapiPayload({
    data: [
      {
        event_name: 'Purchase',
        event_time: 1762902353,
      },
    ],
    test_event_code: 'TEST123',
    partner_agent: 'meta-ads-mcp-server',
  });

  assert.equal(payload.test_event_code, 'TEST123');
  assert.equal(payload.partner_agent, 'meta-ads-mcp-server');
  assert.equal(payload.data.length, 1);
});

test('meta_search_ad_library schema requires search_terms or search_page_ids', () => {
  const adLibraryTools = captureTools(registerAdLibraryTools as never);
  const tool = adLibraryTools.get('meta_search_ad_library');

  assert.ok(tool, 'meta_search_ad_library should be registered');
  assert.throws(
    () => tool?.config.inputSchema.parse({ ad_reached_countries: ['BR'] }),
    /search_terms ou search_page_ids/i
  );
});
