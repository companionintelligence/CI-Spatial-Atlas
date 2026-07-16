import { useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { Viewer, CzmlDataSource, Cesium3DTileset, type CesiumComponentRef } from 'resium';
import { storyToCzml, type Story } from '@companion-atlas/story';
import type { AtlasMemory } from '../model/atlasModel.js';

const PLACEHOLDER_TOKEN = 'your_cesium_ion_token_here';
type Located = AtlasMemory & { lat: number; lon: number };

/**
 * The globe. CesiumJS via Resium, framed inside the redesign shell (not
 * fullscreen; the shell owns the chrome, so Cesium's own widgets are off). The
 * Story → CZML drives the Cesium `Clock` (the Time Machine reads/writes it).
 *
 * On top of the CZML we lay the interactive *memory layer*: a pin per memory
 * (id `mem:<memoryId>` so a click maps back to the AtlasMemory), a glowing
 * journey arc through the time-ordered memories, and a traveler that glides
 * along it on the clock. Imagery degrades gracefully: with a valid ion token →
 * real World Imagery/Terrain; otherwise → the bundled offline Natural Earth II,
 * so the globe is never black. `baseLayer={false}` means no ion request fires
 * until we decide to below.
 */
export function CesiumStoryViewer({
  story, memories, focusedId, onViewer, onPick, onHover, onInteract,
}: {
  story: Story;
  memories: AtlasMemory[];
  focusedId: string | null;
  onViewer?: (v: Cesium.Viewer | null) => void;
  onPick?: (m: AtlasMemory) => void;
  onHover?: (id: string | null) => void;
  onInteract?: () => void;
}) {
  const { czml, tilesets } = useMemo(() => storyToCzml(story), [story]);
  // The interactive memory-pin layer is the canonical 2D representation of
  // memories, so keep only the document (clock), authored tracks (`path`), and
  // 3D models from the CZML — dropping the point/billboard packets the pins
  // replace avoids drawing every located memory twice.
  const globeCzml = useMemo(
    () => czml.filter((p) => p.id === 'document' || p.path !== undefined || p.model !== undefined),
    [czml],
  );
  const ref = useRef<CesiumComponentRef<Cesium.Viewer>>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewerReady] = useState<Cesium.Viewer | null>(null);

  // Latest callbacks / focus without re-running the mount + picking effect.
  const onViewerRef = useRef(onViewer); onViewerRef.current = onViewer;
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  const onHoverRef = useRef(onHover); onHoverRef.current = onHover;
  const onInteractRef = useRef(onInteract); onInteractRef.current = onInteract;
  const focusedIdRef = useRef(focusedId); focusedIdRef.current = focusedId;
  const memMapRef = useRef(new Map<string, AtlasMemory>());
  memMapRef.current = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);

  // ---- mount: acquire the viewer, configure imagery, install picking ----
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let cleanupImageryError: (() => void) | undefined;
    let handler: Cesium.ScreenSpaceEventHandler | undefined;
    let cleanupInteract: (() => void) | undefined;

    const configure = (v: Cesium.Viewer) => {
      onViewerRef.current?.(v);
      if ((import.meta as unknown as { env: { DEV?: boolean } }).env.DEV) {
        (window as unknown as { __atlasViewer?: Cesium.Viewer }).__atlasViewer = v;
      }
      const alive = () => !disposed && !v.isDestroyed();
      const token = Cesium.Ion.defaultAccessToken;
      const hasIon = Boolean(token) && token !== PLACEHOLDER_TOKEN;
      const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
        Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`${label} timed out`)), ms))]);

      const loadOffline = async () => {
        try {
          const offline = await Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'));
          if (!alive()) return;
          v.imageryLayers.removeAll();
          v.imageryLayers.add(new Cesium.ImageryLayer(offline));
        } catch (e) {
          if (alive()) console.error('[cesium] offline imagery failed', e);
        }
      };

      void (async () => {
        if (hasIon) {
          try {
            const world = await withTimeout(Cesium.createWorldImageryAsync(), 8000, 'ion imagery');
            if (!alive()) return;
            v.imageryLayers.removeAll();
            v.imageryLayers.add(new Cesium.ImageryLayer(world));
            let swapped = false;
            const onImageryError = () => { if (swapped || !alive()) return; swapped = true; void loadOffline(); };
            world.errorEvent.addEventListener(onImageryError);
            cleanupImageryError = () => world.errorEvent.removeEventListener(onImageryError);
          } catch {
            await loadOffline();
          }
          void withTimeout(Cesium.createWorldTerrainAsync(), 8000, 'ion terrain')
            .then((t) => { if (alive()) v.terrainProvider = t; })
            .catch(() => {});
        } else {
          await loadOffline();
        }
      })();

      // Keep the globe lit. Sun-accurate lighting plunges any memory on the night
      // side into blackness — for a scrapbook that's a memory you can't see, and
      // half of them are always night somewhere. Google Earth makes the same
      // call. The moment's time-of-day still reads in the inspector badge and the
      // Time Machine ("Dawn · sky set to 6:32 AM").
      v.scene.globe.enableLighting = false;
      v.scene.fog.enabled = true;
      if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
      // Render the globe at device resolution (crisp on HiDPI), capped for perf.
      v.useBrowserRecommendedResolution = false;
      v.resolutionScale = Math.min(2, window.devicePixelRatio || 1);

      // Picking: click/hover a memory pin → map its id back to the AtlasMemory.
      handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
      const memIdAt = (pos: Cesium.Cartesian2): string | null => {
        const picked = v.scene.pick(pos) as { id?: { id?: unknown } } | undefined;
        const id = picked?.id?.id;
        return typeof id === 'string' && id.startsWith('mem:') ? id.slice(4) : null;
      };
      handler.setInputAction((e: { position: Cesium.Cartesian2 }) => {
        const memId = memIdAt(e.position);
        const m = memId ? memMapRef.current.get(memId) : null;
        if (m) onPickRef.current?.(m);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction((e: { endPosition: Cesium.Cartesian2 }) => {
        const memId = memIdAt(e.endPosition);
        onHoverRef.current?.(memId);
        v.scene.canvas.style.cursor = memId ? 'pointer' : '';
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      // Manual globe interaction (drag/zoom) pauses the auto-tour, so a
      // clock-driven camera flight never fights the user.
      const canvas = v.scene.canvas;
      const interact = () => onInteractRef.current?.();
      // Cesium only reports MOUSE_MOVE over the canvas, so leaving it would strand
      // the hover highlight (and a 'pointer' cursor) on forever.
      const leave = () => { onHoverRef.current?.(null); canvas.style.cursor = ''; };
      canvas.addEventListener('pointerdown', interact);
      canvas.addEventListener('wheel', interact, { passive: true });
      canvas.addEventListener('pointerleave', leave);

      // Cesium only re-sizes its drawing buffer on *window* resize. The stage can
      // change size on its own (chrome/drawers, a resized preview pane, an XR
      // handoff), which would leave a stale, letterboxed canvas — so watch the
      // container directly.
      const host = hostRef.current;
      const ro = host ? new ResizeObserver(() => { if (!v.isDestroyed()) v.resize(); }) : null;
      if (host && ro) ro.observe(host);

      cleanupInteract = () => {
        canvas.removeEventListener('pointerdown', interact);
        canvas.removeEventListener('wheel', interact);
        canvas.removeEventListener('pointerleave', leave);
        ro?.disconnect();
      };

      setViewerReady(v);
    };

    // Resium assigns cesiumElement a frame after this effect first runs — poll.
    const wait = () => {
      if (disposed) return;
      const v = ref.current?.cesiumElement;
      if (v && !v.isDestroyed()) { configure(v); return; }
      raf = requestAnimationFrame(wait);
    };
    wait();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      cleanupImageryError?.();
      cleanupInteract?.();
      handler?.destroy();
      setViewerReady(null);
      onViewerRef.current?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- memory layer: pins + journey arc + traveler (rebuilt on memory change) ----
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const ds = buildMemoryLayer(memories, () => focusedIdRef.current);
    // dataSources.add resolves on a microtask; remove() is synchronous. Remove
    // in the add promise's resolution so a fast rebuild/unmount can't leave an
    // orphaned layer that was pushed after cleanup ran.
    const added = viewer.dataSources.add(ds);
    return () => {
      void added.then((d) => { if (!viewer.isDestroyed()) viewer.dataSources.remove(d ?? ds, true); });
    };
  }, [viewer, memories]);

  return (
    <div className="atlas-globe" ref={hostRef}>
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
        <CzmlDataSource data={globeCzml} />
        {tilesets.map((t) => (
          <Cesium3DTileset key={t.id} url={t.url} />
        ))}
      </Viewer>
    </div>
  );
}

/** Build the interactive memory layer as a CustomDataSource. */
function buildMemoryLayer(memories: AtlasMemory[], getFocusedId: () => string | null): Cesium.CustomDataSource {
  const ds = new Cesium.CustomDataSource('atlas-memories');
  const teal = Cesium.Color.fromCssColorString('#72ddd4');
  const mint = Cesium.Color.fromCssColorString('#58ebbf');
  const dark = Cesium.Color.fromCssColorString('#041620');
  const fg = Cesium.Color.fromCssColorString('#d7e6e6');
  const onTop = Number.POSITIVE_INFINITY;

  // Dedupe by id — a duplicate upstream id would otherwise throw in
  // EntityCollection.add and blank the whole layer.
  const seen = new Set<string>();
  const located = memories.filter((m): m is Located =>
    m.lat != null && m.lon != null && !seen.has(m.id) && (seen.add(m.id), true));

  for (const m of located) {
    ds.entities.add({
      id: `mem:${m.id}`,
      position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat),
      point: {
        pixelSize: new Cesium.CallbackProperty(() => (getFocusedId() === m.id ? 16 : 11), false),
        color: new Cesium.CallbackProperty(() => (getFocusedId() === m.id ? mint : teal), false),
        outlineColor: dark,
        outlineWidth: 2,
        disableDepthTestDistance: onTop,
      },
      label: {
        text: m.title,
        font: '600 13px Montserrat, sans-serif',
        fillColor: fg,
        showBackground: true,
        backgroundColor: dark.withAlpha(0.66),
        backgroundPadding: new Cesium.Cartesian2(7, 4),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: onTop,
        translucencyByDistance: new Cesium.NearFarScalar(2.0e6, 1.0, 1.2e7, 0.0),
      },
    });
  }

  const route = [...located].sort((a, b) => a.timeMs - b.timeMs);
  if (route.length > 1) {
    ds.entities.add({
      polyline: {
        positions: route.map((m) => Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 0)),
        width: 2.5,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: teal.withAlpha(0.85) }),
        clampToGround: true,
      },
    });
    ds.entities.add({
      id: 'atlas-traveler',
      position: new Cesium.CallbackPositionProperty((time, result) => {
        const ms = time ? Cesium.JulianDate.toDate(time).getTime() : route[0]!.timeMs;
        return travelerPos(route, ms, result);
      }, false),
      point: { pixelSize: 9, color: mint, outlineColor: dark, outlineWidth: 2, disableDepthTestDistance: onTop },
    });
  }
  return ds;
}

/** Interpolate the traveler's surface position along the route at time `ms`,
 *  reusing the provided scratch Cartesian to avoid a per-frame allocation. */
function travelerPos(route: Located[], ms: number, result?: Cesium.Cartesian3): Cesium.Cartesian3 {
  const at = (lon: number, lat: number) => Cesium.Cartesian3.fromDegrees(lon, lat, 0, undefined, result);
  const first = route[0]!;
  const last = route[route.length - 1]!;
  if (ms <= first.timeMs) return at(first.lon, first.lat);
  if (ms >= last.timeMs) return at(last.lon, last.lat);
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    if (ms >= a.timeMs && ms <= b.timeMs) {
      const f = (ms - a.timeMs) / Math.max(1, b.timeMs - a.timeMs);
      return at(a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f);
    }
  }
  return at(last.lon, last.lat);
}
