/**
 * Upload authorisation — the same properties `api-authz.test.ts` proves for the
 * story routes, proved again for the route that writes files.
 *
 * An unauthenticated upload endpoint on a service that stores bytes is worse
 * than a missing feature: it is free storage and free bandwidth on somebody
 * else's infrastructure, and anything stored is served. So every case here
 * signs a real token against the live JWKS harness and drives the assembled
 * app, exactly as the story suite does — no hand-built `AuthContext`, because a
 * hand-built context cannot catch a preHandler that was never attached.
 *
 * The four properties:
 *   1. an unauthenticated upload is a 401, before any other refusal;
 *   2. an unverifiable token is the same 401 as no token at all;
 *   3. the object key is derived from the *verified* subject, so a caller can
 *      only ever write inside their own prefix;
 *   4. two subjects never share a prefix — including two subjects that sanitise
 *      to the same readable slug, which is the cross-tenant bug a slug-only key
 *      would have.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApi } from '../src/api.js';
import { createConnectors } from '../src/connectors.js';
import { keyBelongsTo, subjectPrefix } from '../src/object-store.js';
import { InMemoryStore } from '../src/store.js';
import { fakeObjectStore, type FakeObjectStore } from './fake-object-store.js';
import { startIssuer, type Issuer } from './jwks-harness.js';

let issuer: Issuer;
let app: FastifyInstance;
let objects: FakeObjectStore;

let alice: { authorization: string; 'content-type': string };
let mallory: { authorization: string; 'content-type': string };

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

beforeAll(async () => {
  issuer = await startIssuer();
  const ct = 'image/jpeg';
  alice = { authorization: await issuer.bearer({ sub: 'user_alice' }), 'content-type': ct };
  mallory = { authorization: await issuer.bearer({ sub: 'user_mallory' }), 'content-type': ct };
});

afterAll(async () => {
  await app?.close();
  await issuer.close();
});

beforeEach(async () => {
  await app?.close();
  objects = fakeObjectStore();
  app = buildApi({
    store: new InMemoryStore(),
    connectors: createConnectors(),
    viewerBaseUrl: 'http://viewer.test',
    apiBaseUrl: 'http://api.test/api',
    objectStore: objects,
    logger: false,
  });
  await app.ready();
});

describe('an unauthenticated upload is a 401, not a stored file', () => {
  it('POST /api/media without a token is 401 and stores nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { 'content-type': 'image/jpeg' },
      payload: JPEG,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthenticated' });
    expect(objects.keys()).toHaveLength(0);
  });

  it('an unverifiable token is 401, same as none at all', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { 'content-type': 'image/jpeg', authorization: 'Bearer forged.token.here' },
      payload: JPEG,
    });
    expect(res.statusCode).toBe(401);
    expect(objects.keys()).toHaveLength(0);
  });

  it('GET /api/media/config needs a verified subject', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/media/config' })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/api/media/config', headers: alice });
    expect(ok.statusCode).toBe(200);
  });

  it('the 401 comes before any complaint about the body', async () => {
    // Otherwise an anonymous caller learns the allowlist and the size cap by
    // probing, and — worse — a future refactor could answer 415/413 from a path
    // that never reached the auth gate at all.
    const res = await app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { 'content-type': 'text/plain' },
      payload: 'not an image',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('the object key is scoped to the verified subject', () => {
  it('an upload lands under the uploader’s prefix', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/media', headers: alice, payload: JPEG });
    expect(res.statusCode).toBe(201);
    const { key, url } = res.json();
    expect(keyBelongsTo(key, 'user_alice')).toBe(true);
    expect(keyBelongsTo(key, 'user_mallory')).toBe(false);
    expect(url).toBe(`http://api.test/api/media/o/${key}`);
  });

  it('two subjects never write into the same prefix', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/media', headers: alice, payload: JPEG });
    const m = await app.inject({ method: 'POST', url: '/api/media', headers: mallory, payload: JPEG });
    const prefixOf = (k: string) => k.split('/').slice(0, 2).join('/');
    expect(prefixOf(a.json().key)).not.toBe(prefixOf(m.json().key));
  });

  it('the key cannot be steered by the caller — no filename, no header', async () => {
    // The uploader supplies no part of the key. A filename is user data (often a
    // date or a place) and would end up in a URL that gets shared; a
    // caller-chosen key would be a way out of the prefix entirely.
    const res = await app.inject({
      method: 'POST',
      url: '/api/media?filename=../../escape.jpg&key=u/user_mallory-0000000000000000/x.jpg',
      headers: alice,
      payload: JPEG,
    });
    const { key } = res.json();
    expect(key).toMatch(/^u\/[a-z0-9._-]+-[0-9a-f]{16}\/[0-9a-f]{32}\.jpg$/);
    expect(key).not.toContain('escape');
    expect(keyBelongsTo(key, 'user_alice')).toBe(true);
  });

  it('subjects that sanitise to the same slug still get distinct prefixes', async () => {
    // `a/b` and `a_b` both slug to `a_b`. Without the digest of the raw subject
    // they would share an object namespace — one tenant able to overwrite
    // another's media, which is a security bug rather than a tidiness one.
    expect(subjectPrefix('a/b')).not.toBe(subjectPrefix('a_b'));
    expect(subjectPrefix('USER_ALICE')).not.toBe(subjectPrefix('user_alice'));
  });

  it('a subject with no usable characters still produces a valid, distinct prefix', async () => {
    // An OIDC `sub` is opaque; nothing guarantees it contains ASCII at all.
    expect(subjectPrefix('・・・')).toMatch(/^[a-z0-9._-]+-[0-9a-f]{16}$/);
    expect(subjectPrefix('・・・')).not.toBe(subjectPrefix('☃☃☃'));
  });
});
