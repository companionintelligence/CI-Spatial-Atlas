import { useEffect, useState } from 'react';
import { isIOSWebView, withARView, type PlatformFacts } from './rendererChoice.js';
import { probeXRSupport, type XRLike } from './rendererForDevice.js';

/** The platform facts, read off the live page. */
function platformFacts(): PlatformFacts {
  const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  let capacitorPlatform: string | undefined;
  try {
    capacitorPlatform = capacitor?.getPlatform?.();
  } catch {
    // The native bridge can refuse to answer. The user agent still decides.
    capacitorPlatform = undefined;
  }
  return { userAgent: navigator.userAgent, capacitorPlatform };
}

/**
 * The "View in AR" action for the flat viewer's top bar, or undefined when it
 * should not be offered.
 *
 * Offered only when the device can start an immersive-ar session and the page is
 * not in an iOS WebView. Activating it reloads with `?view=ar`, because the
 * renderer is chosen before mount (see main.tsx). The switch is never made in
 * place.
 */
export function useViewInAR(enabled: boolean): (() => void) | undefined {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!enabled || isIOSWebView(platformFacts())) return undefined;
    let live = true;
    void probeXRSupport((navigator as Navigator & { xr?: XRLike }).xr).then(({ immersiveAR }) => {
      if (live) setAvailable(immersiveAR);
    });
    return () => {
      live = false;
    };
  }, [enabled]);

  if (!enabled || !available) return undefined;
  return () => window.location.assign(withARView(window.location.href));
}
