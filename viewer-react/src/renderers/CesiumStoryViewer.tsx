import { useEffect, useMemo, useRef } from 'react';
import * as Cesium from 'cesium';
import { Viewer, CzmlDataSource, Cesium3DTileset, type CesiumComponentRef } from 'resium';
import { storyToCzml, type Story } from '@companion-atlas/story';

const PLACEHOLDER_TOKEN = 'your_cesium_ion_token_here';

/**
 * The globe. CesiumJS via Resium, framed inside the redesign shell (not
 * fullscreen; the shell owns the chrome, so Cesium's own widgets are off). The
 * Story → CZML drives the Cesium `Clock` (the Time Machine reads/writes it).
 *
 * Imagery degrades gracefully: with a valid ion token → real World Imagery /
 * Terrain; otherwise (or if ion is unreachable) → the bundled offline Natural
 * Earth II basemap, so the globe is never black. `baseLayer={false}` means the
 * Viewer issues no ion request at all until we decide to below.
 */
export function CesiumStoryViewer({ story, onViewer }: { story: Story; onViewer?: (v: Cesium.Viewer | null) => void }) {
  const { czml, tilesets } = useMemo(() => storyToCzml(story), [story]);
  const ref = useRef<CesiumComponentRef<Cesium.Viewer>>(null);
  // Track the latest onViewer without making it an effect dependency, so the
  // one-time viewer setup runs exactly once per mount regardless of the
  // callback's identity (an inline lambda would otherwise thrash the effect).
  const onViewerRef = useRef(onViewer);
  onViewerRef.current = onViewer;

  useEffect(() => {
    // Resium assigns `ref.current.cesiumElement` a beat after this passive
    // effect first runs, so poll a few frames until the viewer exists rather
    // than reading it once (reading once leaves the globe un-configured/black).
    let disposed = false;
    let raf = 0;
    let cleanupImageryError: (() => void) | undefined;

    const configure = (viewer: Cesium.Viewer) => {
      const publish = onViewerRef.current;
      publish?.(viewer);

      const alive = () => !disposed && !viewer.isDestroyed();
      const token = Cesium.Ion.defaultAccessToken;
      const hasIon = Boolean(token) && token !== PLACEHOLDER_TOKEN;

      const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
        Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`${label} timed out`)), ms))]);

      const loadOffline = async () => {
        try {
          const offline = await Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'));
          if (!alive()) return;
          viewer.imageryLayers.removeAll();
          viewer.imageryLayers.add(new Cesium.ImageryLayer(offline));
        } catch (e) {
          if (alive()) console.error('[cesium] offline imagery failed', e);
        }
      };

      void (async () => {
        if (hasIon) {
          try {
            const world = await withTimeout(Cesium.createWorldImageryAsync(), 8000, 'ion imagery');
            if (!alive()) return;
            viewer.imageryLayers.removeAll();
            viewer.imageryLayers.add(new Cesium.ImageryLayer(world));
            let swapped = false;
            const onImageryError = () => {
              if (swapped || !alive()) return;
              swapped = true;
              void loadOffline();
            };
            world.errorEvent.addEventListener(onImageryError);
            cleanupImageryError = () => world.errorEvent.removeEventListener(onImageryError);
          } catch {
            await loadOffline();
          }
          void withTimeout(Cesium.createWorldTerrainAsync(), 8000, 'ion terrain')
            .then((t) => { if (alive()) viewer.terrainProvider = t; })
            .catch(() => {});
        } else {
          await loadOffline();
        }
      })();

      viewer.scene.globe.enableLighting = true;
      viewer.scene.fog.enabled = true;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    };

    const waitForViewer = () => {
      if (disposed) return;
      const viewer = ref.current?.cesiumElement;
      if (viewer && !viewer.isDestroyed()) { configure(viewer); return; }
      raf = requestAnimationFrame(waitForViewer);
    };
    waitForViewer();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      cleanupImageryError?.();
      onViewerRef.current?.(null);
    };
  }, []);

  return (
    <div className="atlas-globe">
      <Viewer
        ref={ref}
        full={false}
        baseLayer={false}
        timeline={false}
        animation={false}
        baseLayerPicker={false}
        geocoder={false}
        homeButton={false}
        navigationHelpButton={false}
        sceneModePicker={false}
        fullscreenButton={false}
        infoBox={false}
        selectionIndicator={false}
        shouldAnimate
      >
        <CzmlDataSource data={czml} />
        {tilesets.map((t) => (
          <Cesium3DTileset key={t.id} url={t.url} />
        ))}
      </Viewer>
    </div>
  );
}
