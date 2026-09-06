/**
 * MCP tool authorisation.
 *
 * `POST /mcp` shares the REST app's auth preHandler, so `req.auth` was always
 * populated — mcp.ts simply never read it, and every tool ran unscoped whoever
 * called. These cases drive the real tool surface through an in-memory
 * client/server pair, once per caller, asserting each tool is scoped by the
 * `AuthContext` in `AtlasDeps`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ANONYMOUS, type AuthContext } from '../src/auth.js';
import { createConnectors } from '../src/connectors.js';
import { createAtlasMcpServer } from '../src/mcp.js';
import { InMemoryStore } from '../src/store.js';

const ALICE: AuthContext = { subject: 'user_alice', scopes: [], token: 'tok-alice' };
const MALLORY: AuthContext = { subject: 'user_mallory', scopes: [], token: 'tok-mallory' };
const ADMIN: AuthContext = { subject: 'user_admin', scopes: ['*'], token: 'tok-admin' };

let store: InMemoryStore;
const open: Array<() => Promise<void>> = [];

beforeEach(() => {
  store = new InMemoryStore();
});

afterEach(async () => {
  for (const close of open.splice(0)) await close();
});

/** An MCP client talking to a server scoped to `auth`. */
async function clientFor(auth: AuthContext): Promise<Client> {
  const server = createAtlasMcpServer({
    store,
    connectors: createConnectors(),
    viewerBaseUrl: 'http://viewer.test',
    apiBaseUrl: 'http://api.test/api',
    auth,
  });
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  open.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

interface ToolOutcome {
  isError: boolean;
  text: string;
}

async function call(auth: AuthContext, name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
  const client = await clientFor(auth);
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: res.isError === true, text: res.content.map((c) => c.text).join('\n') };
}

async function seed(owner: string | undefined, visibility: 'private' | 'unlisted' | 'public' = 'private') {
  return store.createStory({ title: 'Trip', access: { visibility, oidcSubject: owner } });
}

/** Every story-scoped writing tool, as (label, tool, extra args). */
const WRITE_TOOLS = [
  ['atlas_ingest_media', 'atlas_ingest_media', { sources: ['https://example.test/a.jpg'] }],
  ['atlas_add_scene', 'atlas_add_scene', { title: 'Scene 1' }],
  ['atlas_set_timeline', 'atlas_set_timeline', { start: '2024-01-01T00:00:00Z', stop: '2024-01-02T00:00:00Z' }],
  ['atlas_add_layer', 'atlas_add_layer', { kind: 'geojson', uri: 'https://example.test/a.geojson' }],
  ['atlas_publish_story', 'atlas_publish_story', { visibility: 'public' }],
] as const;

describe('unauthenticated MCP callers cannot write', () => {
  it('atlas_create_story is refused', async () => {
    const out = await call(ANONYMOUS, 'atlas_create_story', { title: 'Mine' });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/Unauthenticated/);
    expect(await store.listStories()).toHaveLength(0);
  });

  it.each(WRITE_TOOLS)('%s is refused', async (_label, tool, args) => {
    const story = await seed('user_alice');
    const out = await call(ANONYMOUS, tool, { storyId: story.id, ...args });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/Unauthenticated/);
  });

  it('atlas_auto_compose is refused', async () => {
    const story = await seed('user_alice');
    const out = await call(ANONYMOUS, 'atlas_auto_compose', { storyId: story.id });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/Unauthenticated/);
  });

  it('atlas_query_memory is refused — it reads the caller\'s own memory', async () => {
    const out = await call(ANONYMOUS, 'atlas_query_memory', { limit: 5 });
    expect(out.isError).toBe(true);
  });

  it('atlas_get_job is refused', async () => {
    const job = await store.enqueue('reconstruct');
    const out = await call(ANONYMOUS, 'atlas_get_job', { jobId: job.id });
    expect(out.isError).toBe(true);
  });
});

describe('authenticated MCP callers are scoped to what they own', () => {
  it.each(WRITE_TOOLS)('%s on another subject\'s story is forbidden', async (_label, tool, args) => {
    const story = await seed('user_alice');
    const out = await call(MALLORY, tool, { storyId: story.id, ...args });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/Forbidden/);
  });

  it.each(WRITE_TOOLS)('%s succeeds for the owner', async (_label, tool, args) => {
    const story = await seed('user_alice');
    const out = await call(ALICE, tool, { storyId: story.id, ...args });
    expect(out.isError).toBe(false);
  });

  it.each(WRITE_TOOLS)('%s succeeds for a `*`-scoped subject', async (_label, tool, args) => {
    const story = await seed('user_alice');
    const out = await call(ADMIN, tool, { storyId: story.id, ...args });
    expect(out.isError).toBe(false);
  });

  it('a missing story reports not-found rather than forbidden', async () => {
    const out = await call(ALICE, 'atlas_add_scene', { storyId: 'story_nope', title: 'x' });
    expect(out.text).toMatch(/No such story/);
  });

  it('atlas_create_story records the verified subject as owner', async () => {
    const out = await call(ALICE, 'atlas_create_story', { title: 'Mine' });
    expect(out.isError).toBe(false);
    const [story] = await store.listStories();
    expect(story.access).toMatchObject({ visibility: 'private', oidcSubject: 'user_alice' });
  });

  it('a caller-supplied `author` cannot claim ownership', async () => {
    // `author` is a display name; identity comes only from the verified token.
    await call(MALLORY, 'atlas_create_story', { title: 'Mine', author: 'user_alice' });
    const [story] = await store.listStories();
    expect(story.author).toBe('user_alice');
    expect(story.access?.oidcSubject).toBe('user_mallory');
  });

  it('an ownerless story is writable only by `*`', async () => {
    const story = await seed(undefined);
    expect((await call(MALLORY, 'atlas_add_scene', { storyId: story.id, title: 'x' })).isError).toBe(true);
    expect((await call(ADMIN, 'atlas_add_scene', { storyId: story.id, title: 'x' })).isError).toBe(false);
  });

  it('publishing does not transfer ownership', async () => {
    const story = await seed('user_alice');
    await call(ADMIN, 'atlas_publish_story', { storyId: story.id, visibility: 'public' });
    expect((await store.getStory(story.id))?.access?.oidcSubject).toBe('user_alice');
  });
});

describe('MCP reads honour canRead', () => {
  it('atlas_get_story refuses a private story to a stranger', async () => {
    const story = await seed('user_alice');
    const out = await call(MALLORY, 'atlas_get_story', { storyId: story.id });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/Forbidden/);
  });

  it.each(['public', 'unlisted'] as const)('atlas_get_story serves a %s story to anyone', async (visibility) => {
    const story = await seed('user_alice', visibility);
    const out = await call(ANONYMOUS, 'atlas_get_story', { storyId: story.id });
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.text).id).toBe(story.id);
  });

  it('atlas_list_stories shows only readable stories', async () => {
    await seed('user_alice', 'private');
    const shared = await seed('user_alice', 'public');
    const out = await call(MALLORY, 'atlas_list_stories');
    expect(JSON.parse(out.text).map((s: { id: string }) => s.id)).toEqual([shared.id]);
  });

  it('the owner sees their private story in the list', async () => {
    const mine = await seed('user_alice', 'private');
    const out = await call(ALICE, 'atlas_list_stories');
    expect(JSON.parse(out.text).map((s: { id: string }) => s.id)).toEqual([mine.id]);
  });

  it('the story:// resource refuses a private story to a stranger', async () => {
    const story = await seed('user_alice');
    const client = await clientFor(MALLORY);
    await expect(client.readResource({ uri: `story://${story.id}` })).rejects.toThrow(/Forbidden/);
  });

  it('the story:// resource serves a public story', async () => {
    const story = await seed('user_alice', 'public');
    const client = await clientFor(ANONYMOUS);
    const res = await client.readResource({ uri: `story://${story.id}` });
    expect(JSON.parse(res.contents[0].text as string).id).toBe(story.id);
  });

  it('a job belonging to another subject\'s private story is forbidden', async () => {
    const story = await seed('user_alice');
    const job = await store.enqueue('reconstruct', story.id);
    expect((await call(MALLORY, 'atlas_get_job', { jobId: job.id })).isError).toBe(true);
    expect((await call(ALICE, 'atlas_get_job', { jobId: job.id })).isError).toBe(false);
  });
});
