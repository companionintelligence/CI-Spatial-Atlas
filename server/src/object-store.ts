/**
 * Object storage for uploaded media — configuration, key derivation, limits.
 *
 * `docker-compose.yml` has run a MinIO service and passed `S3_ENDPOINT` /
 * `S3_BUCKET` to the API container since the scaffold was written, and until
 * now **nothing in `server/src` read either one**. That is the shape of the gap
 * this module closes: the infrastructure existed, the code to use it did not,
 * so "photos from your computer" was unreachable however the compose file
 * looked.
 *
 * ── Why the bytes go through the API rather than a presigned PUT ───────────
 *
 * A presigned PUT is the better shape *when the browser can reach the object
 * store*, and here it cannot — not as an accident of this deployment but as a
 * property of every configuration this repo ships:
 *
 *   1. The only endpoint Atlas is given is `http://minio:9000`, a Compose
 *      network name. A presigned URL is signed **over the host header** (SigV4),
 *      so the URL cannot be rewritten to `localhost:9000` after signing without
 *      invalidating the signature. Handing the browser a URL it resolves to
 *      nothing is precisely the failure this codebase keeps paying for: the
 *      upload control looks finished, the API returns 200 with a URL, and the
 *      PUT dies in the browser with a DNS error nobody sees.
 *   2. A browser PUT to MinIO is a cross-origin request with a custom method,
 *      so it needs a bucket CORS policy allowing the viewer's origin. Nothing
 *      in this repo sets one, and nothing in this repo *can* — it is `mc admin`
 *      state, not a file.
 *   3. A presigned PUT cannot carry a size cap. Only a POST *policy* can
 *      (`content-length-range`), which is a different, multipart-form protocol.
 *      With a plain presigned PUT the server-side size limit the brief asks for
 *      would simply not exist; the browser check would be the only one, and a
 *      browser check is not a check.
 *
 * Proxying costs one buffered copy of the file in the API process (bounded by
 * the cap below, and rejected *while streaming* rather than after the whole
 * body has arrived — see `readCapped`). That is the price of a path that works
 * on an unmodified `docker compose up`. If a deployment later publishes MinIO
 * at a browser-reachable origin and sets a bucket CORS policy, a presigned PUT
 * becomes worth adding *beside* this, gated on that origin being configured —
 * not instead of it.
 *
 * ── Configuration ─────────────────────────────────────────────────────────
 *   S3_ENDPOINT      e.g. http://minio:9000 (scheme decides TLS; port optional)
 *   S3_BUCKET        e.g. atlas
 *   S3_ACCESS_KEY    MinIO access key   ─┐ no defaults, deliberately: see
 *   S3_SECRET_KEY    MinIO secret key   ─┘ `objectStoreConfigFromEnv`
 *   S3_REGION        optional; MinIO ignores it, real S3 does not
 *   ATLAS_MAX_UPLOAD_BYTES        default 33554432 (32 MiB)
 *   ATLAS_UPLOAD_CONTENT_TYPES    comma-separated allowlist; default below
 *
 * Everything here is pure except `minioObjectStore()`: the config reader, the
 * key derivation, the allowlist and the streaming cap are all unit-testable
 * with no MinIO and no network, which is what lets `server/test/media-*.test.ts`
 * cover the authorisation and refusal paths on every machine.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

import { Client as MinioClient } from 'minio';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** 32 MiB. Large enough for a phone photo or a short clip, small enough that a
 *  handful of concurrent uploads cannot exhaust the API process's heap — the
 *  direct consequence of proxying the bytes rather than presigning. */
export const DEFAULT_MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * Types the store will accept.
 *
 * `image/svg+xml` is **absent on purpose** and must stay absent. An SVG is a
 * document that can carry script, so an SVG served back from the API's own
 * origin is stored XSS against the API — the same reasoning that makes
 * `viewer-react/src/ui/safeUrl.ts` refuse `data:` URLs for media. The download
 * route additionally sends `X-Content-Type-Options: nosniff`, so a file that
 * lies about its type cannot be re-sniffed into HTML either; the allowlist and
 * the header are two independent halves of the same guarantee.
 */
export const DEFAULT_UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;

export interface UploadLimits {
  maxBytes: number;
  /** Lower-cased, parameter-free media types. */
  contentTypes: string[];
}

/** Read the limits from env, falling back to the defaults above. A malformed
 *  or non-positive `ATLAS_MAX_UPLOAD_BYTES` falls back rather than throwing:
 *  a typo in an env var must not turn into an unbounded upload. */
export function uploadLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): UploadLimits {
  const raw = Number(env.ATLAS_MAX_UPLOAD_BYTES);
  const maxBytes = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_UPLOAD_BYTES;
  const listed = (env.ATLAS_UPLOAD_CONTENT_TYPES ?? '')
    .split(',')
    .map((s) => normaliseContentType(s))
    .filter((s): s is string => s !== null);
  return { maxBytes, contentTypes: listed.length > 0 ? listed : [...DEFAULT_UPLOAD_CONTENT_TYPES] };
}

/**
 * `Image/JPEG; charset=binary` → `image/jpeg`, and anything that is not a media
 * type at all → null.
 *
 * The parameters have to go before the allowlist is consulted: browsers do send
 * them (a `File` picked on Windows can arrive as `image/jpeg;`), and an
 * allowlist compared against the raw header would refuse a legitimate photo
 * while a caller who appended a parameter to a *banned* type would slip past a
 * naive `startsWith`.
 */
export function normaliseContentType(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const type = raw.split(';')[0]!.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) ? type : null;
}

/** The story-schema `MediaItem.kind` this content type becomes, so the caller
 *  can build a MediaItem without re-parsing the type. */
export function mediaKindFor(contentType: string): 'image' | 'video' {
  return contentType.startsWith('video/') ? 'video' : 'image';
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

/**
 * A file extension for the object key.
 *
 * Cosmetic for us — the download route serves the content type recorded on the
 * object, never a type guessed from the name — but it is what makes an object
 * recognisable in the MinIO console and in a `mc ls`, which is where an
 * operator debugging a missing photo actually looks. Unknown types get a
 * sanitised subtype rather than nothing, so an allowlist extended by env still
 * produces readable keys.
 */
export function extensionFor(contentType: string): string {
  const known = EXTENSIONS[contentType];
  if (known) return known;
  const sub = contentType.split('/')[1]?.replace(/[^a-z0-9]/g, '').slice(0, 8);
  return sub ? `.${sub}` : '';
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * The key prefix that scopes an object to one verified subject.
 *
 * Two properties matter, and the obvious one-line implementations get one of
 * them wrong:
 *
 *   • **Path-safe.** An OIDC `sub` is an opaque string. Portal's happen to be
 *     `user_…`, but nothing guarantees that, and a subject containing `/` or
 *     `..` interpolated straight into a key would let one caller write outside
 *     their own prefix — into the 3D-tiles output the worker writes to the same
 *     bucket, for instance.
 *   • **Injective.** Sanitising alone is not: `a/b` and `a_b` both slug to
 *     `a_b`, and two subjects sharing a prefix share an object namespace, which
 *     is a cross-tenant bug rather than a cosmetic one. The 16-hex digest of the
 *     *raw* subject is what keeps distinct subjects distinct; the readable slug
 *     is there so an operator can tell whose objects they are looking at.
 */
export function subjectPrefix(subject: string): string {
  const slug =
    subject
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 40) || 'subject';
  const digest = createHash('sha256').update(subject, 'utf8').digest('hex').slice(0, 16);
  return `${slug}-${digest}`;
}

/**
 * A fresh key for one upload: `u/<subject-prefix>/<128 random bits><ext>`.
 *
 * The random component is 128 bits because the download route serves an object
 * to whoever holds its key (see `media.ts` — an `<img src>` cannot send an
 * `Authorization` header), so the key *is* the capability. Guessing must be
 * infeasible, and the name must not leak the uploader's filename either: a
 * filename is user data, often a date or a place, and it would end up in a
 * shared URL.
 */
export function newObjectKey(subject: string, contentType: string): string {
  return `u/${subjectPrefix(subject)}/${hex(randomBytes(16))}${extensionFor(contentType)}`;
}

/** `Buffer#toString('hex')`, spelled without it: `@cloudflare/workers-types`'
 *  `Buffer` shim (this module also compiles under the Worker's tsconfig, for
 *  the key/validation helpers the Worker entry point reuses) doesn't model
 *  that overload, so this iterates bytes instead — identical output, and
 *  correct under both the Node and Workers `Buffer`. */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Exactly the shape `newObjectKey` produces — nothing else may be fetched.
 *
 * The download route takes the key from the URL, so without this a caller could
 * ask for any object in the bucket: the worker's generated 3D Tiles, another
 * service's data, whatever else the deployment stores there. Validating the
 * shape (rather than merely rejecting `..`) means the route can only ever reach
 * objects this module wrote.
 */
const OBJECT_KEY_RE = /^u\/[a-z0-9._-]{1,60}-[0-9a-f]{16}\/[0-9a-f]{32}(?:\.[a-z0-9]{1,8})?$/;

export function isUploadKey(key: string): boolean {
  // The `..` test is redundant against the pattern above and kept anyway: it is
  // the one property a future loosening of the pattern must not lose.
  return !key.includes('..') && OBJECT_KEY_RE.test(key);
}

/** True when `key` sits under `subject`'s prefix. Not used to gate reads (the
 *  key is the capability); used to answer "is this mine" for deletes and for
 *  the tests that prove the scoping is real. */
export function keyBelongsTo(key: string, subject: string): boolean {
  return key.startsWith(`u/${subjectPrefix(subject)}/`);
}

// ---------------------------------------------------------------------------
// Reading the body, under a cap
// ---------------------------------------------------------------------------

export type CappedRead =
  | { ok: true; body: Buffer }
  | {
      ok: false;
      reason: 'too_large';
      maxBytes: number;
      /** True when the rest of the body was read and discarded, so the caller's
       *  413 will reach the client; false when the source had to be cut off. */
      drained: boolean;
    };

/**
 * Collect a request body, refusing as soon as it passes `maxBytes`.
 *
 * "As soon as" is the point: `Content-Length` is a claim by the client and a
 * chunked request makes none at all, so the only real limit is one that counts
 * bytes as they arrive. Nothing over the cap is ever retained.
 *
 * ## Why it keeps reading after it has decided to refuse
 *
 * Destroying the stream on the first chunk past the cap is the obvious move and
 * it produces a **worse user-visible failure than the one it prevents**: the
 * client is still writing, the socket dies under it, and the 413 the route is
 * about to send never arrives. Measured against this server, that is
 * `ECONNRESET` at the browser — which a client can only report as "the network
 * failed", sending someone to look at their connection over a file that was
 * simply too big.
 *
 * So an over-cap body is *discarded* rather than cut off: memory stays bounded
 * (the buffer is dropped immediately; nothing past the cap is kept), the client
 * finishes its write, and the refusal is delivered as a 413 that names the
 * limit. The drain is itself bounded — one further `maxBytes` — because
 * "politely read forever" is a denial-of-service vector. Past that the stream
 * is destroyed and `drained: false` records that the client may see a reset
 * instead. In practice almost nothing reaches that branch: a browser uploading
 * a `File` always sends a `Content-Length`, which the route refuses before
 * reading a byte.
 *
 * Pure enough to test with `Readable.from([...])`; no Fastify, no MinIO.
 */
export async function readCapped(
  stream: Readable,
  maxBytes: number,
  drainBytes = maxBytes,
): Promise<CappedRead> {
  let chunks: Buffer[] = [];
  let overflowed = false;
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > maxBytes) {
      // Drop everything already buffered the moment the answer is "no": holding
      // it while draining would keep a rejected upload's memory for the whole
      // drain, which is the cost this cap exists to avoid.
      chunks = [];
      overflowed = true;
      if (total > maxBytes + drainBytes) {
        stream.destroy();
        return { ok: false, reason: 'too_large', maxBytes, drained: false };
      }
      continue;
    }
    chunks.push(buf);
  }
  if (overflowed) return { ok: false, reason: 'too_large', maxBytes, drained: true };
  return { ok: true, body: Buffer.concat(chunks) };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ObjectStoreConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
}

export type ObjectStoreConfigResult =
  | { configured: true; config: ObjectStoreConfig }
  | { configured: false; missing: string[]; reason: string };

const CONFIG_VARS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const;

/**
 * Read the object-store configuration, or say precisely what is missing.
 *
 * There is deliberately **no default credential pair**, even though this repo's
 * compose file happens to start MinIO as `atlas`/`atlas-secret`. Defaulting
 * them would mean a deployment that forgot to set credentials silently reaches
 * for a well-known pair — either succeeding against an object store anybody can
 * also reach, or failing with an authentication error that points at the wrong
 * thing entirely. Missing configuration must read as missing configuration.
 *
 * Note what this implies for the compose file as it stands today: `atlas-api`
 * is given `S3_ENDPOINT` and `S3_BUCKET` but no keys, so uploads report
 * "storage is not configured" until the keys are added. That is the honest
 * answer for that configuration, and the message below names the two variables.
 */
export function objectStoreConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStoreConfigResult {
  const values = {
    S3_ENDPOINT: env.S3_ENDPOINT?.trim() ?? '',
    S3_BUCKET: env.S3_BUCKET?.trim() ?? '',
    S3_ACCESS_KEY: env.S3_ACCESS_KEY?.trim() ?? '',
    S3_SECRET_KEY: env.S3_SECRET_KEY?.trim() ?? '',
  };
  const missing = CONFIG_VARS.filter((k) => values[k] === '');
  if (missing.length > 0) return { configured: false, missing: [...missing], reason: storageUnavailableMessage(missing) };
  return {
    configured: true,
    config: {
      endpoint: values.S3_ENDPOINT,
      bucket: values.S3_BUCKET,
      accessKey: values.S3_ACCESS_KEY,
      secretKey: values.S3_SECRET_KEY,
      region: env.S3_REGION?.trim() || undefined,
    },
  };
}

/**
 * What the API tells a caller when there is nowhere to put a file.
 *
 * Most developers running this repo will not have MinIO up — it exists in
 * exactly one place, `docker-compose.yml` — so this is a *routine* state, not
 * an exceptional one, and it gets a routine, actionable message rather than a
 * stack trace or an opaque 500. It names the variables that are unset and the
 * one command that brings the store up, because "storage is not configured" on
 * its own sends someone reading source to find out which storage.
 */
export function storageUnavailableMessage(missing: readonly string[]): string {
  return [
    `Media storage is not configured on this server: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} unset.`,
    'Uploads are unavailable until an S3-compatible object store is configured.',
    'For local development: `docker compose up minio`, then set S3_ENDPOINT=http://localhost:9000,',
    'S3_BUCKET=atlas, S3_ACCESS_KEY and S3_SECRET_KEY (the MinIO root user/password) for the API.',
  ].join(' ');
}

/** Split `http://minio:9000` into what the MinIO client constructor wants. The
 *  scheme decides TLS; an absent port defaults per scheme, as a URL does. */
export function parseEndpoint(endpoint: string): { endPoint: string; port: number; useSSL: boolean } {
  const url = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `http://${endpoint}`);
  const useSSL = url.protocol === 'https:';
  return { endPoint: url.hostname, port: url.port ? Number(url.port) : useSSL ? 443 : 80, useSSL };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface StoredObject {
  stream: Readable;
  size: number;
  contentType: string;
}

/**
 * The two operations the API needs, as an interface rather than a MinIO client.
 *
 * Not abstraction for its own sake: it is what lets the whole upload surface —
 * the 401, the 403, the 413, the 415, the 503, the key scoping — be tested
 * without a container, on a laptop, in CI. A suite that can only run where
 * MinIO runs is a suite that does not run.
 */
export interface ObjectStore {
  /** Human description for logs and diagnostics. Never includes the secret. */
  describe(): string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Null when the object is absent, so the route can answer 404 rather than
   *  turning a missing file into a 500. */
  get(key: string): Promise<StoredObject | null>;
}

/** A MinIO-backed store, or null when the environment has not configured one. */
export function objectStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStore | null {
  const result = objectStoreConfigFromEnv(env);
  return result.configured ? minioObjectStore(result.config) : null;
}

export function minioObjectStore(config: ObjectStoreConfig): ObjectStore {
  const { endPoint, port, useSSL } = parseEndpoint(config.endpoint);
  const client = new MinioClient({
    endPoint,
    port,
    useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    ...(config.region ? { region: config.region } : {}),
  });

  return {
    describe: () => `MinIO bucket "${config.bucket}" at ${config.endpoint}`,
    async put(key, body, contentType) {
      // The size is passed explicitly. With an unknown size the client starts a
      // multipart upload, and a failure part-way through leaves an incomplete
      // upload occupying the bucket until a lifecycle rule reaps it; a single
      // sized PUT either lands or does not.
      await client.putObject(config.bucket, key, body, body.length, { 'Content-Type': contentType });
    },
    async get(key) {
      let stat;
      try {
        stat = await client.statObject(config.bucket, key);
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      const stream = await client.getObject(config.bucket, key);
      return {
        stream,
        size: stat.size,
        // Trust what we recorded at upload time; fall back to a type no browser
        // will ever render as a document rather than guessing from the key.
        contentType: normaliseContentType(stat.metaData?.['content-type']) ?? 'application/octet-stream',
      };
    },
  };
}

/** MinIO reports a missing object as `NoSuchKey`/`NotFound` with a 404 code —
 *  a normal answer for a stale URL, not an outage, so it must not become a 500. */
function isNotFound(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number } | null;
  return e?.code === 'NoSuchKey' || e?.code === 'NotFound' || e?.statusCode === 404;
}
