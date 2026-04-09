import test from 'node:test';
import assert from 'node:assert/strict';
import { AxiosError, AxiosHeaders } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { handleApiError } from '../src/client.ts';
import { registerCampaignTools } from '../src/tools/campaigns.ts';
import { registerAdSetTools } from '../src/tools/adsets.ts';
import { registerAdTools } from '../src/tools/ads.ts';

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

test('meta_create_campaign schema defaults is_adset_budget_sharing_enabled to false', () => {
  const tools = captureTools(registerCampaignTools as never);
  const tool = tools.get('meta_create_campaign');

  assert.ok(tool, 'meta_create_campaign should be registered');

  const parsed = tool.config.inputSchema.parse({
    name: 'Campanha teste',
    objective: 'OUTCOME_LEADS',
  }) as Record<string, unknown>;

  assert.equal(parsed.is_adset_budget_sharing_enabled, false);
});

test('buildCreateCampaignPayload exists and sends is_adset_budget_sharing_enabled by default', async () => {
  const campaignsModule = await import('../src/tools/campaigns.ts');
  const buildCreateCampaignPayload = (campaignsModule as Record<string, unknown>).buildCreateCampaignPayload;

  assert.equal(typeof buildCreateCampaignPayload, 'function');

  const payload = (buildCreateCampaignPayload as (input: Record<string, unknown>) => Record<string, unknown>)({
    name: 'Campanha teste',
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    special_ad_categories: ['NONE'],
  });

  assert.equal(payload.is_adset_budget_sharing_enabled, false);
});

test('buildCreateCampaignPayload preserves explicit is_adset_budget_sharing_enabled', async () => {
  const campaignsModule = await import('../src/tools/campaigns.ts');
  const buildCreateCampaignPayload = (campaignsModule as Record<string, unknown>).buildCreateCampaignPayload;

  assert.equal(typeof buildCreateCampaignPayload, 'function');

  const payload = (buildCreateCampaignPayload as (input: Record<string, unknown>) => Record<string, unknown>)({
    name: 'Campanha teste',
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    special_ad_categories: ['NONE'],
    is_adset_budget_sharing_enabled: true,
  });

  assert.equal(payload.is_adset_budget_sharing_enabled, true);
});

test('handleApiError uses error_user_msg for Meta code 100 instead of generic permission text', () => {
  const message = handleApiError(createMetaAxiosError({
    code: 100,
    type: 'OAuthException',
    message: '(#100) Invalid parameter',
    error_user_msg: 'is_adset_budget_sharing_enabled must be set to false.',
  }));

  assert.match(message, /is_adset_budget_sharing_enabled must be set to false\./);
  assert.doesNotMatch(message, /Permissão insuficiente/);
});

test('list tools reject DELETED in status_filter', () => {
  const campaignTools = captureTools(registerCampaignTools as never);
  const adSetTools = captureTools(registerAdSetTools as never);
  const adTools = captureTools(registerAdTools as never);

  const listTools = [
    campaignTools.get('meta_list_campaigns'),
    adSetTools.get('meta_list_adsets'),
    adTools.get('meta_list_ads'),
  ];

  for (const tool of listTools) {
    assert.ok(tool, 'list tool should be registered');
    assert.throws(() => {
      tool.config.inputSchema.parse({ status_filter: ['DELETED'] });
    });
  }
});
