/**
 * Uploading a file from your computer — the rules, the states, the messages.
 *
 * Media has only ever been able to reach a story from Companion Memory or from
 * a document that already pointed at hosted files, which is why "photos from
 * your computer" sits in the parity analysis as missing. The Atlas API now has
 * an upload endpoint (`server/src/media.ts`); this is the half that lives in
 * the browser, split so that everything decidable *without* a network or a DOM
 * is decidable here and testable in node:
 *
 *   mediaUpload.ts   what may be uploaded, what a failure means, what state the
 *                    UI is in — all pure.
 *   uploadClient.ts  the two network calls, over an injectable transport.
 *   useMediaUpload.ts a React hook over the two, for a panel to call.
 *
 * ## The one rule this module exists to keep
 *
 * The browser's checks are a **courtesy**, never the enforcement. The server
 * owns the size cap and the content-type allowlist (`ATLAS_MAX_UPLOAD_BYTES`,
 * `ATLAS_UPLOAD_CONTENT_TYPES`), publishes them at `GET /api/media/config`, and
 * re-checks every byte regardless of what the client believed. So
 * `validateFile` below is here to save someone a two-minute upload that was
 * always going to be refused — not to decide anything. When the two disagree,
 * the server is right and `describeFailure` prefers the server's own words.
 *
 * ## Why the failure vocabulary is this specific
 *
 * "Upload failed" is the message that costs the most time in this codebase.
 * These five outcomes want five different actions from whoever is looking at
 * the panel, and flattening them means the person tries the wrong one:
 *
 *   not_configured      the deployment has no object store — nothing the user
 *                       can do; an operator sets S3_* (most developers running
 *                       this repo are in exactly this state, because MinIO
 *                       exists only in docker-compose.yml)
 *   unauthenticated     the API wants a token this viewer has not got
 *   too_large           pick a smaller file, and here is the actual limit
 *   unsupported_type    pick a different file, and here are the types
 *   storage_unavailable the store is configured and down — retry, then tell
 *                       an operator
 *
 * Anything unrecognised stays `unexpected` and carries the server's text
 * verbatim rather than being paraphrased into a guess.
 */

/** What the server said it will accept — `GET /api/media/config`. */
export interface UploadCapability {
  configured: boolean;
  maxBytes: number;
  contentTypes: string[];
  /** Present only when `configured` is false; operator-actionable, from the
   *  server, which is the side that knows which variables are unset. */
  reason?: string;
}

/** A stored object, as `POST /api/media` describes it. */
export interface UploadedMedia {
  /** Absolute URL a browser can put in an `<img src>` / `<video src>`. */
  url: string;
  key: string;
  contentType: string;
  kind: 'image' | 'video';
  bytes: number;
}

export type UploadFailureCode =
  | 'not_configured'
  | 'unauthenticated'
  | 'forbidden'
  | 'too_large'
  | 'unsupported_type'
  | 'empty'
  | 'storage_unavailable'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface UploadFailure {
  code: UploadFailureCode;
  /** Shown to a person. Never a bare status code. */
  message: string;
  /** HTTP status, when there was one. Absent for network and abort failures. */
  status?: number;
}

/** The minimum of `File` this module needs — so every rule here is testable
 *  with a plain object, in node, without a DOM or a `File` polyfill. */
export interface UploadableFile {
  name: string;
  size: number;
  type: string;
}

// ---------------------------------------------------------------------------
// Client-side pre-checks
// ---------------------------------------------------------------------------

/** `Image/JPEG; charset=binary` → `image/jpeg`. Same normalisation the server
 *  applies, because a client that compares raw header text against the
 *  allowlist refuses files the server would happily take. */
export function normaliseContentType(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const type = raw.split(';')[0]!.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) ? type : null;
}

/**
 * Would this file be refused, and why — asked before a byte is sent.
 *
 * Returns null when there is nothing to object to. It deliberately does *not*
 * decide that the upload will succeed: the server re-checks everything, and an
 * empty `File.type` (which happens: some browsers report nothing for an
 * unfamiliar extension) is passed through to the server rather than refused
 * here, because the server is the one holding the allowlist.
 */
export function validateFile(file: UploadableFile, capability: UploadCapability | null): UploadFailure | null {
  if (capability && !capability.configured) {
    return { code: 'not_configured', message: capability.reason ?? STORAGE_NOT_CONFIGURED };
  }
  if (file.size === 0) {
    return { code: 'empty', message: `“${file.name}” is empty — there is nothing to upload.` };
  }
  if (capability && file.size > capability.maxBytes) {
    return {
      code: 'too_large',
      message: `“${file.name}” is ${formatBytes(file.size)}, and this server accepts up to ${formatBytes(capability.maxBytes)}.`,
    };
  }
  const type = normaliseContentType(file.type);
  // An unknown/blank type is NOT refused here — see the doc comment. Only a
  // type the server has positively excluded is.
  if (capability && type && !capability.contentTypes.includes(type)) {
    return {
      code: 'unsupported_type',
      message: `“${file.name}” is ${type}, which this server does not accept. It takes ${describeContentTypes(capability.contentTypes)}.`,
    };
  }
  return null;
}

/** The `accept` attribute for a file input, from the server's own allowlist —
 *  so the picker offers exactly what the server takes rather than a list
 *  hard-coded here that drifts from it. */
export function acceptAttribute(capability: UploadCapability | null): string {
  return capability && capability.contentTypes.length > 0 ? capability.contentTypes.join(',') : 'image/*,video/*';
}

/** "JPEG, PNG, WebP and MP4" — the allowlist as prose, for a refusal message. */
export function describeContentTypes(types: readonly string[]): string {
  const names = types.map((t) => (t.split('/')[1] ?? t).replace('quicktime', 'MOV').replace('+xml', '').toUpperCase());
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? 'nothing';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/** Byte counts as a person reads them. Mirrors the server's `formatBytes`, so a
 *  limit is described the same way on both sides of the wire. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${round(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 ** 2) return `${round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${round(bytes / 1024)} kB`;
  return `${bytes} bytes`;
}

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// ---------------------------------------------------------------------------
// Reading the server's answer
// ---------------------------------------------------------------------------

export const STORAGE_NOT_CONFIGURED =
  'This Atlas server has no media storage configured, so files cannot be uploaded to it. ' +
  'An operator sets S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY on the API ' +
  '(`docker compose up minio` provides the store locally).';

export const NOT_SIGNED_IN =
  'The Atlas API refused this upload because the request carried no verified identity. ' +
  'Uploads are scoped to the person making them, so they need a Companion sign-in — which this ' +
  'viewer does not yet perform (see src/auth/portal.ts). Against a development API running with ' +
  'authentication disabled, uploads work without one.';

/**
 * Turn an HTTP status and whatever body came with it into one honest failure.
 *
 * The server's own `message` wins whenever there is one, because the server
 * knows things this side cannot: which environment variables are unset, what
 * the configured cap actually is. Re-deriving a message here would be a second
 * source of truth that starts wrong the first time the server's limits change.
 *
 * `body` is taken as text rather than parsed JSON on purpose — a proxy or a
 * gateway in front of the API answers with HTML, and `JSON.parse` throwing must
 * not turn a 502 into a mystery.
 */
export function describeFailure(status: number, body: string): UploadFailure {
  const parsed = safeJson(body);
  const serverMessage = typeof parsed?.message === 'string' && parsed.message.trim() ? parsed.message.trim() : null;
  const error = typeof parsed?.error === 'string' ? parsed.error : '';

  switch (status) {
    case 401:
      return { code: 'unauthenticated', message: NOT_SIGNED_IN, status };
    case 403:
      return {
        code: 'forbidden',
        message: serverMessage ?? 'The Atlas API refused this upload for this account.',
        status,
      };
    case 413:
      return { code: 'too_large', message: serverMessage ?? 'That file is larger than this server accepts.', status };
    case 415:
      return {
        code: 'unsupported_type',
        message: serverMessage ?? 'This server does not accept that kind of file.',
        status,
      };
    case 400:
      return { code: 'empty', message: serverMessage ?? 'The server received no file.', status };
    case 503:
      return { code: 'not_configured', message: serverMessage ?? STORAGE_NOT_CONFIGURED, status };
    case 502:
      return {
        code: 'storage_unavailable',
        message:
          serverMessage ??
          'The Atlas server could not reach its media storage. Nothing was stored — try again, and tell an operator if it keeps happening.',
        status,
      };
    default:
      break;
  }
  // Unrecognised: say the status and pass the server's own words through rather
  // than inventing a cause. A wrong confident explanation costs more than an
  // honest vague one.
  return {
    code: 'unexpected',
    message: serverMessage ?? `The Atlas API answered ${status}${error ? ` (${error})` : ''} and the upload did not complete.`,
    status,
  };
}

function safeJson(body: string): { error?: unknown; message?: unknown } | null {
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === 'object' ? (value as { error?: unknown; message?: unknown }) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type UploadState =
  | { phase: 'idle' }
  /** Asking the server what it accepts, before anything is picked. */
  | { phase: 'checking' }
  | { phase: 'uploading'; fileName: string; loaded: number; total: number; percent: number }
  | { phase: 'done'; media: UploadedMedia; fileName: string }
  | { phase: 'failed'; failure: UploadFailure; fileName?: string };

export type UploadAction =
  | { type: 'check' }
  | { type: 'start'; fileName: string; total: number }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'done'; media: UploadedMedia }
  | { type: 'fail'; failure: UploadFailure }
  | { type: 'reset' };

export const initialUploadState: UploadState = { phase: 'idle' };

/**
 * The panel's state machine, as a reducer so the awkward parts are testable
 * without rendering anything.
 *
 * Two of those parts have bitten progress bars before:
 *
 *   • A `progress` event that arrives *after* the request finished — XHR fires
 *     one final `progress` after `load` in some browsers — must not drag a
 *     completed upload back to 99%. Progress is therefore ignored in every
 *     phase except `uploading`.
 *   • `total` is 0 whenever the length is not computable, and `loaded / 0` is
 *     `NaN`, which renders as a bar of width "NaN%" — i.e. an invisible bar
 *     that looks like a stalled upload. `percent` is clamped and defined for
 *     every input.
 */
export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case 'check':
      return { phase: 'checking' };
    case 'start':
      return { phase: 'uploading', fileName: action.fileName, loaded: 0, total: action.total, percent: 0 };
    case 'progress':
      if (state.phase !== 'uploading') return state;
      return {
        ...state,
        loaded: action.loaded,
        total: action.total || state.total,
        percent: percentOf(action.loaded, action.total || state.total),
      };
    case 'done':
      return { phase: 'done', media: action.media, fileName: state.phase === 'uploading' ? state.fileName : '' };
    case 'fail':
      return { phase: 'failed', failure: action.failure, ...(state.phase === 'uploading' ? { fileName: state.fileName } : {}) };
    case 'reset':
      return initialUploadState;
    default:
      return state;
  }
}

/** 0–100, defined for every input a transfer can produce — including the
 *  unknown-length case, where the honest answer is 0 rather than NaN. */
export function percentOf(loaded: number, total: number): number {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
}

/** True while a transfer is in flight — for disabling the picker and enabling a
 *  cancel control. */
export const isUploadBusy = (state: UploadState): boolean =>
  state.phase === 'checking' || state.phase === 'uploading';
