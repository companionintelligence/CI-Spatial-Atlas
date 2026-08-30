import { useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { Viewer, CzmlDataSource, Cesium3DTileset, type CesiumComponentRef } from 'resium';
import { storyToCzml, type Story, type Place } from '@companion-atlas/story';
import type { AtlasMemory } from '../model/atlasModel.js';
import { BASEMAPS, DEFAULT_BASEMAP, offlineImagery } from './basemaps.js';

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
 *
 * A second, optional layer renders named CI-Server Places (`place:<placeId>`
 * ids) — the room-to-planet geographic entities memories happen *in*, distinct
 * from the memory pins above. It's off by default (pass `places={[]}`, the
 * default) so it never competes with the memory layer for attention.
 */
export function CesiumStoryViewer({
  story, memories, places = [], focusedId, basemap = DEFAULT_BASEMAP, sunLighting = false,
  buildings = false,
  onViewer, onPick, onPickPlace, onHover, onInteract,
}: {
  story: Story;
  memories: AtlasMemory[];
  places?: Place[];
  focusedId: string | null;
  /** Keyless basemap id from BASEMAPS. */
  basemap?: string;
  /** Cast the real sun terminator across the globe. */
  sunLighting?: boolean;
  /** Google Photorealistic 3D Tiles — real buildings and terrain geometry. */
  buildings?: boolean;
  onViewer?: (v: Cesium.Viewer | null) => void;
  onPick?: (m: AtlasMemory) => void;
  onPickPlace?: (p: Place) => void;
  onHover?: (id: string | null) => void;
  onInteract?: () => void;
}) {
  // Read inside the mount effect without making it a dependency (remounting
  // the viewer to change basemap would tear down the whole scene).
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

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
  const onPickPlaceRef = useRef(onPickPlace); onPickPlaceRef.current = onPickPlace;
  const onHoverRef = useRef(onHover); onHoverRef.current = onHover;
  const onInteractRef = useRef(onInteract); onInteractRef.current = onInteract;
  const focusedIdRef = useRef(focusedId); focusedIdRef.current = focusedId;
  const memMapRef = useRef(new Map<string, AtlasMemory>());
  memMapRef.current = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);
  const placeMapRef = useRef(new Map<string, Place>());
  placeMapRef.current = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

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

      // `replace` is for the ion failure path, which owns the whole stack.
      // The keyless path must NOT clear: the basemap effect can attach its Esri
      // overlay before this async load resolves, and a removeAll() here would
      // silently delete it — the globe then sits on two-level Natural Earth and
      // goes black as soon as the camera drops below orbit. Insert underneath
      // instead, so the base and the overlay coexist whatever order they land in.
      const loadOffline = async ({ replace = false }: { replace?: boolean } = {}) => {
        try {
          const offline = await offlineImagery();
          if (!alive()) return;
          if (replace) v.imageryLayers.removeAll();
          v.imageryLayers.add(new Cesium.ImageryLayer(offline), 0);
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
            const onImageryError = () => { if (swapped || !alive()) return; swapped = true; void loadOffline({ replace: true }); };
            world.errorEvent.addEventListener(onImageryError);
            cleanupImageryError = () => world.errorEvent.removeEventListener(onImageryError);
          } catch {
            await loadOffline({ replace: true });
          }
          void withTimeout(Cesium.createWorldTerrainAsync(), 8000, 'ion terrain')
            .then((t) => { if (alive()) v.terrainProvider = t; })
            .catch(() => {});
        } else {
          // No ion token. Two layers, deliberately:
          //
          //  base    Cesium's bundled NaturalEarthII raster. Local, always
          //          resolves, so the globe has ground the instant it mounts.
          //  overlay the keyless Esri basemap CI-Server's own map uses, which
          //          carries the real detail once its tiles arrive.
          //
          // The overlay alone is not enough: until its first tiles land — and
          // on any network that cannot reach ArcGIS at all — a single online
          // layer leaves the globe drawing nothing but starfield, which reads
          // as a broken app rather than a loading one. Keeping the offline
          // raster underneath makes the online basemap a progressive
          // enhancement instead of a hard dependency.
          // Offline Natural Earth is the layer the globe mounts with: it is
          // local, so it always resolves and there is never a black globe. The
          // richer keyless Esri basemaps are layered on top by the basemap
          // effect below, once the viewer is fully constructed — attaching a
          // remote layer during mount makes every root tile wait on it, and a
          // slow or throttled tile server then holds the whole globe in
          // LOADING with nothing drawn and no error raised.
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

      // Picking: click/hover a pin → map its id back to the AtlasMemory or Place
      // it came from, by the `mem:`/`place:` prefix each layer's entities carry.
      handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
      const idAt = (pos: Cesium.Cartesian2): { kind: 'mem' | 'place'; id: string } | null => {
        const picked = v.scene.pick(pos) as { id?: { id?: unknown } } | undefined;
        const id = picked?.id?.id;
        if (typeof id !== 'string') return null;
        if (id.startsWith('mem:')) return { kind: 'mem', id: id.slice(4) };
        if (id.startsWith('place:')) return { kind: 'place', id: id.slice(6) };
        return null;
      };
      handler.setInputAction((e: { position: Cesium.Cartesian2 }) => {
        const hit = idAt(e.position);
        if (hit?.kind === 'mem') {
          const m = memMapRef.current.get(hit.id);
          if (m) onPickRef.current?.(m);
        } else if (hit?.kind === 'place') {
          const p = placeMapRef.current.get(hit.id);
          if (p) onPickPlaceRef.current?.(p);
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction((e: { endPosition: Cesium.Cartesian2 }) => {
        const hit = idAt(e.endPosition);
        // hoveredId only ever means a *memory* hover (it drives ScrapbookFrames'
        // highlight) — a hovered place still shows the pointer cursor, but
        // doesn't touch that memory-specific state.
        onHoverRef.current?.(hit?.kind === 'mem' ? hit.id : null);
        v.scene.canvas.style.cursor = hit ? 'pointer' : '';
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

  // ---- places layer: named CI-Server Places (opt-in, empty by default) ----
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const ds = buildPlacesLayer(places);
    const added = viewer.dataSources.add(ds);
    return () => {
      void added.then((d) => { if (!viewer.isDestroyed()) viewer.dataSources.remove(d ?? ds, true); });
    };
  }, [viewer, places]);

  // ---- basemap switching ----
  // Swap the imagery layer in place rather than remounting the viewer, so the
  // camera, clock and entity layers all survive a basemap change. Only applies
  // to the keyless Esri set; with an ion token the ion imagery stays.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const token = Cesium.Ion.defaultAccessToken;
    if (token && token !== PLACEHOLDER_TOKEN) return;
    let cancelled = false;
    // Always keep the offline base at index 0 and swap only what sits above it,
    // so the globe still has ground while a new basemap's tiles arrive.
    const clearOverlay = () => {
      while (viewer.imageryLayers.length > 1) {
        viewer.imageryLayers.remove(viewer.imageryLayers.get(viewer.imageryLayers.length - 1), true);
      }
    };

    const entry = BASEMAPS.find((b) => b.id === basemap);
    // No `create` means the offline base is the choice — just drop any overlay.
    if (!entry?.create) { clearOverlay(); return; }

    try {
      const provider = entry.create();
      if (cancelled || viewer.isDestroyed()) return;
      clearOverlay();
      viewer.imageryLayers.add(new Cesium.ImageryLayer(provider));
    } catch (e) {
      console.error('[cesium] basemap swap failed', e);
    }
    return () => { cancelled = true; };
  }, [viewer, basemap]);

  // ---- sun / day-night terminator ----
  // Off by default: sun-accurate lighting puts every memory on the night side
  // into darkness, and half of them always are. As an opt-in it is the whole
  // point of a globe — you see where it is day, where it is night, and the
  // terminator sweeping between them.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    viewer.scene.globe.enableLighting = sunLighting;
    viewer.scene.globe.dynamicAtmosphereLighting = sunLighting;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
  }, [viewer, sunLighting]);

  // ---- Google Photorealistic 3D Tiles (buildings) ----
  // Loaded on demand, not at mount: it is a metered Google service and a heavy
  // stream, so it should only bill and download when the user asks for it.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !buildings) return;
    if (!Cesium.GoogleMaps.defaultApiKey) {
      console.warn('[atlas] buildings need VITE_GOOGLE_MAPS_API_KEY');
      return;
    }
    let cancelled = false;
    let tileset: Cesium.Cesium3DTileset | undefined;
    void Cesium.createGooglePhotorealistic3DTileset()
      .then((ts) => {
        if (cancelled || viewer.isDestroyed()) { ts.destroy?.(); return; }
        tileset = ts;
        viewer.scene.primitives.add(ts);
        // Google's tiles carry their own surface; the ellipsoid globe underneath
        // would z-fight through the streets.
        viewer.scene.globe.show = false;
      })
      .catch((e) => console.error('[atlas] photorealistic tiles failed', e));
    return () => {
      cancelled = true;
      if (!viewer.isDestroyed()) {
        if (tileset) viewer.scene.primitives.remove(tileset);
        viewer.scene.globe.show = true;
      }
    };
  }, [viewer, buildings]);

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
        // Don't let Cesium adopt whichever data source happens to be tracked:
        // the memory layer permanently stole clockTrackedDataSource, so on a
        // story swap the viewer clock ran one story behind. AtlasApp applies the
        // story's clock explicitly instead.
        automaticallyTrackDataSourceClocks={false}
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
        font: '600 13px Manrope, sans-serif',
        fillColor: fg,
        showBackground: true,
        backgroundColor: dark.withAlpha(0.66),
        backgroundPadding: new Cesium.Cartesian2(7, 4),
        pixelOffset: new Cesium.Cartesian2(0, -18),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: onTop,
        translucencyByDistance: new Cesium.NearFarScalar(2.0e6, 1.0, 1.2e7, 0.0),
        // Only label pins the camera is actually near. A real Companion Memory
        // has hundreds of located events (290 here), and with every label drawn
        // depth-test-disabled they overlap into unreadable horizontal bars
        // across the globe — it looked fine only because the demo story had
        // three. Below ~600km the pins are sparse enough on screen to name;
        // above it the point markers alone carry the distribution, and the
        // focused title is shown in the place chip and inspector regardless.
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6.0e5),
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

/** Build the named-Places layer as a CustomDataSource. Small dot for
 *  room/building/venue-scale places; a larger labeled pin for
 *  city/region/country/continent/planet, since a room-scale label at globe
 *  zoom is just noise. Uses `--atlas-violet` — the Legend's own "Place" swatch
 *  color, previously defined but drawn by nothing. */
function buildPlacesLayer(places: Place[]): Cesium.CustomDataSource {
  const ds = new Cesium.CustomDataSource('atlas-places');
  const violet = Cesium.Color.fromCssColorString('#b79cff');
  const dark = Cesium.Color.fromCssColorString('#041620');
  const fg = Cesium.Color.fromCssColorString('#d7e6e6');
  const onTop = Number.POSITIVE_INFINITY;
  const LABELED_KINDS = new Set(['city', 'region', 'country', 'continent', 'planet']);

  const seen = new Set<string>();
  for (const p of places) {
    if (p.latitude == null || p.longitude == null || seen.has(p.id)) continue;
    seen.add(p.id);
    const big = p.placeKind ? LABELED_KINDS.has(p.placeKind) : false;
    ds.entities.add({
      id: `place:${p.id}`,
      position: Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude),
      point: {
        pixelSize: big ? 10 : 6,
        color: violet,
        outlineColor: dark,
        outlineWidth: 1.5,
        disableDepthTestDistance: onTop,
      },
      label: big ? {
        text: p.name ?? p.placeKind ?? 'Place',
        font: '600 12px Manrope, sans-serif',
        fillColor: fg,
        showBackground: true,
        backgroundColor: dark.withAlpha(0.66),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        pixelOffset: new Cesium.Cartesian2(0, -14),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: onTop,
        translucencyByDistance: new Cesium.NearFarScalar(2.0e6, 1.0, 1.2e7, 0.0),
      } : undefined,
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
