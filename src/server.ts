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
import { registerPageTools } from './tools/pages.js';
import { registerEntityTools } from './tools/entities.js';
import { registerDatasetTools } from './tools/datasets.js';
import { registerCatalogTools } from './tools/catalogs.js';
import { registerAdvancedInsightTools } from './tools/advanced-insights.js';
import { registerRecommendationTools } from './tools/recommendations.js';
import { registerTargetingTools } from './tools/targeting.js';
import { registerReachTools } from './tools/reach.js';
import { registerRuleTools } from './tools/rules.js';
import { registerBrandSafetyTools } from './tools/brand-safety.js';
import { registerCustomConversionTools } from './tools/custom-conversions.js';
import { registerAccountExtrasTools } from './tools/account-extras.js';
import { SERVICE_VERSION } from './deployment-metadata.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'meta-ads-mcp-server',
    version: SERVICE_VERSION,
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
  registerPageTools(server);
  registerEntityTools(server);
  registerDatasetTools(server);
  registerCatalogTools(server);
  registerAdvancedInsightTools(server);
  registerRecommendationTools(server);
  registerTargetingTools(server);
  registerReachTools(server);
  registerRuleTools(server);
  registerBrandSafetyTools(server);
  registerCustomConversionTools(server);
  registerAccountExtrasTools(server);

  return server;
}
