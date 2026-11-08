import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerInstagramAccountTools } from './account.js';
import { registerInstagramCommentTools } from './comments.js';
import { registerInstagramDiscoveryTools } from './discovery.js';
import { registerInstagramInsightTools } from './insights.js';
import { registerInstagramMediaTools } from './media.js';
import { registerInstagramMessagingTools } from './messaging.js';
import { registerInstagramPublishingTools } from './publishing.js';
import type { UploadStore } from '../../uploads/upload-store.js';

// Completado pelas Tasks 7, 10 e 11.
export interface InstagramDeps {
  uploads: UploadStore;
  /** Espera entre consultas de contêiner; só os testes trocam. */
  sleep?: (ms: number) => Promise<void>;
}

export function registerInstagramTools(server: McpServer, deps: InstagramDeps): void {
  registerInstagramAccountTools(server);
  registerInstagramMediaTools(server);
  registerInstagramCommentTools(server);
  registerInstagramInsightTools(server);
  registerInstagramDiscoveryTools(server);
  registerInstagramMessagingTools(server, deps);
  registerInstagramPublishingTools(server, deps);
}
