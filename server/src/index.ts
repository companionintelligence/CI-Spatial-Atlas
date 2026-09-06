/**
 * Atlas server entry point.
 *
 * Serves the REST API and mounts the MCP API over Streamable HTTP at POST /mcp
 * (stateless: a fresh server + transport per request). Suite services
 * (OpenClaw, Hermes) and OIDC-authenticated clients connect here; local agents
 * use the stdio entry in mcp-stdio.ts instead.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { buildApi } from './api.js';
import { assertAuthStartup } from './auth.js';
import { createConnectors } from './connectors.js';
import { createAtlasMcpServer, type AtlasDeps } from './mcp.js';
import { InMemoryStore } from './store.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

const deps: AtlasDeps = {
  store: new InMemoryStore(),
  connectors: createConnectors(),
  viewerBaseUrl: process.env.ATLAS_VIEWER_BASE_URL ?? 'http://localhost:4174',
  apiBaseUrl: process.env.ATLAS_API_BASE_URL ?? `http://localhost:${PORT}/api`
};

const app = buildApi(deps);

// Decide + announce the auth mode before we accept a single request. This throws
// (and we exit non-zero) when COMPANION_OIDC_ISSUER is missing in a deployed
// environment: a crash-loop is loud, whereas silently booting the dev bypass
// would serve every private story to anyone who asks. See src/auth.ts.
try {
  assertAuthStartup(process.env, app.log);
} catch (err) {
  app.log.error({ err }, 'Companion Atlas refused to start: unsafe auth configuration');
  process.exit(1);
}

// Mount the MCP API over Streamable HTTP (stateless).
app.post('/mcp', async (req, reply) => {
  const server = createAtlasMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.hijack();
  reply.raw.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
});

app
  .listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`Companion Atlas API + MCP on http://${HOST}:${PORT} (MCP at /mcp)`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
