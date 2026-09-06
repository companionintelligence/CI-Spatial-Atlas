/**
 * Atlas server entry point.
 *
 * Serves the REST API and mounts the MCP API over Streamable HTTP at POST /mcp
 * (stateless: a fresh server + transport per request). Suite services
 * (OpenClaw, Hermes) and OIDC-authenticated clients connect here; local agents
 * use the stdio entry in mcp-stdio.ts instead.
 *
 * Because this entry point is the one reachable over the network, it is also
 * where the dev auth bypass is fenced off: `assertAuthSafeToBoot()` runs before
 * anything binds a port.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { buildApi, type ApiDeps } from './api.js';
import { assertAuthSafeToBoot } from './auth.js';
import { createConnectors } from './connectors.js';
import { createAtlasMcpServer } from './mcp.js';
import { InMemoryStore } from './store.js';

// Fail fast, before the port is bound: an issuer-less deployment would serve
// every caller as the fully-scoped dev subject. Exiting non-zero (rather than
// throwing) keeps the remedy readable in container logs instead of burying it
// under an unhandled-rejection stack trace.
try {
  assertAuthSafeToBoot();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

const deps: ApiDeps = {
  store: new InMemoryStore(),
  connectors: createConnectors(),
  viewerBaseUrl: process.env.ATLAS_VIEWER_BASE_URL ?? 'http://localhost:4173',
  apiBaseUrl: process.env.ATLAS_API_BASE_URL ?? `http://localhost:${PORT}/api`
};

const app = buildApi(deps);

// Mount the MCP API over Streamable HTTP (stateless). The global auth
// preHandler in buildApi() has already populated `req.auth`, so each
// per-request MCP server is built scoped to the caller rather than unscoped.
app.post('/mcp', async (req, reply) => {
  const server = createAtlasMcpServer({ ...deps, auth: req.auth });
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
