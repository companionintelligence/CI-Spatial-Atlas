/**
 * Stdio entry for the Atlas MCP server — for local agents and editors.
 *
 * Register with Claude Code:
 *   claude mcp add companion-atlas -- node /path/to/server/dist/mcp-stdio.js
 * or during development:
 *   npm run mcp:stdio   (inside server/)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { devSubjectContext } from './auth.js';
import { createConnectors } from './connectors.js';
import { createAtlasMcpServer } from './mcp.js';
import { InMemoryStore } from './store.js';

const server = createAtlasMcpServer({
  store: new InMemoryStore(),
  connectors: createConnectors(),
  viewerBaseUrl: process.env.ATLAS_VIEWER_BASE_URL ?? 'http://localhost:4173',
  apiBaseUrl: process.env.ATLAS_API_BASE_URL ?? 'http://localhost:8787/api',
  // No HTTP request, so no bearer token: over stdio the local process *is* the
  // trust boundary (whoever can spawn this can already read the store), and the
  // store is per-process anyway. Tools run as the fully-scoped dev subject.
  //
  // This is why `assertAuthSafeToBoot()` (see auth.ts, called from index.ts)
  // is deliberately NOT invoked here. That guard exists because the HTTP entry
  // point is reachable by anonymous callers over the network; nothing about
  // this transport is. Adding it here would only break local agents.
  auth: devSubjectContext()
});

await server.connect(new StdioServerTransport());
