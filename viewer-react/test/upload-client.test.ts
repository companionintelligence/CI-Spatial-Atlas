/**
 * The two network calls, driven over a stub transport.
 *
 * The transport is injectable precisely so this suite exists: the interesting
 * behaviour of an upload client is entirely in what it does with *answers* —
 * a 401, a 503, a 200 carrying a login page, a cancelled request — and none of
 * those are reachable from a test that needs a real browser and a real server.
 *
 * The one property worth stating up front, because it is the failure this whole
 * module was written against: **a 2xx is not success.** If a proxy answers 200
 * with HTML, or an API answers 201 with a body that has no `url`, treating it
 * as a completed upload hands the panel an `undefined` URL, writes a media
 * entry that paints nothing, and produces a control that looks like it worked.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  atlasApiFromEnv,
  fetchUploadCapability,
  mediaItemFromUpload,
  uploadMedia,
  UploadAborted,
  type AtlasApiConfig,
  type TransportRequest,
  type UploadTransport,
} from '../src/upload/uploadClient.js';

const cfg: AtlasApiConfig = { baseUrl: 'http://api.test/api' };

/** A transport that answers once, recording what it was asked to send. */
function stubTransport(res: { status: number; body: string }) {
  const sent: TransportRequest[] = [];
  const transport: UploadTransport = async (req) => {
    sent.push(req);
    return res;
  };
  return { transport, sent };
}

const jpeg = { name: 'holiday.jpg', size: 8, type: 'image/jpeg' };
const created = JSON.stringify({
  key: 'u/user_alice-0123456789abcdef/00112233445566778899aabbccddeeff.jpg',
  url: 'http://api.test/api/media/o/u/user_alice-0123456789abcdef/00112233445566778899aabbccddeeff.jpg',
  contentType: 'image/jpeg',
  kind: 'image',
  bytes: 8,
});

describe('sending a file', () => {
  it('returns the media URL the server stored it at', async () => {
    const { transport } = stubTransport({ status: 201, body: created });
    const outcome = await uploadMedia(jpeg, cfg, { transport });
    expect(outcome.ok && outcome.media.url).toContain('/media/o/u/');
    expect(outcome.ok && outcome.media.kind).toBe('image');
  });

  it('POSTs the raw file to /media with its own content type', async () => {
    // No multipart wrapper: the server's allowlist reads `Content-Type`
    // directly, and base64 would inflate a video by a third.
    const { transport, sent } = stubTransport({ status: 201, body: created });
    await uploadMedia(jpeg, cfg, { transport });
    expect(sent[0]!.url).toBe('http://api.test/api/media');
    expect(sent[0]!.headers['content-type']).toBe('image/jpeg');
    expect(sent[0]!.body).toBe(jpeg);
  });

  it('sends the bearer token when the app has one, and no header when it has not', async () => {
    const withToken = stubTransport({ status: 201, body: created });
    await uploadMedia(jpeg, { ...cfg, token: 'tok' }, { transport: withToken.transport });
    expect(withToken.sent[0]!.headers.authorization).toBe('Bearer tok');

    const without = stubTransport({ status: 201, body: created });
    await uploadMedia(jpeg, cfg, { transport: without.transport });
    expect(without.sent[0]!.headers).not.toHaveProperty('authorization');
  });

  it('names a content type when the browser reported none', async () => {
    const { transport, sent } = stubTransport({ status: 201, body: created });
    await uploadMedia({ ...jpeg, type: '' }, cfg, { transport });
    expect(sent[0]!.headers['content-type']).toBe('application/octet-stream');
  });

  it('forwards progress from the transport', async () => {
    const seen: number[] = [];
    const transport: UploadTransport = async (req) => {
      req.onProgress?.(4, 8);
      req.onProgress?.(8, 8);
      return { status: 201, body: created };
    };
    await uploadMedia(jpeg, cfg, { transport, onProgress: (loaded) => seen.push(loaded) });
    expect(seen).toEqual([4, 8]);
  });
});

describe('a 2xx is not automatically a success', () => {
  it('refuses a body with no media URL rather than reporting a stored file', async () => {
    const { transport } = stubTransport({ status: 201, body: JSON.stringify({ ok: true }) });
    const outcome = await uploadMedia(jpeg, cfg, { transport });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure.code).toBe('unexpected');
    expect(!outcome.ok && outcome.failure.message).toContain('did not return a media URL');
  });

  it('refuses a 200 carrying HTML from a proxy', async () => {
    const { transport } = stubTransport({ status: 200, body: '<html>login</html>' });
    expect((await uploadMedia(jpeg, cfg, { transport })).ok).toBe(false);
  });

  it('refuses a body whose kind is not one the story schema knows', async () => {
    const { transport } = stubTransport({
      status: 201,
      body: JSON.stringify({ key: 'k', url: 'http://x/y', contentType: 'image/jpeg', kind: 'sculpture' }),
    });
    expect((await uploadMedia(jpeg, cfg, { transport })).ok).toBe(false);
  });
});

describe('failures reach the caller named', () => {
  it('turns the server’s status into a coded failure', async () => {
    for (const [status, code] of [
      [401, 'unauthenticated'],
      [413, 'too_large'],
      [415, 'unsupported_type'],
      [503, 'not_configured'],
      [502, 'storage_unavailable'],
    ] as const) {
      const { transport } = stubTransport({ status, body: '{}' });
      const outcome = await uploadMedia(jpeg, cfg, { transport });
      expect(!outcome.ok && outcome.failure.code, `status ${status}`).toBe(code);
    }
  });

  it('a dead network is not confused with a refusal', async () => {
    const transport: UploadTransport = async () => {
      throw new Error('network');
    };
    const outcome = await uploadMedia(jpeg, cfg, { transport });
    expect(!outcome.ok && outcome.failure.code).toBe('network');
    // CORS and "server is down" are indistinguishable from the browser, so the
    // message says both rather than asserting the more likely one.
    expect(!outcome.ok && outcome.failure.message).toContain('CORS');
  });

  it('a cancelled upload is not an error message', async () => {
    const transport: UploadTransport = async () => {
      throw new UploadAborted();
    };
    const outcome = await uploadMedia(jpeg, cfg, { transport });
    expect(!outcome.ok && outcome.failure.code).toBe('aborted');
  });

  it('never puts a query string into a message', async () => {
    // Operators do paste tokens into URLs, and an error string ends up in the
    // DOM and in screenshots.
    const transport: UploadTransport = async () => {
      throw new Error('network');
    };
    const outcome = await uploadMedia(jpeg, { baseUrl: 'http://api.test/api?token=secret-jwt' }, { transport });
    expect(!outcome.ok && outcome.failure.message).not.toContain('secret-jwt');
  });
});

describe('asking what the server accepts', () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('reads the limits the server published', async () => {
    const cap = await fetchUploadCapability(cfg, {
      fetchImpl: respond(200, { configured: true, maxBytes: 100, contentTypes: ['image/png'] }),
    });
    expect(cap).toEqual({ configured: true, maxBytes: 100, contentTypes: ['image/png'] });
  });

  it('carries the server’s reason when storage is off', async () => {
    const cap = await fetchUploadCapability(cfg, {
      fetchImpl: respond(200, { configured: false, maxBytes: 0, contentTypes: [], reason: 'S3_BUCKET is unset.' }),
    });
    expect(cap.configured).toBe(false);
    expect(cap.reason).toBe('S3_BUCKET is unset.');
  });

  it('reports “unavailable”, not “available”, when the API cannot be reached', async () => {
    // Defaulting to available would put an enabled upload button in front of
    // someone whose API is down — a control that appears to work and cannot.
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const cap = await fetchUploadCapability(cfg, { fetchImpl });
    expect(cap.configured).toBe(false);
    expect(cap.reason).toContain('CORS');
  });

  it('refuses a 200 that is not an upload configuration', async () => {
    // A login page or a proxy answering 200 with HTML would otherwise cast to a
    // capability whose maxBytes is undefined — every size check silently
    // passing, which is a check that does nothing.
    const cap = await fetchUploadCapability(cfg, { fetchImpl: respond(200, '<html>login</html>') });
    expect(cap.configured).toBe(false);
    expect(cap.maxBytes).toBe(0);
    expect(cap.reason).toContain('may not be an Atlas server');
  });

  it('refuses a configuration missing the fields the checks depend on', async () => {
    const cap = await fetchUploadCapability(cfg, { fetchImpl: respond(200, { configured: true }) });
    expect(cap.configured).toBe(false);
  });

  it('a 401 on the config route says the viewer is not signed in', async () => {
    const cap = await fetchUploadCapability(cfg, { fetchImpl: respond(401, { error: 'unauthenticated' }) });
    expect(cap.configured).toBe(false);
    expect(cap.reason).toContain('sign-in');
  });

  it('sends the token when there is one', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ configured: true, maxBytes: 1, contentTypes: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    await fetchUploadCapability({ ...cfg, token: 'tok' }, { fetchImpl });
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
});

describe('configuration and the story entity', () => {
  it('reads VITE_ATLAS_API, and is null when it is unset', () => {
    expect(atlasApiFromEnv({ VITE_ATLAS_API: 'http://localhost:8787/api/' })).toEqual({
      baseUrl: 'http://localhost:8787/api',
    });
    expect(atlasApiFromEnv({})).toBeNull();
    expect(atlasApiFromEnv({ VITE_ATLAS_API: '   ' })).toBeNull();
  });

  it('turns an upload into a MediaItem the story can hold', () => {
    const item = mediaItemFromUpload(
      {
        key: 'u/user_alice-0123456789abcdef/00112233445566778899aabbccddeeff.jpg',
        url: 'http://api.test/api/media/o/u/user_alice-0123456789abcdef/00112233445566778899aabbccddeeff.jpg',
        contentType: 'image/jpeg',
        kind: 'image',
        bytes: 8,
      },
      { caption: 'The harbour' },
    );
    // `uri` must be the absolute URL, never the key: a story is opened from
    // other origins, and a key resolves against whichever page holds it.
    expect(item.uri).toContain('http://api.test/');
    expect(item.kind).toBe('image');
    expect(item.caption).toBe('The harbour');
    // Derived from the object key, which is unique per upload — so attaching
    // the same object twice cannot mint two entries fighting over one asset.
    expect(item.id).toBe('media_upload_00112233445566778899aabbccddeeff');
  });
});
