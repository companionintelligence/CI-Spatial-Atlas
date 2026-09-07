/**
 * The two network calls behind an upload, over an injectable transport.
 *
 * `GET  /api/media/config`  what this server accepts, asked before a picker opens
 * `POST /api/media`         the bytes, with progress, cancellable
 *
 * ## Why XHR and not fetch
 *
 * `fetch` still cannot report **upload** progress in any shipping browser —
 * `ReadableStream` request bodies exist but are half-duplex and unsupported
 * where it would matter. A photo or a short video over a phone connection is
 * exactly the case where a progress bar is the difference between "working" and
 * "frozen", so the upload uses `XMLHttpRequest` (which has had `upload.onprogress`
 * forever) and the capability check — a tiny JSON GET — uses `fetch`.
 *
 * Both are injectable. Not for purity's sake: it is what lets every failure
 * path in `mediaUpload.ts` — the 401, the 413, the 503, the network error, the
 * cancel — be exercised in node with no browser and no server, which is the
 * only way those paths get tested at all.
 *
 * ## Configuration, and the honest state of it
 *
 * `VITE_ATLAS_API` has existed in `.env.default` with the comment that nothing
 * reads it. This module is its first reader. It ships empty, so
 * `atlasApiFromEnv` returns null in every configuration checked into this repo
 * and a panel must render its control disabled with `NO_API_CONFIGURED` rather
 * than offering an upload that has nowhere to go.
 *
 * The token is the other half, and it is not solved here: the viewer has no
 * sign-in flow (see `src/auth/portal.ts`, deliberately unwired). So `token` is
 * a caller-supplied field — whatever the app obtains once that lands — and
 * without one the API answers 401, which `describeFailure` reports as exactly
 * that rather than as a generic failure.
 */

import type { MediaItem } from '@companion-atlas/story';

import {
  describeFailure,
  type UploadCapability,
  type UploadFailure,
  type UploadableFile,
  type UploadedMedia,
} from './mediaUpload.js';

export interface AtlasApiConfig {
  /** Base URL of the Atlas API, e.g. `http://localhost:8787/api`. */
  baseUrl: string;
  /** Companion OIDC access token, when the app has one. */
  token?: string;
}

export const NO_API_CONFIGURED =
  'No Atlas API is configured for this viewer, so there is nowhere to upload files. ' +
  'Set VITE_ATLAS_API (e.g. http://localhost:8787/api) and rebuild — Vite inlines it at build time.';

/** Read the API base from Vite env, or null when it is unset. */
export function atlasApiFromEnv(env: Record<string, string | undefined>): AtlasApiConfig | null {
  const baseUrl = env.VITE_ATLAS_API?.trim();
  return baseUrl ? { baseUrl: baseUrl.replace(/\/+$/, '') } : null;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  body: Blob | ArrayBuffer;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

export interface TransportResponse {
  status: number;
  /** Raw text. Parsed by `describeFailure`, which tolerates non-JSON. */
  body: string;
}

/** Rejects only for reasons that are not an HTTP answer: network, CORS, abort. */
export type UploadTransport = (req: TransportRequest) => Promise<TransportResponse>;

export class UploadAborted extends Error {
  constructor() {
    super('upload aborted');
    this.name = 'UploadAborted';
  }
}

/** The real transport. Untested by design — everything decidable lives in
 *  `mediaUpload.ts`; what is left here is the browser API surface itself. */
export function xhrTransport(req: TransportRequest): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', req.url, true);
    for (const [k, v] of Object.entries(req.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => req.onProgress?.(e.loaded, e.lengthComputable ? e.total : 0);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    // A cross-origin refusal and a dead network are indistinguishable from
    // here — the browser hands JS neither status nor body — so the message says
    // both possibilities rather than asserting the more likely one.
    xhr.onerror = () => reject(new Error('network'));
    xhr.onabort = () => reject(new UploadAborted());
    req.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(req.body as XMLHttpRequestBodyInit);
  });
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export interface UploadOptions {
  transport?: UploadTransport;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Ask what this server accepts.
 *
 * A failure to *ask* is reported as an unconfigured capability rather than
 * thrown: a panel that cannot reach the API should show its control disabled
 * with the reason, not crash a render or offer an upload that will fail. The
 * distinction between "the server says storage is off" and "the server did not
 * answer" survives in the message.
 */
export async function fetchUploadCapability(
  cfg: AtlasApiConfig,
  opts: UploadOptions = {},
): Promise<UploadCapability> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(`${cfg.baseUrl}/media/config`, {
      headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {},
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') throw err;
    return {
      configured: false,
      maxBytes: 0,
      contentTypes: [],
      reason: `Couldn't reach the Atlas API at ${redact(cfg.baseUrl)} to ask whether uploads are available. If the server is up, it is likely CORS: the API must allow this origin.`,
    };
  }
  const text = await res.text();
  if (!res.ok) {
    const failure = describeFailure(res.status, text);
    return { configured: false, maxBytes: 0, contentTypes: [], reason: failure.message };
  }
  const parsed = parseCapability(text);
  return (
    parsed ?? {
      configured: false,
      maxBytes: 0,
      contentTypes: [],
      reason: `The Atlas API at ${redact(cfg.baseUrl)} answered something other than an upload configuration. It may not be an Atlas server, or a proxy may be answering in its place.`,
    }
  );
}

/**
 * Validate the shape rather than casting.
 *
 * The answer comes from a URL an operator typed into an env var, and a proxy or
 * a login page answering 200 with HTML is the ordinary way this goes wrong. A
 * cast would make `capability.maxBytes` `undefined`, `validateFile` compare
 * against it, and every file silently pass a check that was doing nothing.
 */
function parseCapability(text: string): UploadCapability | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.configured !== 'boolean' || typeof v.maxBytes !== 'number') return null;
  if (!Array.isArray(v.contentTypes) || v.contentTypes.some((t) => typeof t !== 'string')) return null;
  return {
    configured: v.configured,
    maxBytes: v.maxBytes,
    contentTypes: v.contentTypes as string[],
    ...(typeof v.reason === 'string' ? { reason: v.reason } : {}),
  };
}

export type UploadOutcome = { ok: true; media: UploadedMedia } | { ok: false; failure: UploadFailure };

/**
 * Send one file and resolve with either the stored media or a named failure.
 *
 * Resolves rather than throws for every *answer* — an outcome the caller has to
 * show either way — and only the aborted case is distinguished, because a user
 * who cancelled does not want an error message about it.
 *
 * The body is the raw file: no multipart wrapper, so `Content-Type` is the
 * file's own type and the server's allowlist reads it directly. This is also
 * what keeps the browser from base64-inflating a video by a third.
 */
export async function uploadMedia(
  file: UploadableFile & { slice?: unknown },
  cfg: AtlasApiConfig,
  opts: UploadOptions = {},
): Promise<UploadOutcome> {
  const transport = opts.transport ?? xhrTransport;
  let res: TransportResponse;
  try {
    res = await transport({
      url: `${cfg.baseUrl}/media`,
      headers: {
        // An empty `File.type` would send no content type at all and earn a 415
        // naming a "missing content type", which is accurate but useless. The
        // fallback makes the server's refusal name a real type instead.
        'content-type': file.type || 'application/octet-stream',
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: file as unknown as Blob,
      signal: opts.signal,
      onProgress: opts.onProgress,
    });
  } catch (err) {
    if (err instanceof UploadAborted || (err as { name?: string } | null)?.name === 'AbortError') {
      return { ok: false, failure: { code: 'aborted', message: 'Upload cancelled. Nothing was stored.' } };
    }
    return {
      ok: false,
      failure: {
        code: 'network',
        message: `Couldn't reach the Atlas API at ${redact(cfg.baseUrl)}. The server may be down, or it may be refusing this origin (CORS) — the browser does not tell us which.`,
      },
    };
  }

  if (res.status < 200 || res.status >= 300) return { ok: false, failure: describeFailure(res.status, res.body) };

  const media = parseUploaded(res.body);
  if (!media) {
    // A 2xx whose body is not an upload result means something answered in the
    // API's place. Reporting success here would hand a panel an `undefined` URL
    // and produce a media entry that paints nothing — the exact "looks like it
    // worked" failure this module is written to avoid.
    return {
      ok: false,
      failure: {
        code: 'unexpected',
        message: 'The upload was accepted but the server did not return a media URL, so there is nothing to attach.',
        status: res.status,
      },
    };
  }
  return { ok: true, media };
}

function parseUploaded(text: string): UploadedMedia | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.url !== 'string' || !v.url) return null;
  if (typeof v.key !== 'string' || typeof v.contentType !== 'string') return null;
  if (v.kind !== 'image' && v.kind !== 'video') return null;
  return {
    url: v.url,
    key: v.key,
    contentType: v.contentType,
    kind: v.kind,
    bytes: typeof v.bytes === 'number' ? v.bytes : 0,
  };
}

/** Strip any query/fragment before a URL goes into a message. Operators do put
 *  tokens in URLs, and an error string ends up in the DOM and in screenshots —
 *  the same rule `memory/client.ts` applies to its endpoint. */
function redact(url: string): string {
  return url.replace(/[?#].*$/, '');
}

// ---------------------------------------------------------------------------
// Turning an upload into something a story can hold
// ---------------------------------------------------------------------------

/**
 * The `MediaItem` an uploaded file becomes.
 *
 * Here rather than in each panel because both callers need the same three
 * things right — the id must be unique within the story, `uri` must be the
 * absolute URL the API returned (not the key), and `kind` must be the story
 * schema's vocabulary rather than a MIME type — and a second, slightly
 * different copy of that in the import panel is how the two drift.
 *
 * The id is derived from the object key, which is already random and unique per
 * upload, so re-attaching the same object twice cannot mint two entries that
 * fight over one asset.
 */
export function mediaItemFromUpload(
  media: UploadedMedia,
  extras: Partial<Pick<MediaItem, 'caption' | 'capturedAt' | 'location' | 'locationName' | 'thumbnailUri'>> = {},
): MediaItem {
  return {
    id: `media_upload_${media.key.split('/').pop()?.replace(/\.[^.]+$/, '') ?? media.key}`,
    kind: media.kind,
    uri: media.url,
    ...extras,
  };
}
