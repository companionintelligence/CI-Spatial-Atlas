// Registers public/sw.js, the service worker that makes Companion Atlas installable and
// gives a page load with no network the /offline/ page. What the worker does and does
// not do is written at the top of that file.
//
// It is registered from here, in the bundle, rather than from a script in index.html,
// so the page needs no inline script (and keeps working under a CSP that forbids one).

/** Where the worker is served from: the site root, so its scope is the whole origin. */
export const SERVICE_WORKER_URL = '/sw.js';

/** The slice of `window` this reads, so a test can hand it a stand-in. */
export interface PwaWindow {
  navigator: { serviceWorker?: { register(url: string, options?: { scope?: string }): Promise<unknown> } };
  document: { readyState: string };
  addEventListener(type: 'load', listener: () => void, options?: { once?: boolean }): void;
  /** `self` and `top` are the same window unless this page is inside a frame. */
  self: unknown;
  top: unknown;
  /** Injected by the Capacitor runtime in the native shells (viewer-react/mobile). */
  Capacitor?: { isNativePlatform?: () => boolean };
}

export interface RegisterOptions {
  /** Defaults to Vite's `import.meta.env.PROD`. */
  production?: boolean;
  /** Defaults to the real `window`. */
  win?: PwaWindow;
}

const isProductionBuild = (): boolean => (import.meta as unknown as { env: { PROD?: boolean } }).env.PROD === true;

/**
 * Register the service worker once the page has loaded, so it never competes with the
 * globe's first render. Returns whether a registration was started.
 *
 * It does nothing:
 *   - outside a production build: the dev server would otherwise be served from a
 *     worker's idea of the page;
 *   - without `navigator.serviceWorker`, which browsers expose only on https or
 *     localhost, so a plain-http LAN address quietly stays an ordinary web page;
 *   - inside the iOS and Android shells (viewer-react/mobile). They load this same bundle
 *     from the app itself, and a worker there would sit between the WebView and its
 *     bundled files for no gain;
 *   - when the viewer is embedded in another page (src/embed): a frame on someone else's
 *     site is not somewhere to install an app from.
 */
export function registerServiceWorker({
  production = isProductionBuild(),
  win = window as unknown as PwaWindow,
}: RegisterOptions = {}): boolean {
  if (!production) return false;

  const container = win.navigator.serviceWorker;
  if (!container) return false;
  if (win.Capacitor?.isNativePlatform?.()) return false;
  if (win.self !== win.top) return false;

  const register = () => {
    container.register(SERVICE_WORKER_URL, { scope: '/' }).catch((err: unknown) => {
      // Not worth interrupting the viewer for: it is an ordinary web page without it.
      console.warn('Companion Atlas: could not register the service worker', err);
    });
  };

  if (win.document.readyState === 'complete') register();
  else win.addEventListener('load', register, { once: true });
  return true;
}
