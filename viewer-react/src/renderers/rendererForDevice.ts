import {
  chooseRenderer,
  parseRendererRequest,
  type RendererChoice,
  type XRSupport,
} from './rendererChoice.js';

/** The part of `navigator.xr` this file uses. */
export interface XRLike {
  isSessionSupported(mode: string): Promise<boolean>;
}

const NO_XR: XRSupport = { immersiveVR: false, immersiveAR: false };

async function supports(xr: XRLike, mode: string): Promise<boolean> {
  try {
    return Boolean(await xr.isSessionSupported(mode));
  } catch {
    // A probe that throws counts as unsupported, which is what the VR check
    // has always done.
    return false;
  }
}

/** Ask the device which immersive sessions it can start. */
export async function probeXRSupport(xr: XRLike | null | undefined): Promise<XRSupport> {
  if (!xr) return NO_XR;
  const [immersiveVR, immersiveAR] = await Promise.all([
    supports(xr, 'immersive-vr'),
    supports(xr, 'immersive-ar'),
  ]);
  return { immersiveVR, immersiveAR };
}

/**
 * Pick the renderer for this visit.
 *
 * The device is asked only when the answer can depend on it. A forced
 * `?renderer=` with no AR request is settled by the URL alone, as it always was.
 *
 * `search` and `xr` are parameters so the decision can be tested. `main.tsx`
 * passes neither and gets the page's own query string and `navigator.xr`.
 */
export async function rendererForDevice(
  search: string = window.location.search,
  xr: XRLike | null | undefined = (navigator as Navigator & { xr?: XRLike }).xr,
): Promise<RendererChoice> {
  const request = parseRendererRequest(search);
  const needsDevice = request.wantsAR || request.forced === null;
  const support = needsDevice ? await probeXRSupport(xr) : NO_XR;
  return chooseRenderer(request, support);
}
