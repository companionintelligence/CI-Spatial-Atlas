/**
 * REST authorisation.
 *
 * Every case here signs a real token against a live JWKS (see jwks-harness.ts)
 * and drives the assembled Fastify app, so the auth preHandler, the 401 gate
 * and the per-story ownership checks are all exercised together.
 *
 * The three properties under test:
 *   1. public reads stay public (the viewer loads a shared story with no token);
 *   2. an unauthenticated write is a 401, never a silent `anonymous` success;
 *   3. an authenticated caller cannot touch somebody else's story.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApi } from '../src/api.js';
import { createConnectors } from '../src/connectors.js';
import { InMemoryStore } from '../src/store.js';
import { startIssuer, type Issuer } from './jwks-harness.js';

let issuer: Issuer;
let store: InMemoryStore;
let app: FastifyInstance;

/** Authorization headers for the three callers used throughout. */
let alice: { authorization: string };
let mallory: { authorization: string };
let admin: { authorization: string };

beforeAll(async () => {
  issuer = await startIssuer();
  alice = { authorization: await issuer.bearer({ sub: 'user_alice' }) };
  mallory = { authorization: await issuer.bearer({ sub: 'user_mallory' }) };
  admin = { authorization: await issuer.bearer({ sub: 'user_admin', scope: '*' }) };
});

afterAll(async () => {
  await app?.close();
  await issuer.close();
});

beforeEach(async () => {
  await app?.close();
  store = new InMemoryStore();
  app = buildApi({
    store,
    connectors: createConnectors(),
    viewerBaseUrl: 'http://viewer.test',
    apiBaseUrl: 'http://api.test/api',
    logger: false,
  });
  await app.ready();
});

/** Seed a story directly so ownership is explicit. */
async function seed(owner: string | undefined, visibility: 'private' | 'unlisted' | 'public' = 'private') {
  return store.createStory({ title: 'Trip', access: { visibility, oidcSubject: owner } });
}

/** Every mutating route, as (label, method, path-suffix, body). */
const WRITES = [
  ['delete story', 'DELETE', '', undefined],
  ['ingest media', 'POST', '/media', { sources: ['https://example.test/a.jpg'] }],
  ['add scene', 'POST', '/scenes', { title: 'Scene 1' }],
  ['compose', 'POST', '/compose', {}],
  ['publish', 'POST', '/publish', { visibility: 'public' }],
] as const;

describe('public read paths stay open', () => {
  it('GET /healthz needs no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it.each(['public', 'unlisted'] as const)(
    'GET /api/public/stories/:id serves a %s story with no token',
    async (visibility) => {
      const story = await seed('user_alice', visibility);
      const res = await app.inject({ method: 'GET', url: `/api/public/stories/${story.id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(story.id);
    },
  );

  it('GET /api/public/stories/:id refuses a private story to an anonymous caller', async () => {
    const story = await seed('user_alice', 'private');
    const res = await app.inject({ method: 'GET', url: `/api/public/stories/${story.id}` });
    expect(res.statusCode).toBe(403);
  });

  it('the owner can still read their own private story', async () => {
    const story = await seed('user_alice', 'private');
    const res = await app.inject({ method: 'GET', url: `/api/stories/${story.id}`, headers: alice });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/stories lists only what the anonymous caller may read', async () => {
    await seed('user_alice', 'private');
    const open = await seed('user_alice', 'public');
    const res = await app.inject({ method: 'GET', url: '/api/stories' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((s: { id: string }) => s.id)).toEqual([open.id]);
  });
});

describe('an unauthenticated write is a 401, not an anonymous success', () => {
  it('POST /api/stories without a token is 401 and creates nothing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/stories', payload: { title: 'Mine' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthenticated' });
    expect(await store.listStories()).toHaveLength(0);
  });

  it('an unverifiable token is 401, same as none at all', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/stories',
      payload: { title: 'Mine' },
      headers: { authorization: 'Bearer forged.token.here' },
    });
    expect(res.statusCode).toBe(401);
  });

  it.each(WRITES)('%s is 401 without a token', async (_label, method, suffix, payload) => {
    const story = await seed('user_alice');
    const res = await app.inject({ method, url: `/api/stories/${story.id}${suffix}`, payload });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/jobs/:id is 401 without a token', async () => {
    const job = await store.enqueue('reconstruct');
    const res = await app.inject({ method: 'GET', url: `/api/jobs/${job.id}` });
    expect(res.statusCode).toBe(401);
  });

  it('a created story is owned by the verified subject', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/stories', payload: { title: 'Mine' }, headers: alice });
    expect(res.statusCode).toBe(201);
    expect(res.json().access).toMatchObject({ visibility: 'private', oidcSubject: 'user_alice' });
    expect(res.json().author).toBe('user_alice');
  });
});

describe('an authenticated caller cannot touch a story they do not own', () => {
  it.each(WRITES)('%s by a non-owner is 403', async (_label, method, suffix, payload) => {
    const story = await seed('user_alice');
    const res = await app.inject({
      method,
      url: `/api/stories/${story.id}${suffix}`,
      payload,
      headers: mallory,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  });

  it.each(WRITES)('%s by the owner succeeds', async (_label, method, suffix, payload) => {
    const story = await seed('user_alice');
    const res = await app.inject({
      method,
      url: `/api/stories/${story.id}${suffix}`,
      payload,
      headers: alice,
    });
    expect(res.statusCode).toBeLessThan(300);
  });

  it.each(WRITES)('%s on a story that does not exist is 404, not 403', async (_label, method, suffix, payload) => {
    const res = await app.inject({ method, url: `/api/stories/story_nope${suffix}`, payload, headers: alice });
    expect(res.statusCode).toBe(404);
  });

  it('a non-owner cannot read a private story', async () => {
    const story = await seed('user_alice');
    const res = await app.inject({ method: 'GET', url: `/api/stories/${story.id}`, headers: mallory });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /api/stories/:id — previously unauthorised entirely', () => {
  it('survives an anonymous delete', async () => {
    const story = await seed('user_alice');
    expect((await app.inject({ method: 'DELETE', url: `/api/stories/${story.id}` })).statusCode).toBe(401);
    expect(await store.getStory(story.id)).not.toBeNull();
  });

  it('survives a delete by another authenticated user', async () => {
    const story = await seed('user_alice');
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/stories/${story.id}`, headers: mallory })).statusCode,
    ).toBe(403);
    expect(await store.getStory(story.id)).not.toBeNull();
  });

  it('is deleted by its owner', async () => {
    const story = await seed('user_alice');
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/stories/${story.id}`, headers: alice })).statusCode,
    ).toBe(204);
    expect(await store.getStory(story.id)).toBeNull();
  });

  it('a public story is still not deletable by a stranger', async () => {
    // Readable by everyone must not imply writable by everyone.
    const story = await seed('user_alice', 'public');
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/stories/${story.id}`, headers: mallory })).statusCode,
    ).toBe(403);
    expect(await store.getStory(story.id)).not.toBeNull();
  });
});

describe('ownerless stories and `*` scope', () => {
  it('a `*`-scoped subject may write a story it does not own', async () => {
    const story = await seed('user_alice');
    const res = await app.inject({ method: 'DELETE', url: `/api/stories/${story.id}`, headers: admin });
    expect(res.statusCode).toBe(204);
  });

  it('an ownerless story is not writable by an ordinary subject', async () => {
    const story = await seed(undefined);
    const res = await app.inject({ method: 'DELETE', url: `/api/stories/${story.id}`, headers: mallory });
    expect(res.statusCode).toBe(403);
  });

  it('an ownerless story is writable by `*`', async () => {
    const story = await seed(undefined);
    const res = await app.inject({ method: 'DELETE', url: `/api/stories/${story.id}`, headers: admin });
    expect(res.statusCode).toBe(204);
  });
});

describe('publish', () => {
  it('changes visibility without transferring ownership', async () => {
    const story = await seed('user_alice');
    const res = await app.inject({
      method: 'POST',
      url: `/api/stories/${story.id}/publish`,
      payload: { visibility: 'public' },
      headers: admin,
    });
    expect(res.statusCode).toBe(200);
    const after = await store.getStory(story.id);
    expect(after?.access).toMatchObject({ visibility: 'public', oidcSubject: 'user_alice' });
  });

  it('an ownerless story adopts the publisher as its owner', async () => {
    const story = await seed(undefined);
    await app.inject({ method: 'POST', url: `/api/stories/${story.id}/publish`, payload: {}, headers: admin });
    expect((await store.getStory(story.id))?.access?.oidcSubject).toBe('user_admin');
  });

  it('publishing makes the story fetchable by the anonymous viewer', async () => {
    const story = await seed('user_alice');
    await app.inject({
      method: 'POST',
      url: `/api/stories/${story.id}/publish`,
      payload: { visibility: 'unlisted' },
      headers: alice,
    });
    const res = await app.inject({ method: 'GET', url: `/api/public/stories/${story.id}` });
    expect(res.statusCode).toBe(200);
  });
});

describe('jobs are scoped to their story', () => {
  it('a non-reader of the story cannot poll its job', async () => {
    const story = await seed('user_alice');
    const job = await store.enqueue('reconstruct', story.id);
    const res = await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers: mallory });
    expect(res.statusCode).toBe(403);
  });

  it('the owner can poll it', async () => {
    const story = await seed('user_alice');
    const job = await store.enqueue('reconstruct', story.id);
    const res = await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers: alice });
    expect(res.statusCode).toBe(200);
  });
});
