/**
 * What the upload endpoint accepts, what it refuses, and — the case most
 * developers will actually hit — what it says when there is no object store at
 * all.
 *
 * MinIO exists in exactly one place in this repo, `docker-compose.yml`, so
 * "storage is not configured" is the *ordinary* state on a developer machine
 * rather than an exceptional one. It therefore gets the same test attention as
 * the happy path: a feature that fails obscurely when its infrastructure is
 * absent trains everyone to distrust it when the infrastructure is present.
 *
 * No token is minted here. With `COMPANION_OIDC_ISSUER` unset (the state of
 * this process — see `auth.ts`) every request runs as the dev subject, which is
 * both what local development does and what keeps this file about *limits*.
 * The authorisation properties are proved against a real issuer next door in
 * `media-authz.test.ts`.
 */
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApi } from '../src/api.js';
import { createConnectors } from '../src/connectors.js';
import { mediaUrl, formatBytes } from '../src/media.js';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_UPLOAD_CONTENT_TYPES,
  extensionFor,
  isUploadKey,
  mediaKindFor,
  normaliseContentType,
  newObjectKey,
  objectStoreConfigFromEnv,
  parseEndpoint,
  readCapped,
  uploadLimitsFromEnv,
  type UploadLimits,
} from '../src/object-store.js';
import { InMemoryStore } from '../src/store.js';
import { fakeObjectStore, type FakeObjectStore } from './fake-object-store.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const IMAGE = { 'content-type': 'image/jpeg' };

let app: FastifyInstance | undefined;

function build(opts: { objectStore?: FakeObjectStore | null; uploadLimits?: UploadLimits } = {}) {
  app = buildApi({
    store: new InMemoryStore(),
    connectors: createConnectors(),
    viewerBaseUrl: 'http://viewer.test',
    apiBaseUrl: 'http://api.test/api',
    objectStore: opts.objectStore === undefined ? fakeObjectStore() : opts.objectStore,
    uploadLimits: opts.uploadLimits,
    logger: false,
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('a file goes in and a usable URL comes back', () => {
  it('stores the bytes and answers with the URL, kind and size', async () => {
    const objects = fakeObjectStore();
    const api = build({ objectStore: objects });
    const res = await api.inject({ method: 'POST', url: '/api/media', headers: IMAGE, payload: JPEG });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      contentType: 'image/jpeg',
      kind: 'image',
      bytes: JPEG.length,
      url: expect.stringContaining('http://api.test/api/media/o/u/'),
    });
    expect(objects.body(res.json().key)?.equals(JPEG)).toBe(true);
  });

  it('the returned URL actually serves the bytes back', async () => {
    // The property that makes this feature real rather than apparent: the URL
    // handed to the viewer must be one a browser can fetch and render. A test
    // that only asserted a 201 would pass against a route that stored the file
    // and returned an address nothing serves.
    const api = build();
    const up = await api.inject({ method: 'POST', url: '/api/media', headers: IMAGE, payload: JPEG });
    const path = new URL(up.json().url).pathname;

    const down = await api.inject({ method: 'GET', url: path });
    expect(down.statusCode).toBe(200);
    expect(down.rawPayload.equals(JPEG)).toBe(true);
    expect(down.headers['content-type']).toBe('image/jpeg');
    expect(down.headers['content-length']).toBe(String(JPEG.length));
  });

  it('serves uploaded media with the headers that stop it becoming a document', async () => {
    // An uploaded file is served from the API's own origin. `nosniff` keeps the
    // browser from re-reading a mislabelled file as HTML, and the CSP neuters
    // anything parsed as markup regardless — two independent guards, because
    // the allowlist alone trusts a header the uploader chose.
    const api = build();
    const up = await api.inject({ method: 'POST', url: '/api/media', headers: IMAGE, payload: JPEG });
    const down = await api.inject({ method: 'GET', url: new URL(up.json().url).pathname });

    expect(down.headers['x-content-type-options']).toBe('nosniff');
    expect(down.headers['content-security-policy']).toContain("default-src 'none'");
    expect(down.headers['content-disposition']).toBe('inline');
    expect(down.headers['cache-control']).toContain('immutable');
  });

  it('a video keeps its own kind, so a caller can build the right MediaItem', async () => {
    const api = build();
    const res = await api.inject({
      method: 'POST',
      url: '/api/media',
      headers: { 'content-type': 'video/mp4' },
      payload: Buffer.from('fake mp4'),
    });
    expect(res.json()).toMatchObject({ kind: 'video', contentType: 'video/mp4' });
    expect(res.json().key.endsWith('.mp4')).toBe(true);
  });

  it('a content type with parameters is still recognised', async () => {
    // Browsers do send them; comparing the raw header against the allowlist
    // would refuse a perfectly ordinary photo.
    const api = build();
    const res = await api.inject({
      method: 'POST',
      url: '/api/media',
      headers: { 'content-type': 'Image/JPEG; charset=binary' },
      payload: JPEG,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().contentType).toBe('image/jpeg');
  });
});

describe('the allowlist is enforced on the server, not in the browser', () => {
  it('refuses SVG even though it is an image', async () => {
    // An SVG is a document that can carry script, and it would be served from
    // the API's own origin. This is the one refusal in the allowlist that is
    // about security rather than about what the pipeline can process.
    const objects = fakeObjectStore();
    const api = build({ objectStore: objects });
    const res = await api.inject({
      method: 'POST',
      url: '/api/media',
      headers: { 'content-type': 'image/svg+xml' },
      payload: Buffer.from('<svg onload="alert(1)"/>'),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe('unsupported_media_type');
    expect(objects.keys()).toHaveLength(0);
  });

  it('names the accepted types, so the refusal is actionable', async () => {
    const api = build();
    const res = await api.inject({
      method: 'POST',
      url: '/api/media',
      headers: { 'content-type': 'application/octet-stream' },
      payload: JPEG,
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().contentTypes).toContain('image/jpeg');
  });

  it('refuses a body that is not media at all', async () => {
    const api = build();
    const res = await api.inject({
      method: 'POST',
      url: '/api/media',
      headers: { 'content-type': 'text/html' },
      payload: '<h1>hello</h1>',
    });
    expect(res.statusCode).toBe(415);
  });

  it('an empty body is a 400 rather than a stored zero-byte object', async () => {
    const objects = fakeObjectStore();
    const api = build({ objectStore: objects });
    const res = await api.inject({ method: 'POST', url: '/api/media', headers: IMAGE, payload: Buffer.alloc(0) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('empty_upload');
    expect(objects.keys()).toHaveLength(0);
  });
});

describe('the size cap is enforced on the server, not in the browser', () => {
  const tiny: UploadLimits = { maxBytes: 16, contentTypes: ['image/jpeg'] };

  it('refuses a file over the cap and stores nothing', async () => {
    const objects = fakeObjectStore();
    const api = build({ objectStore: objects, uploadLimits: tiny });
    const res = await api.inject({
      method: 'POST',
      url: '/api/media',
      headers: IMAGE,
      payload: Buffer.alloc(64, 7),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: 'file_too_large', maxBytes: 16 });
    expect(objects.keys()).toHaveLength(0);
  });

  it('the refusal says the limit in bytes a person can act on', async () => {
    const api = build({ uploadLimits: tiny });
    const res = await api.inject({ method: 'POST', url: '/api/media', headers: IMAGE, payload: Buffer.alloc(64) });
    expect(res.json().message).toContain('16 bytes');
  });

  it('a file exactly at the cap is accepted', async () => {
    const api = build({ uploadLimits: tiny });
    const res = await api.inject({ method: 'POST', url: '/api/media', headers: IMAGE, payload: Buffer.alloc(16, 1) });
    expect(res.statusCode).toBe(201);
  });

  it('readCapped refuses mid-stream, without keeping the rest', async () => {
    // The `Content-Length` check in the route is a courtesy; this is the actual
    // limit. A chunked upload declares no length at all, and a declared length
    // is a claim by the client — so the count has to happen as the bytes
    // arrive, and stop keeping them the moment it crosses.
    const chunks = [Buffer.alloc(8, 1), Buffer.alloc(8, 2), Buffer.alloc(8, 3)];
    const result = await readCapped(Readable.from(chunks), 10);
    expect(result).toMatchObject({ ok: false, reason: 'too_large', maxBytes: 10 });
  });

  it('drains an over-cap body so the 413 actually reaches the client', async () => {
    // Destroying the stream instead kills the socket under a client that is
    // still writing, and the 413 never arrives — the browser reports a network
    // failure over a file that was merely too big. Verified against a real
    // socket: cutting the stream produces ECONNRESET at the client.
    const result = await readCapped(Readable.from([Buffer.alloc(10, 1), Buffer.alloc(6, 2)]), 10);
    expect(result).toEqual({ ok: false, reason: 'too_large', maxBytes: 10, drained: true });
  });

  it('stops draining once politeness becomes a denial-of-service vector', async () => {
    const endless = Readable.from(
      (function* () {
        for (let i = 0; i < 1000; i++) yield Buffer.alloc(16, 1);
      })(),
    );
    const result = await readCapped(endless, 10, 20);
    expect(result).toEqual({ ok: false, reason: 'too_large', maxBytes: 10, drained: false });
    expect(endless.destroyed).toBe(true);
  });

  it('readCapped returns the whole body when it fits', async () => {
    const result = await readCapped(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), 10);
    expect(result.ok && result.body.toString()).toBe('abcd');
  });
});

describe('with no object store, the endpoint says so plainly', () => {
  it('POST /api/media is 503 with an operator-actionable message', async () => {
    const api = build({ objectStore: null });
    const res = await api.inject({ method: 'POST', url: '/api/media', headers: IMAGE, payload: JPEG });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('storage_not_configured');
    // Names the thing to do, not just the thing that is wrong: an obscure
    // failure here is what makes a missing feature look like a broken one.
    expect(res.json().message).toContain('Media storage is not configured');
    expect(res.json().message).toContain('docker compose up minio');
  });

  it('GET /api/media/config reports it before a file is ever chosen', async () => {
    // This is what lets the client disable the control and explain itself,
    // rather than letting someone pick a 200 MB video and find out afterwards.
    const api = build({ objectStore: null });
    const res = await api.inject({ method: 'GET', url: '/api/media/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false });
    expect(res.json().reason).toContain('Media storage is not configured');
  });

  it('GET /api/media/config advertises the real limits when storage is present', async () => {
    const api = build({ uploadLimits: { maxBytes: 1234, contentTypes: ['image/png'] } });
    const res = await api.inject({ method: 'GET', url: '/api/media/config' });
    expect(res.json()).toEqual({ configured: true, maxBytes: 1234, contentTypes: ['image/png'] });
  });

  it('fetching media is 503 too, not a bare 404 that reads as a missing file', async () => {
    const api = build({ objectStore: null });
    const key = newObjectKey('dev-operator', 'image/jpeg');
    const res = await api.inject({ method: 'GET', url: `/api/media/o/${key}` });
    expect(res.statusCode).toBe(503);
  });

  it('a failing object store is a 502, and nothing is claimed to be stored', async () => {
    const objects = fakeObjectStore();
    objects.failWith(new Error('connect ECONNREFUSED 10.0.0.5:9000'));
    const api = build({ objectStore: objects });
    const res = await api.inject({ method: 'POST', url: '/api/media', headers: IMAGE, payload: JPEG });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('storage_unavailable');
    // The endpoint and any signing detail stay in the log; a caller gets none of it.
    expect(JSON.stringify(res.json())).not.toContain('10.0.0.5');
  });
});

describe('the download route cannot be walked out of the upload namespace', () => {
  it('refuses a key that is not one this endpoint minted', async () => {
    // The bucket also holds the worker's generated 3D Tiles. Without a shape
    // check the route would serve anything in it to anyone who guessed a path.
    const api = build();
    for (const key of ['atlas-tiles/job1/tileset.json', 'u/x/y', 'stories/secret.json']) {
      const res = await api.inject({ method: 'GET', url: `/api/media/o/${key}` });
      expect(res.statusCode, key).toBe(404);
    }
  });

  it('a well-formed but unknown key is 404, indistinguishable from a refused one', async () => {
    const api = build();
    const res = await api.inject({ method: 'GET', url: `/api/media/o/${newObjectKey('dev-operator', 'image/jpeg')}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('isUploadKey rejects traversal and foreign prefixes', () => {
    expect(isUploadKey(newObjectKey('user_alice', 'image/png'))).toBe(true);
    expect(isUploadKey('u/alice-0123456789abcdef/../../etc/passwd')).toBe(false);
    expect(isUploadKey('../u/alice-0123456789abcdef/00112233445566778899aabbccddeeff')).toBe(false);
    expect(isUploadKey('u/alice-0123456789abcdef/00112233445566778899aabbccddeeff/extra')).toBe(false);
    expect(isUploadKey('tiles/alice-0123456789abcdef/00112233445566778899aabbccddeeff')).toBe(false);
  });

  it('holding the key is what serves the object — the documented trade-off', async () => {
    // Stated as a test rather than only as a comment, because it is a security
    // property somebody will otherwise assume differently: an <img> cannot send
    // a bearer token, so the 128-bit key is the capability. If this ever becomes
    // a signed, expiring parameter, this test is the one that must change.
    const api = build();
    const up = await api.inject({ method: 'POST', url: '/api/media', headers: IMAGE, payload: JPEG });
    const anonymous = await api.inject({ method: 'GET', url: new URL(up.json().url).pathname });
    expect(anonymous.statusCode).toBe(200);
  });
});

describe('configuration', () => {
  it('reports exactly which S3 variables are missing', () => {
    const result = objectStoreConfigFromEnv({ S3_ENDPOINT: 'http://minio:9000', S3_BUCKET: 'atlas' } as NodeJS.ProcessEnv);
    expect(result.configured).toBe(false);
    if (result.configured) return;
    expect(result.missing).toEqual(['S3_ACCESS_KEY', 'S3_SECRET_KEY']);
    expect(result.reason).toContain('S3_ACCESS_KEY');
  });

  it('never invents credentials, even the ones docker-compose happens to use', () => {
    // Defaulting them would let a misconfigured deployment reach for a
    // well-known pair — succeeding against a store anyone can also reach, or
    // failing with an authentication error that points at the wrong thing.
    const result = objectStoreConfigFromEnv({} as NodeJS.ProcessEnv);
    expect(result.configured).toBe(false);
    expect(JSON.stringify(result)).not.toContain('atlas-secret');
  });

  it('takes a complete configuration', () => {
    const result = objectStoreConfigFromEnv({
      S3_ENDPOINT: 'https://s3.example.test',
      S3_BUCKET: 'atlas',
      S3_ACCESS_KEY: 'k',
      S3_SECRET_KEY: 's',
    } as NodeJS.ProcessEnv);
    expect(result.configured).toBe(true);
  });

  it('splits an endpoint into host, port and TLS the way a URL does', () => {
    expect(parseEndpoint('http://minio:9000')).toEqual({ endPoint: 'minio', port: 9000, useSSL: false });
    expect(parseEndpoint('https://s3.example.test')).toEqual({ endPoint: 's3.example.test', port: 443, useSSL: true });
    expect(parseEndpoint('minio:9000')).toEqual({ endPoint: 'minio', port: 9000, useSSL: false });
  });

  it('falls back rather than throwing on a malformed size limit', () => {
    // A typo in an env var must not become an unbounded upload.
    for (const ATLAS_MAX_UPLOAD_BYTES of ['', 'lots', '-1', '0']) {
      expect(uploadLimitsFromEnv({ ATLAS_MAX_UPLOAD_BYTES } as NodeJS.ProcessEnv).maxBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    }
    expect(uploadLimitsFromEnv({ ATLAS_MAX_UPLOAD_BYTES: '4096' } as NodeJS.ProcessEnv).maxBytes).toBe(4096);
  });

  it('takes an allowlist from env, normalised', () => {
    const limits = uploadLimitsFromEnv({ ATLAS_UPLOAD_CONTENT_TYPES: ' Image/PNG , image/jpeg ,, nonsense ' } as NodeJS.ProcessEnv);
    expect(limits.contentTypes).toEqual(['image/png', 'image/jpeg']);
  });

  it('defaults to the built-in allowlist, which excludes SVG', () => {
    const limits = uploadLimitsFromEnv({} as NodeJS.ProcessEnv);
    expect(limits.contentTypes).toEqual([...DEFAULT_UPLOAD_CONTENT_TYPES]);
    expect(limits.contentTypes).not.toContain('image/svg+xml');
  });
});

describe('small pure helpers', () => {
  it('normalises content types and refuses non-types', () => {
    expect(normaliseContentType('Image/JPEG; charset=x')).toBe('image/jpeg');
    expect(normaliseContentType('notatype')).toBeNull();
    expect(normaliseContentType(undefined)).toBeNull();
  });

  it('maps a type to the story schema’s media kind', () => {
    expect(mediaKindFor('video/webm')).toBe('video');
    expect(mediaKindFor('image/avif')).toBe('image');
  });

  it('gives an object a recognisable extension', () => {
    expect(extensionFor('image/jpeg')).toBe('.jpg');
    expect(extensionFor('video/quicktime')).toBe('.mov');
    expect(extensionFor('image/heic')).toBe('.heic');
  });

  it('builds the media URL against the API base, however it is punctuated', () => {
    expect(mediaUrl('http://api.test/api/', 'u/a-1/b')).toBe('http://api.test/api/media/o/u/a-1/b');
    expect(mediaUrl('http://api.test/api', 'u/a-1/b')).toBe('http://api.test/api/media/o/u/a-1/b');
  });

  it('says byte counts the way a person reads them', () => {
    expect(formatBytes(32 * 1024 * 1024)).toBe('32 MB');
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(12)).toBe('12 bytes');
  });
});
