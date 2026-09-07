/**
 * The upload, as a hook — the whole surface a panel needs, and nothing it has
 * to reason about.
 *
 * Everything decidable is in `mediaUpload.ts` (rules, messages, the reducer)
 * and `uploadClient.ts` (the two calls). What is left here is the part that
 * genuinely needs React: one capability fetch on mount, an in-flight abort
 * controller, and not calling `setState` after unmount.
 *
 * A panel needs four things from this and gets exactly four:
 *
 *   available  false when there is no API configured or the server has no
 *              storage — the control renders disabled, with `reason` beside it,
 *              instead of offering an upload that cannot happen. This is the
 *              whole point of asking the server before a file is picked.
 *   accept     the file input's `accept`, built from the server's own allowlist.
 *   upload()   send one file; resolves with the outcome and drives `state`.
 *   state      idle / checking / uploading (with a percentage) / done / failed.
 *
 * A refusal decided in the browser (`validateFile`) lands in exactly the same
 * `failed` state as one decided by the server, so a panel renders one message
 * in one place and cannot accidentally show only half of them.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  acceptAttribute,
  initialUploadState,
  isUploadBusy,
  uploadReducer,
  validateFile,
  type UploadCapability,
  type UploadState,
  type UploadableFile,
} from './mediaUpload.js';
import {
  fetchUploadCapability,
  uploadMedia,
  NO_API_CONFIGURED,
  type AtlasApiConfig,
  type UploadOptions,
  type UploadOutcome,
} from './uploadClient.js';

export interface MediaUploadHandle {
  state: UploadState;
  capability: UploadCapability | null;
  /** Uploads can actually happen right now. */
  available: boolean;
  /** Why not, when `available` is false. Always a sentence, never a code. */
  reason: string | null;
  /** `accept` for a file input, from the server's allowlist. */
  accept: string;
  busy: boolean;
  upload: (file: UploadableFile) => Promise<UploadOutcome>;
  cancel: () => void;
  reset: () => void;
}

export function useMediaUpload(
  cfg: AtlasApiConfig | null,
  opts: Pick<UploadOptions, 'transport' | 'fetchImpl'> = {},
): MediaUploadHandle {
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [capability, setCapability] = useState<UploadCapability | null>(null);
  const abort = useRef<AbortController | null>(null);
  const live = useRef(true);
  const { transport, fetchImpl } = opts;

  // A panel will write `useMediaUpload(atlasApiFromEnv(import.meta.env))` and
  // hand it a fresh object every render. Everything below therefore keys on the
  // two *values* that config carries and reads the object itself through a ref,
  // so a new-but-identical config neither re-asks the server what it accepts
  // nor changes the identity of the returned handle — which a caller will put
  // in a dependency array sooner or later.
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const baseUrl = cfg?.baseUrl;
  const token = cfg?.token;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // An unmounted panel's upload is nobody's upload. Aborting on unmount is
      // also what stops a completed request resolving into a setState on a
      // component that is gone.
      abort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!baseUrl) {
      setCapability(null);
      return;
    }
    let cancelled = false;
    dispatch({ type: 'check' });
    void fetchUploadCapability({ baseUrl, token }, { fetchImpl }).then((cap) => {
      if (cancelled || !live.current) return;
      setCapability(cap);
      dispatch({ type: 'reset' });
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, fetchImpl]);

  const upload = useCallback(
    async (file: UploadableFile): Promise<UploadOutcome> => {
      const active = cfgRef.current;
      if (!active) {
        const failure = { code: 'not_configured' as const, message: NO_API_CONFIGURED };
        dispatch({ type: 'fail', failure });
        return { ok: false, failure };
      }
      // The browser's checks are a courtesy that saves a doomed transfer; the
      // server re-checks everything regardless. Both refusals land in the same
      // state so a panel has one place to render them.
      const refusal = validateFile(file, capability);
      if (refusal) {
        dispatch({ type: 'fail', failure: refusal });
        return { ok: false, failure: refusal };
      }

      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      dispatch({ type: 'start', fileName: file.name, total: file.size });

      const outcome = await uploadMedia(file, active, {
        transport,
        signal: controller.signal,
        onProgress: (loaded, total) => {
          if (live.current) dispatch({ type: 'progress', loaded, total });
        },
      });
      if (live.current) {
        if (outcome.ok) dispatch({ type: 'done', media: outcome.media });
        else dispatch({ type: 'fail', failure: outcome.failure });
      }
      return outcome;
    },
    [baseUrl, token, capability, transport],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  const reason = !baseUrl ? NO_API_CONFIGURED : capability && !capability.configured ? (capability.reason ?? null) : null;

  return useMemo(
    () => ({
      state,
      capability,
      available: Boolean(baseUrl) && capability?.configured === true,
      reason,
      accept: acceptAttribute(capability),
      busy: isUploadBusy(state),
      upload,
      cancel,
      reset,
    }),
    [state, capability, baseUrl, reason, upload, cancel, reset],
  );
}
