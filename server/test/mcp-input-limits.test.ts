/**
 * MCP tool input size limit.
 *
 * zod 3 records one issue per failing array element and keeps parsing, so the
 * size of a tool call's arguments has to be bounded before zod sees them
 * (GHSA-mrhx-c7xc-m3w5, GHSA-46jr-4wx8-v453). The SDK's `maxToolInputElements`
 * does that count; these cases pin that it is switched on and that real calls
 * still get through.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { AuthContext } from '../src/auth.js';
import { createConnectors } from '../src/connectors.js';
import { createAtlasMcpServer, MCP_MAX_TOOL_INPUT_ELEMENTS } from '../src/mcp.js';
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
