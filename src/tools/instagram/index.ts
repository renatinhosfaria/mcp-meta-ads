import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerInstagramAccountTools } from './account.js';
import { registerInstagramCommentTools } from './comments.js';
import { registerInstagramMediaTools } from './media.js';

// Completado pelas Tasks 7, 10 e 11.
export interface InstagramDeps {}

export function registerInstagramTools(server: McpServer, _deps: InstagramDeps): void {
  registerInstagramAccountTools(server);
  registerInstagramMediaTools(server);
  registerInstagramCommentTools(server);
}
