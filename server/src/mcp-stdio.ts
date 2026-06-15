/**
 * Stdio entry for the Atlas MCP server — for local agents and editors.
 *
 * Register with Claude Code:
 *   claude mcp add companion-atlas -- node /path/to/server/dist/mcp-stdio.js
 * or during development:
 *   npm run mcp:stdio   (inside server/)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createConnectors } from './connectors.js';
import { createAtlasMcpServer } from './mcp.js';
import { InMemoryStore } from './store.js';

const server = createAtlasMcpServer({
  store: new InMemoryStore(),
  connectors: createConnectors(),
  viewerBaseUrl: process.env.ATLAS_VIEWER_BASE_URL ?? 'http://localhost:4173',
  apiBaseUrl: process.env.ATLAS_API_BASE_URL ?? 'http://localhost:8787/api'
});

await server.connect(new StdioServerTransport());
