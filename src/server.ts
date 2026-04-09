import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAccountTools } from './tools/accounts.js';
import { registerCampaignTools } from './tools/campaigns.js';
import { registerAdSetTools } from './tools/adsets.js';
import { registerAdTools } from './tools/ads.js';
import { registerInsightTools } from './tools/insights.js';
import { registerAdLibraryTools } from './tools/ad-library.js';
import { registerAudienceTools } from './tools/audiences.js';
import { registerAssetTools } from './tools/assets.js';
import { registerCreativeTools } from './tools/creatives.js';
import { registerLeadFormTools } from './tools/lead-forms.js';
import { registerPreviewTools } from './tools/previews.js';
import { registerConversionTools } from './tools/conversions.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'meta-ads-mcp-server',
    version: '1.0.0',
  });

  registerAccountTools(server);
  registerCampaignTools(server);
  registerAdSetTools(server);
  registerAdTools(server);
  registerInsightTools(server);
  registerAdLibraryTools(server);
  registerAudienceTools(server);
  registerAssetTools(server);
  registerCreativeTools(server);
  registerLeadFormTools(server);
  registerPreviewTools(server);
  registerConversionTools(server);

  return server;
}
