/**
 * `atlas_add_layer` must carry a layer's *credit* through to storage.
 *
 * The open sources Atlas draws on licence their tiles conditionally —
 * OpenStreetMap (ODbL), EOX and CARTO (CC BY), OpenSeaMap (CC BY-SA) all
 * require attribution — so a create path that silently drops `attribution`
 * produces stories that cannot lawfully be displayed. These tests drive the
 * tool over a real MCP client/transport pair, so they cover the JSON-Schema
 * round-trip of the tool inputs as well as the handler.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { AuthContext } from '../src/auth.js';
import { createAtlasMcpServer } from '../src/mcp.js';
import { createConnectors } from '../src/connectors.js';
import { InMemoryStore } from '../src/store.js';
import { Layer } from '../src/schema.js';

/** Tool authorisation is `mcp-authz.test.ts`'s subject; here we just need a
 *  caller who owns the story, so the field pass-through is what is under test. */
const AUTHOR: AuthContext = { subject: 'user_author', scopes: [], token: 'tok-author' };

const open: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of open.splice(0)) await close();
});

async function connect() {
  const store = new InMemoryStore();
  const server = createAtlasMcpServer({
    store,
    connectors: createConnectors(),
    viewerBaseUrl: 'https://atlas.test',
    apiBaseUrl: 'https://atlas.test/api',
    auth: AUTHOR,
  });
  const client = new Client({ name: 'test', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  open.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, store };
}

/** The tool returns its payload as a single text block. */
function payload_text(result: unknown): string {
  return (result as { content: { type: string; text: string }[] }).content[0].text;
}

/** ...which is JSON on the success path. */
function payload(result: unknown): any {
  return JSON.parse(payload_text(result));
}

describe('atlas_add_layer', () => {
  let client: Client;
  let store: InMemoryStore;
  let storyId: string;

  beforeEach(async () => {
    ({ client, store } = await connect());
    storyId = payload(await client.callTool({ name: 'atlas_create_story', arguments: { title: 'T' } })).storyId;
  });

  it('advertises the attribution fields on its input schema', async () => {
    const { tools } = await client.listTools();
    const props = tools.find((t) => t.name === 'atlas_add_layer')!.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['name', 'format', 'attribution', 'visible', 'order'])
    );
  });

  it('stores name/format/attribution/visible/order alongside the layer', async () => {
    const attribution = {
      text: '© OpenStreetMap contributors',
      licence: 'ODbL-1.0',
      url: 'https://www.openstreetmap.org/copyright',
      onScreen: true,
    };
    const result = payload(
      await client.callTool({
        name: 'atlas_add_layer',
        arguments: {
          storyId,
          kind: 'imagery',
          name: 'OpenStreetMap standard',
          uri: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          format: 'xyz',
          attribution,
          opacity: 0.8,
          visible: false,
          order: 2,
        },
      })
    );

    const stored = (await store.getStory(storyId))!.layers!;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: result.layerId,
      kind: 'imagery',
      name: 'OpenStreetMap standard',
      format: 'xyz',
      attribution,
      opacity: 0.8,
      visible: false,
      order: 2,
    });
    // The stored layer is a valid canonical Layer, not just a loose object.
    expect(Layer.safeParse(stored[0]).success).toBe(true);
  });

  it('still accepts a bare layer, leaving the new fields unset', async () => {
    await client.callTool({
      name: 'atlas_add_layer',
      arguments: { storyId, kind: '3d-tiles', uri: 'https://x/tileset.json' },
    });
    const layer = (await store.getStory(storyId))!.layers![0];
    expect(layer.attribution).toBeUndefined();
    expect(layer.visible).toBeUndefined();
    expect(Layer.safeParse(layer).success).toBe(true);
  });

  it('rejects an attribution with no credit line, and an unknown format', async () => {
    const noText = await client.callTool({
      name: 'atlas_add_layer',
      arguments: { storyId, kind: 'imagery', attribution: { licence: 'ODbL-1.0' } },
    });
    expect(noText.isError).toBe(true);
    expect(payload_text(noText)).toMatch(/validation/i);

    const badFormat = await client.callTool({
      name: 'atlas_add_layer',
      arguments: { storyId, kind: 'imagery', format: 'shapefile' },
    });
    expect(badFormat.isError).toBe(true);
    expect(payload_text(badFormat)).toMatch(/validation/i);

    expect((await store.getStory(storyId))!.layers ?? []).toHaveLength(0);
  });
});
