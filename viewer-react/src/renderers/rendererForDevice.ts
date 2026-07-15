export type RendererKind = 'cesium' | 'xr';

/**
 * Pick the renderer. `?renderer=cesium|xr` forces it; otherwise we use the R3F
 * WebXR globe when the device supports an immersive-vr session (Cesium has no
 * WebXR), and the Resium/Cesium globe everywhere else.
 */
export async function rendererForDevice(): Promise<RendererKind> {
  const forced = new URLSearchParams(window.location.search).get('renderer');
  if (forced === 'cesium' || forced === 'xr') return forced;

  const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
  if (xr) {
    try {
      if (await xr.isSessionSupported('immersive-vr')) return 'xr';
    } catch {
      /* fall through to cesium */
    }
  }
  return 'cesium';
}
