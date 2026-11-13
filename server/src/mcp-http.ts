/**
 * The MCP API over Streamable HTTP: `POST /mcp`.
 *
 * Stateless: every request gets a fresh MCP server and transport, built for
 * that request's `req.auth` (the global auth preHandler in buildApi() sets it),
 * so each call is scoped to its caller. index.ts mounts this route; it lives
 * here so tests can drive it through Fastify without starting the server.
 *
 * Request size. The SDK parses every JSON-RPC request with zod before any
 * handler or tool runs: first the transport's message schema, then the
 * method's own request schema. Some of those schemas hold arrays and records
 * with no length limit, such as `initialize`'s `clientInfo.icons` and
 * `capabilities.experimental`. This server is on zod 3.25, which records an
 * issue for every failing element and keeps going (GHSA-mrhx-c7xc-m3w5), and
 * the SDK answers a failed parse with every issue in the error message. One
 * 1 MiB `initialize` cost about 10 seconds of CPU, over 2 GB of memory and a
 * 128 MB response, with no token needed. The SDK's own `maxToolInputElements`
 * (see mcp.ts) covers only `tools/call` arguments.
 *
 * So the parsed body is measured here, before the auth preHandler and before
 * the SDK sees it, and a body with more than MCP_MAX_BODY_ELEMENTS array
 * elements and object members is refused with 413. The count stops as soon as
 * it passes the limit, so refusing a 1 MiB body costs no more than counting to
 * the limit.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { createAtlasMcpServer, MCP_MAX_TOOL_INPUT_ELEMENTS, type AtlasDeps } from './mcp.js';

/** Request body limit for `POST /mcp` (Fastify's default, pinned so a larger global limit cannot reach it). */
export const MCP_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Most array elements plus object members one `POST /mcp` body may carry.
 *
 * The tool-argument limit plus room for the JSON-RPC envelope around them, so
 * a call within `MCP_MAX_TOOL_INPUT_ELEMENTS` still reaches the SDK, whose
 * message names the tool. Real requests carry a few hundred at most.
 */
export const MCP_MAX_BODY_ELEMENTS = MCP_MAX_TOOL_INPUT_ELEMENTS + 100;

/**
 * Counts array elements and object members in `value`, stopping once the
 * running total passes `max`. The same count the SDK applies to tool
 * arguments. It walks with an explicit stack, so deep nesting cannot overflow
 * the call stack.
 */
export function jsonElementCount(value: unknown, max: number): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const child of node) {
        if (++count > max) return count;
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    } else {
      for (const key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
        if (++count > max) return count;
        const child = (node as Record<string, unknown>)[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
  }
  return count;
}

/** Refuses a body with more structure than any MCP request Atlas serves, in the JSON-RPC error shape the SDK uses for its own 413. */
async function refuseOversizedBody(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (jsonElementCount(req.body, MCP_MAX_BODY_ELEMENTS) <= MCP_MAX_BODY_ELEMENTS) return undefined;
  return reply.code(413).send({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: `Payload Too Large: Request body must not have more than ${MCP_MAX_BODY_ELEMENTS} array elements and object members`,
    },
    id: null,
  });
}

/** Mounts `POST /mcp` on `app`. */
export function registerMcpRoute(app: FastifyInstance, deps: Omit<AtlasDeps, 'auth'>): void {
  app.post(
    '/mcp',
    // preValidation runs once the body is parsed, before the auth preHandler
    // and the handler, so an oversized body is refused before anything else
    // works on it.
    { bodyLimit: MCP_MAX_BODY_BYTES, preValidation: refuseOversizedBody },
    async (req, reply) => {
      const server = createAtlasMcpServer({ ...deps, auth: req.auth });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      reply.hijack();
      reply.raw.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    },
  );
}
