/**
 * Upload routes — "photos from your computer".
 *
 * Until now media could only arrive from Companion Memory or from a story
 * document that already pointed at hosted files. These three routes add the
 * missing path:
 *
 *   GET  /api/media/config     what this server will accept, or why it cannot
 *   POST /api/media            the bytes; returns the URL the viewer can use
 *   GET  /api/media/o/<key>    serves an uploaded object back
 *
 * Why the bytes are proxied instead of presigned is argued in `object-store.ts`;
 * the short version is that the only endpoint this repo configures is a Compose
 * network name the browser cannot resolve, and a presigned PUT cannot carry a
 * size cap anyway.
 *
 * ── Authorisation ─────────────────────────────────────────────────────────
 *
 * `POST /api/media` carries the same `authenticated` preHandler as every other
 * mutating route (it is *passed in* from `api.ts` rather than re-implemented
 * here — a second copy of an auth gate is a gate that will eventually differ
 * from the first), and the object key is derived from the verified subject, so
 * a caller can only ever write inside their own prefix. An upload endpoint that
 * accepted anonymous writes would be a worse bug than having no upload at all:
 * it is free storage and free bandwidth on somebody else's infrastructure, and
 * anything stored can be served.
 *
 * `GET /api/media/o/<key>` is deliberately **not** gated, and that is a real
 * trade-off rather than an oversight, so it is stated plainly:
 *
 *   • An `<img src>` / `<video src>` cannot send an `Authorization` header.
 *     A media URL that only works for `fetch()` would not render in the scene
 *     editor, in a slide background, or for anyone the story is shared with —
 *     which is the entire purpose of returning a URL.
 *   • So the key *is* the capability: 128 random bits, never derived from the
 *     filename, never listed by any route. Knowing a key is the only way to
 *     read an object, and the shape check (`isUploadKey`) means a caller cannot
 *     walk out of the upload namespace into anything else the bucket holds.
 *   • What this does not give you is revocation, or "shared with these people".
 *     A story published `unlisted` already has exactly this security model —
 *     an unguessable URL — so media matches the document it lives in. The
 *     honest next step, when Atlas grows per-object ACLs, is a short-lived
 *     signed query parameter on this route; that is a follow-up, not something
 *     to imply is already here.
 *
 * The response headers on that route matter as much as the allowlist: an
 * uploaded file is served from the API's own origin, so `nosniff` plus a
 * locked-down CSP is what stops a file that lies about its type from being
 * rendered as a document there.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';

import {
  isUploadKey,
  mediaKindFor,
  newObjectKey,
  normaliseContentType,
  readCapped,
  storageUnavailableMessage,
  type ObjectStore,
  type UploadLimits,
} from './object-store.js';

export interface MediaDeps {
  /** Null when the deployment has configured no object store. */
  objectStore: ObjectStore | null;
  limits: UploadLimits;
  /** Base URL of this API, e.g. `http://localhost:8787/api` — what the returned
   *  media URL is built from, so the viewer gets an absolute address that works
   *  from an origin other than the API's own. */
  apiBaseUrl: string;
  /** Why storage is unavailable, when it is. Carried from
   *  `objectStoreConfigFromEnv` so the message names the missing variables
   *  rather than being re-guessed here. */
  storageReason?: string;
}

/** Shape returned by `GET /api/media/config` and mirrored by the viewer client. */
export interface UploadCapability {
  configured: boolean;
  maxBytes: number;
  contentTypes: string[];
  /** Present only when `configured` is false. Operator-actionable. */
  reason?: string;
}

/** What a successful upload answers with. */
export interface UploadResult {
  key: string;
  url: string;
  contentType: string;
  kind: 'image' | 'video';
  bytes: number;
}

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerMediaRoutes(app: FastifyInstance, deps: MediaDeps, authenticated: PreHandler): void {
  const { limits } = deps;

  /**
   * Hand the raw request stream to the handler instead of parsing it.
   *
   * Fastify's own `bodyLimit` only applies to parsers that consume the body, so
   * taking the stream is also what puts the size limit under `readCapped`'s
   * control — where it can refuse *mid-stream* rather than after the whole file
   * has been buffered. Registered for image and video types only: anything else
   * gets Fastify's own 415 before reaching a handler, which is the correct
   * answer for a body this endpoint would refuse regardless.
   */
  const passthrough = (_req: FastifyRequest, payload: Readable, done: (err: Error | null, body?: unknown) => void) =>
    done(null, payload);
  app.addContentTypeParser(/^image\//, passthrough);
  app.addContentTypeParser(/^video\//, passthrough);
  app.addContentTypeParser('application/octet-stream', passthrough);

  const capability = (): UploadCapability => ({
    configured: deps.objectStore !== null,
    maxBytes: limits.maxBytes,
    contentTypes: limits.contentTypes,
    ...(deps.objectStore === null
      ? { reason: deps.storageReason ?? storageUnavailableMessage(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']) }
      : {}),
  });

  /**
   * What this server will accept — asked *before* a file is chosen.
   *
   * The whole point of publishing the limits is that the client can disable an
   * upload control, and say why, instead of letting someone pick a 200 MB video
   * and discover after the wait that storage was never configured. A control
   * that appears to work and cannot is the failure this endpoint exists to
   * prevent on the client side.
   */
  app.get('/api/media/config', { preHandler: authenticated }, async () => capability());

  app.post('/api/media', { preHandler: authenticated }, async (req, reply) => {
    // Storage first: when there is nowhere to put the file, no amount of
    // correct content type or size changes the answer, and the caller deserves
    // the actionable message rather than a complaint about their request.
    const store = deps.objectStore;
    if (!store) {
      return reply.code(503).send({ error: 'storage_not_configured', message: capability().reason });
    }

    const contentType = normaliseContentType(req.headers['content-type']);
    if (!contentType || !limits.contentTypes.includes(contentType)) {
      return reply.code(415).send({
        error: 'unsupported_media_type',
        message: `${contentType ?? 'A missing content type'} cannot be uploaded. Accepted types: ${limits.contentTypes.join(', ')}.`,
        contentTypes: limits.contentTypes,
      });
    }

    // A declared length over the cap is refused without reading a byte. It is
    // not a substitute for the streaming check below — `Content-Length` is a
    // claim, and a chunked upload makes none — but it turns the common honest
    // case (a 4K video picked by mistake) into an immediate answer.
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limits.maxBytes) {
      return reply.code(413).send(tooLarge(limits.maxBytes));
    }

    // A zero-length body never reaches a content-type parser, so `req.body` is
    // undefined rather than an empty stream — reading it as one would be a
    // TypeError presented to the caller as a 500, which is the wrong story
    // about a request that simply carried no file.
    const body = req.body as Readable | undefined;
    const read = body ? await readCapped(body, limits.maxBytes) : { ok: true as const, body: Buffer.alloc(0) };
    if (!read.ok) return reply.code(413).send(tooLarge(limits.maxBytes));
    if (read.body.length === 0) {
      return reply.code(400).send({
        error: 'empty_upload',
        message: 'The request carried no bytes. Nothing was stored.',
      });
    }

    const key = newObjectKey(req.auth.subject, contentType);
    try {
      await store.put(key, read.body, contentType);
    } catch (err) {
      // The object store being down is not the caller's fault and not a 500
      // from *this* service's perspective: 502 says "the thing behind me
      // failed", which is what an operator needs to read in a log. The detail
      // is logged, never returned — it can carry the endpoint and, depending on
      // the client, request signing material.
      req.log.error({ err, store: store.describe() }, 'media upload failed');
      return reply.code(502).send({
        error: 'storage_unavailable',
        message: 'The object store rejected the upload. Nothing was stored; the server log has the detail.',
      });
    }

    const result: UploadResult = {
      key,
      url: mediaUrl(deps.apiBaseUrl, key),
      contentType,
      kind: mediaKindFor(contentType),
      bytes: read.body.length,
    };
    return reply.code(201).send(result);
  });

  app.get<{ Params: { '*': string } }>('/api/media/o/*', async (req, reply) => {
    const key = req.params['*'] ?? '';
    // A key that is not one of ours is a 404 rather than a 400: the response
    // must not distinguish "malformed" from "absent", or it becomes an oracle
    // for probing what else lives in the bucket.
    if (!isUploadKey(key)) return reply.code(404).send({ error: 'not_found' });

    const store = deps.objectStore;
    if (!store) {
      return reply.code(503).send({ error: 'storage_not_configured', message: capability().reason });
    }

    let object;
    try {
      object = await store.get(key);
    } catch (err) {
      req.log.error({ err, store: store.describe() }, 'media fetch failed');
      return reply.code(502).send({ error: 'storage_unavailable' });
    }
    if (!object) return reply.code(404).send({ error: 'not_found' });

    return reply
      .header('content-type', object.contentType)
      .header('content-length', String(object.size))
      // Two independent guards against an uploaded file being interpreted as a
      // document on this origin: `nosniff` stops the browser second-guessing
      // the recorded type, and the CSP neuters anything that is somehow parsed
      // as markup anyway. `inline` because these are meant to be rendered in an
      // <img>, not downloaded.
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('content-disposition', 'inline')
      // Keys are immutable — a new upload is a new key — so the object at a URL
      // never changes and can be cached hard. `private` rather than `public`
      // because the URL is a capability and shared caches are somebody else's
      // storage policy.
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(object.stream);
  });
}

/** Absolute URL for an object key, given the API's public base URL. */
export function mediaUrl(apiBaseUrl: string, key: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/media/o/${key}`;
}

function tooLarge(maxBytes: number) {
  return {
    error: 'file_too_large',
    maxBytes,
    message: `This file is larger than the ${formatBytes(maxBytes)} this server accepts. Nothing was stored.`,
  };
}

/** Byte counts in the message a person reads. `33554432` in a UI is a number
 *  nobody can act on; "32 MB" is a file they can look at. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${round(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 * 1024) return `${round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${round(bytes / 1024)} kB`;
  return `${bytes} bytes`;
}

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
