/**
 * MCP request size limits.
 *
 * zod 3 records one issue per failing array element and keeps parsing, so the
 * size of a request has to be bounded before zod sees it (GHSA-mrhx-c7xc-m3w5,
 * GHSA-46jr-4wx8-v453). Two counts do that:
 *
 *   - the SDK's `maxToolInputElements`, for tool arguments on any transport;
 *   - `POST /mcp`'s own count of the whole body (mcp-http.ts), because the SDK
 *     parses every request with its own schemas, `initialize` included, before
 *     any of Atlas's code runs.
 *
 * These cases pin that both are switched on and that real calls still get
 * through.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildApi } from '../src/api.js';
import type { AuthContext } from '../src/auth.js';
import { createConnectors } from '../src/connectors.js';
import { createAtlasMcpServer, MCP_MAX_TOOL_INPUT_ELEMENTS } from '../src/mcp.js';
import { jsonElementCount, MCP_MAX_BODY_BYTES, MCP_MAX_BODY_ELEMENTS, registerMcpRoute } from '../src/mcp-http.js';
import { InMemoryStore } from '../src/store.js';

const ALICE: AuthContext = { subject: 'user_alice', scopes: [], token: 'tok-alice' };

const open: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of open.splice(0)) await close();
});

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const server = createAtlasMcpServer({
    store: new InMemoryStore(),
    connectors: createConnectors(),
    viewerBaseUrl: 'http://viewer.test',
    apiBaseUrl: 'http://api.test/api',
    auth: ALICE,
  });
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  open.push(async () => {
    await client.close();
    await server.close();
  });
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: res.isError === true, text: res.content.map((c) => c.text).join('\n') };
}

describe('MCP tool input size limit', () => {
  it('refuses an oversized array before zod parses it', async () => {
    const sources = new Array(MCP_MAX_TOOL_INPUT_ELEMENTS + 1).fill(0);
    const { isError, text } = await call('atlas_ingest_media', { storyId: 'story_x', sources });
    expect(isError).toBe(true);
    expect(text).toContain(`more than the maximum of ${MCP_MAX_TOOL_INPUT_ELEMENTS} elements`);
    // The SDK prefixes zod failures with this; its absence means zod never ran.
    expect(text).not.toContain('Input validation error');
  });

  it('counts object members too, not only array elements', async () => {
    const extraKeys = Object.fromEntries(
      Array.from({ length: MCP_MAX_TOOL_INPUT_ELEMENTS + 1 }, (_, i) => [`k${i}`, i]),
    );
    const { isError, text } = await call('atlas_add_layer', {
      storyId: 'story_x',
      kind: 'geojson',
      attribution: { text: 'credit', ...extraKeys },
    });
    expect(isError).toBe(true);
    expect(text).toContain(`more than the maximum of ${MCP_MAX_TOOL_INPUT_ELEMENTS} elements`);
  });

  it('lets a call within the limit reach the tool', async () => {
    const sources = Array.from({ length: 500 }, (_, i) => `https://example.test/${i}.jpg`);
    const { isError, text } = await call('atlas_ingest_media', { storyId: 'story_missing', sources });
    // Validation passed and the handler ran: the refusal is the tool's own.
    expect(isError).toBe(true);
    expect(text).toBe('No such story: story_missing');
  });
});

describe('POST /mcp body limit', () => {
  const INITIALIZE = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18",';

  /** `prefix`, then as many `0` array entries as keep the body under the byte limit, then `suffix`. */
  function zerosBody(prefix: string, suffix: string): string {
    const n = Math.floor((MCP_MAX_BODY_BYTES - prefix.length - suffix.length - 64) / 2);
    return prefix + new Array(n).fill('0').join(',') + suffix;
  }

  /** `prefix`, then as many `"k<i>":0` object members as keep the body under the byte limit, then `suffix`. */
  function membersBody(prefix: string, suffix: string): string {
    const members: string[] = [];
    let length = prefix.length + suffix.length + 64;
    for (let i = 0; ; i++) {
      const member = `"k${i}":0`;
      if (length + member.length + 1 > MCP_MAX_BODY_BYTES) break;
      members.push(member);
      length += member.length + 1;
    }
    return prefix + members.join(',') + suffix;
  }

  async function post(payload: string): Promise<{ status: number; body: string; ms: number }> {
    const deps = {
      store: new InMemoryStore(),
      connectors: createConnectors(),
      viewerBaseUrl: 'http://viewer.test',
      apiBaseUrl: 'http://api.test/api',
    };
    const app: FastifyInstance = buildApi({ ...deps, logger: false });
    registerMcpRoute(app, deps);
    await app.ready();
    open.push(() => app.close());
    const started = performance.now();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload,
    });
    return { status: res.statusCode, body: res.payload, ms: performance.now() - started };
  }

  /** The JSON-RPC message in a response: plain JSON, or the one SSE event a stateless POST answers with. */
  function rpc(body: string): { result?: Record<string, unknown>; error?: { code: number; message: string } } {
    if (body.startsWith('{')) return JSON.parse(body);
    const data = body.split('\n').find((line) => line.startsWith('data: '));
    if (!data) throw new Error(`no SSE data line in: ${body.slice(0, 200)}`);
    return JSON.parse(data.slice('data: '.length));
  }

  function expectRefused(res: { status: number; body: string; ms: number }): void {
    expect(res.status).toBe(413);
    expect(rpc(res.body)).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32000 } });
    expect(rpc(res.body).error?.message).toContain(`more than ${MCP_MAX_BODY_ELEMENTS} array elements and object members`);
    // Before this limit the SDK parsed such a body with zod: about 10 s of CPU
    // and a response listing every issue, over 100 MB. The bound is loose
    // because CI machines vary; a refusal takes milliseconds.
    expect(res.ms).toBeLessThan(2000);
  }

  it('refuses a 1 MiB initialize whose clientInfo.icons is one huge array', async () => {
    const res = await post(zerosBody(`${INITIALIZE}"capabilities":{},"clientInfo":{"name":"x","version":"1","icons":[`, ']}}}'));
    expectRefused(res);
  });

  it('refuses a 1 MiB initialize whose capabilities.experimental is one huge record', async () => {
    const res = await post(membersBody(`${INITIALIZE}"capabilities":{"experimental":{`, '}},"clientInfo":{"name":"x","version":"1"}}}'));
    expectRefused(res);
  });

  it('refuses a 1 MiB tools/call before the SDK sees it', async () => {
    const res = await post(
      zerosBody('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"atlas_ingest_media","arguments":{"storyId":"x","sources":[', ']}}}'),
    );
    expectRefused(res);
  });

  it('still answers an ordinary initialize', async () => {
    const res = await post(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }),
    );
    expect(res.status).toBe(200);
    expect(rpc(res.body).result).toMatchObject({ serverInfo: { name: 'companion-atlas' } });
  });

  it('lets a tools/call within both limits reach the tool', async () => {
    const sources = Array.from({ length: 9_000 }, (_, i) => `https://example.test/${i}.jpg`);
    const res = await post(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'atlas_ingest_media', arguments: { storyId: 'story_missing', sources } },
      }),
    );
    expect(res.status).toBe(200);
    // Both counts and zod passed and the handler ran: the refusal is the tool's own.
    expect(rpc(res.body).result).toMatchObject({ isError: true, content: [{ text: 'No such story: story_missing' }] });
  });
});

describe('jsonElementCount', () => {
  it('counts array elements and object members at every depth', () => {
    expect(jsonElementCount({ a: [1, 2, { b: null }], c: {} }, 100)).toBe(6);
    expect(jsonElementCount('text', 100)).toBe(0);
    expect(jsonElementCount(null, 100)).toBe(0);
  });

  it('stops counting just past the limit', () => {
    expect(jsonElementCount(new Array(1_000_000).fill(0), 10)).toBe(11);
  });

  it('walks deep nesting without overflowing the stack', () => {
    let nested: unknown = 0;
    for (let i = 0; i < 200_000; i++) nested = [nested];
    expect(jsonElementCount(nested, Infinity)).toBe(200_000);
  });
});
