import test from 'node:test';
import assert from 'node:assert/strict';
import { AxiosError, AxiosHeaders } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
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

test('buildAudienceUsersPayload builds the expected schema for replace operation', () => {
  const payload = buildAudienceUsersPayload({
    schema: ['EMAIL'],
    users: [['user@example.com']],
    operation: 'replace',
  });

  assert.deepEqual(payload.payload.schema, ['EMAIL']);
  assert.deepEqual(payload.payload.data, [['user@example.com']]);
  assert.equal(payload.is_raw, true);
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
