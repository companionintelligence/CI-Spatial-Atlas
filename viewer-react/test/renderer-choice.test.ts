import { describe, expect, it } from 'vitest';
import {
  chooseRenderer,
  isIOSWebView,
  parseRendererRequest,
  withARView,
  type RendererRequest,
  type XRSupport,
} from '../src/renderers/rendererChoice.js';
import {
  probeXRSupport,
  rendererForDevice,
  type XRLike,
} from '../src/renderers/rendererForDevice.js';

const NONE: XRSupport = { immersiveVR: false, immersiveAR: false };
const VR: XRSupport = { immersiveVR: true, immersiveAR: false };
const AR: XRSupport = { immersiveVR: false, immersiveAR: true };
const BOTH: XRSupport = { immersiveVR: true, immersiveAR: true };
const PLAIN: RendererRequest = { forced: null, wantsAR: false };
const ASK_AR: RendererRequest = { forced: null, wantsAR: true };

/** An `isSessionSupported` that answers from a table and records what it was asked. */
function fakeXR(supported: Record<string, boolean>): XRLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isSessionSupported: async (mode: string) => {
      calls.push(mode);
      return supported[mode] ?? false;
    },
  };
}

describe('parseRendererRequest', () => {
  it('asks for nothing when the query string is empty', () => {
    expect(parseRendererRequest('')).toEqual({ forced: null, wantsAR: false });
  });

  it('reads ?renderer= only when it names one of the two renderers, exactly', () => {
    expect(parseRendererRequest('?renderer=xr').forced).toBe('xr');
    expect(parseRendererRequest('?renderer=cesium').forced).toBe('cesium');
    expect(parseRendererRequest('?renderer=webgl').forced).toBeNull();
    expect(parseRendererRequest('?renderer=XR').forced).toBeNull();
  });

  it('reads ?view=ar in any case and ignores surrounding spaces', () => {
    expect(parseRendererRequest('?view=ar').wantsAR).toBe(true);
    expect(parseRendererRequest('?view=AR').wantsAR).toBe(true);
    expect(parseRendererRequest('?view=%20Ar%20').wantsAR).toBe(true);
  });

  it('never mistakes a camera pose, or a word that starts with "ar", for an AR request', () => {
    // `view` is also the camera pose parameter (embed/embedUrl.ts).
    expect(parseRendererRequest('?view=64.1466,-21.9426,90000,200,-35').wantsAR).toBe(false);
    expect(parseRendererRequest('?view=arctic').wantsAR).toBe(false);
    expect(parseRendererRequest('?view=').wantsAR).toBe(false);
  });

  it('reads both parameters from one query string', () => {
    expect(parseRendererRequest('?renderer=cesium&view=ar')).toEqual({ forced: 'cesium', wantsAR: true });
  });

  it('accepts a URLSearchParams as well as a string', () => {
    expect(parseRendererRequest(new URLSearchParams('view=ar'))).toEqual({ forced: null, wantsAR: true });
  });
});

describe('chooseRenderer', () => {
  it('keeps the flat globe for a visitor who asks for nothing and has no headset', () => {
    expect(chooseRenderer(PLAIN, NONE)).toBe('cesium');
  });

  it('keeps the headset globe wherever immersive-vr is supported, as it always has', () => {
    expect(chooseRenderer(PLAIN, VR)).toBe('xr');
    // AR support alone does not move a visitor who did not ask for AR.
    expect(chooseRenderer(PLAIN, BOTH)).toBe('xr');
  });

  it('keeps a phone with AR but no VR on the flat globe unless it asks for AR', () => {
    expect(chooseRenderer(PLAIN, AR)).toBe('cesium');
  });

  it('enters AR when it is asked for and immersive-ar is supported', () => {
    expect(chooseRenderer(ASK_AR, AR)).toBe('xr-ar');
    expect(chooseRenderer(ASK_AR, BOTH)).toBe('xr-ar');
  });

  it('falls back to the existing choice when AR is asked for but not supported', () => {
    expect(chooseRenderer(ASK_AR, VR)).toBe('xr');
    expect(chooseRenderer(ASK_AR, NONE)).toBe('cesium');
  });

  it('honours an explicit renderer exactly as before', () => {
    expect(chooseRenderer({ forced: 'cesium', wantsAR: false }, BOTH)).toBe('cesium');
    expect(chooseRenderer({ forced: 'xr', wantsAR: false }, NONE)).toBe('xr');
    expect(chooseRenderer({ forced: 'xr', wantsAR: true }, VR)).toBe('xr');
  });

  it('lets an AR request override a forced flat globe, so the AR control still works', () => {
    expect(chooseRenderer({ forced: 'cesium', wantsAR: true }, AR)).toBe('xr-ar');
  });
});

describe('withARView', () => {
  it('adds ?view=ar to a bare address', () => {
    expect(withARView('https://atlas.example/')).toBe('https://atlas.example/?view=ar');
  });

  it('replaces a camera pose rather than adding a second view parameter', () => {
    const url = new URL(withARView('https://atlas.example/?view=64.1,-21.9,90000,200,-35&t=1700000000000'));
    expect(url.searchParams.getAll('view')).toEqual(['ar']);
    expect(url.searchParams.get('t')).toBe('1700000000000');
  });

  it('keeps the rest of the address, so the same story loads in AR', () => {
    const url = new URL(
      withARView('https://atlas.example/app/?story=https%3A%2F%2Fexample.org%2Fjourney.story.json#top'),
    );
    expect(url.pathname).toBe('/app/');
    expect(url.searchParams.get('story')).toBe('https://example.org/journey.story.json');
    expect(url.searchParams.get('view')).toBe('ar');
    expect(url.hash).toBe('#top');
  });
});

describe('isIOSWebView', () => {
  const WKWEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const MOBILE_SAFARI = `${WKWEBVIEW} Version/18.0 Safari/604.1`;
  const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const DESKTOP_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

  it('recognises the Capacitor iOS shell', () => {
    expect(isIOSWebView({ userAgent: MOBILE_SAFARI, capacitorPlatform: 'ios' })).toBe(true);
  });

  it('recognises a WKWebView by the Safari token it does not send', () => {
    expect(isIOSWebView({ userAgent: WKWEBVIEW })).toBe(true);
  });

  it('does not treat Mobile Safari itself as a WebView', () => {
    expect(isIOSWebView({ userAgent: MOBILE_SAFARI })).toBe(false);
  });

  it('is false on Android and on desktop', () => {
    expect(isIOSWebView({ userAgent: ANDROID_CHROME })).toBe(false);
    expect(isIOSWebView({ userAgent: ANDROID_CHROME, capacitorPlatform: 'android' })).toBe(false);
    expect(isIOSWebView({ userAgent: DESKTOP_CHROME })).toBe(false);
  });
});

describe('probeXRSupport', () => {
  it('reports each immersive mode separately', async () => {
    await expect(probeXRSupport(fakeXR({ 'immersive-ar': true }))).resolves.toEqual({
      immersiveVR: false,
      immersiveAR: true,
    });
  });

  it('reports nothing supported when there is no navigator.xr', async () => {
    await expect(probeXRSupport(null)).resolves.toEqual(NONE);
    await expect(probeXRSupport(undefined)).resolves.toEqual(NONE);
  });

  it('treats a probe that rejects or throws as unsupported', async () => {
    const rejects: XRLike = { isSessionSupported: () => Promise.reject(new Error('no')) };
    const throws: XRLike = {
      isSessionSupported: () => {
        throw new Error('no');
      },
    };
    await expect(probeXRSupport(rejects)).resolves.toEqual(NONE);
    await expect(probeXRSupport(throws)).resolves.toEqual(NONE);
  });
});

describe('rendererForDevice', () => {
  it('asks the device nothing when a forced renderer already settles the question', async () => {
    const xr = fakeXR({ 'immersive-vr': true, 'immersive-ar': true });
    await expect(rendererForDevice('?renderer=cesium', xr)).resolves.toBe('cesium');
    await expect(rendererForDevice('?renderer=xr', xr)).resolves.toBe('xr');
    expect(xr.calls).toEqual([]);
  });

  it('picks the headset globe on an immersive-vr device, as before', async () => {
    await expect(rendererForDevice('', fakeXR({ 'immersive-vr': true }))).resolves.toBe('xr');
  });

  it('keeps a phone with only AR support on the flat globe', async () => {
    await expect(rendererForDevice('', fakeXR({ 'immersive-ar': true }))).resolves.toBe('cesium');
  });

  it('enters AR when the URL asks and the device supports it', async () => {
    await expect(rendererForDevice('?view=ar', fakeXR({ 'immersive-ar': true }))).resolves.toBe('xr-ar');
  });

  it('treats a page with no WebXR at all as the flat globe, even when AR is asked for', async () => {
    await expect(rendererForDevice('?view=ar', null)).resolves.toBe('cesium');
    await expect(rendererForDevice('', null)).resolves.toBe('cesium');
  });

  it('treats a throwing probe as unsupported and falls back to the flat globe', async () => {
    const broken: XRLike = { isSessionSupported: () => Promise.reject(new Error('no')) };
    await expect(rendererForDevice('', broken)).resolves.toBe('cesium');
    await expect(rendererForDevice('?view=ar', broken)).resolves.toBe('cesium');
  });
});
