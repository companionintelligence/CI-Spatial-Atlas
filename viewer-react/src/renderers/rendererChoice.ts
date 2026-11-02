/**
 * Which renderer mounts for this visit, decided from the URL and from what the
 * device can do.
 *
 * Pure on purpose. `main.tsx` asks once, before React mounts, and the answer
 * decides which app root is imported at all. Nothing here touches `window` or
 * `navigator`: callers read those and pass the results in, so every branch can
 * be tested without a headset.
 *
 *  - `cesium`: the flat Resium globe. Desktop, phones, iOS, and anything that
 *    did not ask for AR and cannot do VR.
 *  - `xr`: the R3F WebXR globe, entered in immersive-vr. Chosen exactly as it
 *    always was, and only when the page did not ask for AR.
 *  - `xr-ar`: the same R3F root, offering an immersive-ar session. Chosen only
 *    when the URL asks for it (`?view=ar`) and the device supports immersive-ar.
 *    A phone with ARCore has no VR session, so without the request it stays on
 *    the flat globe.
 */
export type RendererChoice = 'cesium' | 'xr' | 'xr-ar';

/** The value of `?view=` that asks for AR. */
export const AR_VIEW = 'ar';

/** What the URL asks for. */
export interface RendererRequest {
  /** `?renderer=cesium|xr`, an explicit override. Null when absent or not one of those. */
  forced: 'cesium' | 'xr' | null;
  /** `?view=ar`: the visitor asked for an AR entry. */
  wantsAR: boolean;
}

/** What the device can start. Read from `navigator.xr` by the caller. */
export interface XRSupport {
  immersiveVR: boolean;
  immersiveAR: boolean;
}

/**
 * Read the renderer request off a query string.
 *
 * `view` is also the camera-pose parameter (`view=lat,lon,height,heading,pitch`,
 * see embed/embedUrl.ts). Only the exact word asks for AR, so a shared pose can
 * never be mistaken for one.
 */
export function parseRendererRequest(search: string | URLSearchParams): RendererRequest {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const renderer = params.get('renderer');
  return {
    forced: renderer === 'cesium' || renderer === 'xr' ? renderer : null,
    wantsAR: (params.get('view') ?? '').trim().toLowerCase() === AR_VIEW,
  };
}

/**
 * The decision.
 *
 * An AR request wins, including over `?renderer=cesium`. It is the more specific
 * ask, and without this the "View in AR" control would reload into the same flat
 * globe on any URL that had been forced flat.
 *
 * Everything else is what `rendererForDevice` always did: an explicit
 * `?renderer=` is honoured, and otherwise immersive-vr decides between the
 * headset globe and the flat one.
 */
export function chooseRenderer(request: RendererRequest, support: XRSupport): RendererChoice {
  if (request.wantsAR && support.immersiveAR) return 'xr-ar';
  if (request.forced) return request.forced;
  return support.immersiveVR ? 'xr' : 'cesium';
}

/** The page's own address, asking for AR. The reload target of "View in AR". */
export function withARView(href: string): string {
  const url = new URL(href);
  url.searchParams.set('view', AR_VIEW);
  return url.toString();
}

/** The platform facts `isIOSWebView` reads. */
export interface PlatformFacts {
  userAgent: string;
  /** `window.Capacitor.getPlatform()` inside a Capacitor shell, otherwise undefined. */
  capacitorPlatform?: string;
}

/**
 * Is this page running in an iOS WebView (WKWebView)?
 *
 * WKWebView does not expose WebXR, so the AR control is never offered there,
 * whatever the device reports. The Capacitor shell says so directly. Otherwise
 * the user agent decides: an iPhone, iPad or iPod that does not send the
 * `Safari/` token. Mobile Safari sends it and WKWebView does not.
 *
 * iPadOS in desktop mode reports itself as a Mac and is not caught here. It has
 * no WebXR either, so the control stays hidden there anyway.
 */
export function isIOSWebView(platform: PlatformFacts): boolean {
  if (platform.capacitorPlatform === 'ios') return true;
  const ua = platform.userAgent;
  return /\b(iPhone|iPad|iPod)\b/.test(ua) && !/\bSafari\//.test(ua);
}
