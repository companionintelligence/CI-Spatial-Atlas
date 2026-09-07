/**
 * Uploading media from the local machine.
 *
 * The public surface of this directory — one import for the scene editor and
 * one for the import panel, so neither reaches into the internals and neither
 * grows its own copy of a rule.
 *
 * Wired into `interop/MediaUploadSection.tsx`, which the Import & export panel
 * mounts. Two deployment facts still gate whether an upload can *succeed*, and
 * the section reports each in place rather than hiding the control:
 *
 *   1. `VITE_ATLAS_API` ships empty in `.env.default`, so `atlasApiFromEnv`
 *      returns null in every configuration checked into this repo and the
 *      control renders disabled with `NO_API_CONFIGURED`.
 *   2. The viewer performs no sign-in (`src/auth/portal.ts` is deliberately
 *      unwired), so against an API with authentication enabled every upload is
 *      a 401 — reported honestly as such, but a 401 nonetheless. Against a
 *      development API (no `COMPANION_OIDC_ISSUER`) uploads work today.
 *
 * See `docs/` and the module headers for the reasoning behind each piece.
 */

export {
  acceptAttribute,
  describeContentTypes,
  describeFailure,
  formatBytes,
  initialUploadState,
  isUploadBusy,
  normaliseContentType,
  percentOf,
  uploadReducer,
  validateFile,
  NOT_SIGNED_IN,
  STORAGE_NOT_CONFIGURED,
  type UploadAction,
  type UploadCapability,
  type UploadFailure,
  type UploadFailureCode,
  type UploadState,
  type UploadableFile,
  type UploadedMedia,
} from './mediaUpload.js';

export {
  atlasApiFromEnv,
  fetchUploadCapability,
  mediaItemFromUpload,
  uploadMedia,
  xhrTransport,
  UploadAborted,
  NO_API_CONFIGURED,
  type AtlasApiConfig,
  type TransportRequest,
  type TransportResponse,
  type UploadOptions,
  type UploadOutcome,
  type UploadTransport,
} from './uploadClient.js';

export { useMediaUpload, type MediaUploadHandle } from './useMediaUpload.js';
