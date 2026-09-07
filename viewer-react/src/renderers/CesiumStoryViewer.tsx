import { useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { Viewer, CzmlDataSource, Cesium3DTileset, type CesiumComponentRef } from 'resium';
import { storyToCzml, type Story, type Place } from '@companion-atlas/story';
import type { AtlasMemory } from '../model/atlasModel.js';
import { BASEMAPS, DEFAULT_BASEMAP, offlineImagery, resolveBasemap } from './basemaps.js';
import { createTerrain } from './terrain.js';
import { createLayerScene, isAtlasManagedImagery, type LayerScene } from '../layers/cesium.js';
import type { AtlasLayer } from '../layers/model.js';
import { keepForGlobe, type CzmlLike } from './globeCzml.js';

const PLACEHOLDER_TOKEN = 'your_cesium_ion_token_here';
type Located = AtlasMemory & { lat: number; lon: number };

/**
 * Day/night shading, applied so it survives the descent to a memory.
 *
 * `enableLighting` alone is not enough, and that is why the toggle looked dead:
 * Cesium's globe shader multiplies the sun term by a `fade` that goes to zero
 * once the camera is nearer than `lightingFadeOutDistance`, handing back a
 * fully lit pixel whatever the sun is doing. That distance is measured from the
 * earth's *centre*, so the ~9.99e6 m default is only ~3,600 km of altitude —
 * and AtlasApp flies to 1.8e6 m to frame a memory. The terminator existed the
 * whole time; it was simply never rendered anywhere the app actually looks.
 * Collapsing the band pins `fade` at 1 from orbit down to the street.
 *
 * `nightFade*` is deliberately left alone. Narrowing it too also darkens the
 * ground atmosphere, and the night side drops from "dim but readable" to solid
 * black — a memory you cannot look at, which is the thing this toggle was off
 * by default to avoid. With only the lighting band narrowed the shader's 0.3
 * floor keeps night-side terrain legible.
 *
 * **Where the sun's position comes from: `viewer.clock.currentTime`, and
 * nothing else.** Cesium derives the sun vector from the frame's time every
 * render, so the Time Machine already moves the sun — scrubbing writes the
 * clock (`AtlasApp.scrub`) and the terminator follows on the next frame,
 * whether the clock is animating or paused. Measured on the real archive, one
 * simulated day at a whole-globe framing: mean scene luminance 5.5 at 00:00
 * UTC, 50.6 at 12:00, 17.5 at 18:00, with the lit limb sweeping across the
 * disc between them. Nothing here needs to push the sun around, and anything
 * that tried would be a second writer racing the clock.
 *
 * So the thing that was actually broken was never the coupling — it was that
 * you could not see it. The lighting is off by default (half of any archive is
 * on the night side) and its switch lived two clicks into the layers popover,
 * so the Time Machine's readout would say "10:06 PM · night" over a globe in
 * full daylight. The switch now also sits in the time bar itself, wearing the
 * sun/moon glyph that already tracks the moment (`ui/TimeMachine.tsx`).
 */
const LIT_FADE_OUT = 1.0e4;
const LIT_FADE_IN = 1.0e5;

/**
 * Ask for one frame.
 *
 * Under `requestRenderMode` Cesium only draws when something tells it to. It
 * works that out for itself for the things it owns — camera moves, entity and
 * imagery-collection changes, tiles finishing, the clock moving — but a plain
 * property set on `globe` or `scene` is invisible to it. Every such mutation in
 * this file is followed by one of these; without it the change is real in the
 * scene graph and simply never appears, which looks exactly like a frozen app.
 */
function nudge(v: Cesium.Viewer | null | undefined): void {
  if (v && !v.isDestroyed()) v.scene.requestRender();
}

/**
 * Give up on a terrain provider whose *root* tiles fail, because that is what
 * actually turns the globe black.
 *
 * This is the answer to a bug that was twice diagnosed from screenshots and
 * twice mis-fixed on the imagery side. With a valid ion token and tile hosts
 * that cannot be reached, the imagery fallback below **does** engage: Cesium
 * 1.143's `ImageryLayer._requestImagery` reports the first non-cancelled tile
 * failure through `TileProviderError.reportError` on the *provider's own*
 * `errorEvent` (and `IonImageryProvider` forwards its inner provider's), so our
 * listener fires, the bundled Natural Earth raster is added at index 0 and the
 * dead ion layer is removed. The globe stays black anyway — because by then
 * there is no surface left to paint it on:
 *
 *   - A failed terrain request sets the tile's `terrainState` to FAILED. The
 *     state machine's recovery for that is `upsample()` from the parent, and a
 *     level-0 tile has no parent, so it takes the other path:
 *     `tile.state = QuadtreeTileLoadState.FAILED`. Nothing in Cesium ever moves
 *     a tile back out of FAILED, and the terrain machine only runs while the
 *     tile is LOADING — so a root tile that fails once is unrenderable for as
 *     long as that provider is installed.
 *   - The fill-mesh pass that normally papers over missing geometry cannot
 *     help: `TerrainFillMesh.updateFillTiles` seeds its traversal *only* with
 *     rendered tiles that already have a `vertexArray`, and propagates outward
 *     from them. With every root failed there is no seed, so no fill is built.
 *
 * Zero surface geometry, whatever the imagery underneath — a black ball of
 * starfield. And note the trigger is us *succeeding*: `layer.json` loads, we
 * install the provider, and Cesium throws away the perfectly good ellipsoid
 * tiles it was drawing (see `invalidateAllTiles` below) to request tiles that
 * never arrive.
 *
 * The recovery is simply to put a working provider back. Assigning
 * `terrainProvider` runs `Globe` → `GlobeSurfaceTileProvider` →
 * `QuadtreePrimitive.invalidateAllTiles()`, which frees the level-zero tiles
 * and rebuilds them, and `EllipsoidTerrainProvider` answers every request
 * synchronously and offline. The globe comes back flat, one frame later.
 *
 * Policy, and why it is this narrow:
 *
 *   - **Level 0 only.** A deeper tile that fails is survivable — it upsamples
 *     from its parent, or gets a fill mesh from its neighbours — and the globe
 *     still draws. Tearing down terrain globally for one bad tile in the Alps
 *     would be a worse trade than the coarse geometry Cesium already falls back
 *     to. Only the roots are fatal, and they are fatal permanently.
 *   - **One retry per root tile.** A single 502 from a CDN should not cost the
 *     session its terrain. Cesium's own `timesRetried` cannot express this: the
 *     terrain path reuses one `TileProviderError` object per provider and never
 *     calls `reportSuccess` to reset it, so that counter is "errors this
 *     provider has had", not "times this tile failed". Hence our own key set.
 *   - **Only while our provider is still installed.** `layers/cesium.ts` hands
 *     the globe to a user's quantized-mesh layer when they add one; a late
 *     error from the provider we installed must not stomp on that.
 *
 * Exported for the test suite, which drives it with a stub provider — there is
 * no globe, and no network, in a unit test.
 */
export function watchTerrainFailure(
  v: Cesium.Viewer,
  provider: Cesium.TerrainProvider,
): () => void {
  const retried = new Set<string>();
  let fellBack = false;
  const onError = (err: Cesium.TileProviderError): void => {
    if (fellBack || err.level !== 0) return;
    const key = `${err.x}/${err.y}`;
    if (!retried.has(key)) {
      retried.add(key);
      // Listeners own this flag; the reporter reads it after the last one runs.
      err.retry = true;
      return;
    }
    fellBack = true;
    console.warn(
      '[cesium] terrain root tile failed twice; falling back to the smooth ellipsoid',
      err.message,
    );
    if (v.isDestroyed() || v.terrainProvider !== provider) return;
    v.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    nudge(v);
  };
  provider.errorEvent.addEventListener(onError);
  return () => provider.errorEvent.removeEventListener(onError);
}

function applySunLighting(globe: Cesium.Globe, on: boolean, stock: { out: number; in: number }): void {
  globe.enableLighting = on;
  globe.dynamicAtmosphereLighting = on;
  globe.lightingFadeOutDistance = on ? LIT_FADE_OUT : stock.out;
  globe.lightingFadeInDistance = on ? LIT_FADE_IN : stock.in;
}

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
const EMPTY_IDS: readonly string[] = [];

/** The three projections Cesium can draw, named for the app rather than for
 *  Cesium's enum — `SCENE2D` is not a phrase anyone says out loud. */
export type SceneModeName = '3d' | '2d' | 'columbus';

const SCENE_MORPH_SECONDS = 1.2;

export function CesiumStoryViewer({
  story, memories, places = [], focusedId, basemap = DEFAULT_BASEMAP, sunLighting = false,
  buildings = false,
  onViewer, onPick, onPickPlace, onHover, onInteract,
  layers = [], claimedUrls, timeMs = null, extraItemIds = EMPTY_IDS,
  sceneMode = '3d', reduceMotion = false,
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
  /** User-added data sources (see src/layers/). Drawn above the basemap and
   *  below nothing — the story's own entities live in a CZML data source, which
   *  Cesium renders separately from the imagery stack. */
  layers?: readonly AtlasLayer[];
  /**
   * Source URLs the layer stack speaks for: the ones it is drawing, plus the
   * story-supplied ones the user removed.
   *
   * Deriving this from `layers` alone made removing a story's 3D tileset
   * impossible. The removal un-claimed the URL in the same commit that tore the
   * stack's own tileset down, so this path remounted it — a flicker, and then
   * the tileset was back on the globe with no panel row, no visibility toggle
   * and no opacity control. A removal has to claim the URL too.
   */
  claimedUrls?: ReadonlySet<string>;
  /** Clock position, so time-windowed layers hide themselves outside their
   *  availability and `{Time}`-dimensioned sources (GIBS) follow the scrub. */
  timeMs?: number | null;
  /**
   * Which projection the globe is drawn in. Google Earth offers 2D and 3D of
   * the same project and Atlas offered only 3D — `sceneModePicker` was disabled
   * and there was no other route, so a story that is really a map (a route, a
   * boundary, a set of places) could only ever be read at an angle.
   *
   * Columbus view is offered too because it is the honest middle: a flat map
   * that still has height, which is where a 3D tileset or a raised track still
   * reads correctly and a plain 2D projection flattens it away.
   */
  sceneMode?: SceneModeName;
  /** Morphs become cuts. A projection change is a large, whole-screen motion —
   *  exactly what someone who asked for less of it meant. */
  reduceMotion?: boolean;
  /** Ids of story items that have no scene, and therefore no memory pin
   *  standing in for them — imported KML/GeoJSON features, and anything drawn
   *  by hand. Their CZML packets are rendered rather than filtered away. */
  extraItemIds?: readonly string[];
}) {
  // Read inside the mount effect without making it a dependency (remounting
  // the viewer to change basemap would tear down the whole scene).
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  const { czml, tilesets } = useMemo(() => storyToCzml(story), [story]);
  // `storyToCzml` turns a story's 3d-tiles and gaussian-splat layers into
  // tilesets, and the layer stack now also adopts those same layers (AtlasApp
  // merges `story.layers` into it, so they are toggleable and get an opacity
  // control). Rendering both mounts every such tileset twice — two coincident
  // surfaces that z-fight, two sets of tile requests, two copies in memory.
  // The stack wins, because it is the one the user can operate; matching on URL
  // rather than id, since the layer model regenerates ids on the way in.
  const ownTilesets = useMemo(() => {
    // `claimedUrls` also holds the URLs of story layers the user removed, so a
    // removal keeps this path stood down instead of un-claiming the tileset and
    // letting it reappear uncontrollably. The fallback keeps this component
    // usable without a layer stack at all.
    const claimed = claimedUrls ?? new Set(layers.map((l) => l.url));
    if (!claimed.size) return tilesets;
    return tilesets.filter((t) => !claimed.has(t.url));
  }, [tilesets, layers, claimedUrls]);

  // See globeCzml.ts for why this filter is narrower than it looks.
  const passthroughIds = useMemo(() => new Set(extraItemIds), [extraItemIds]);
  const globeCzml = useMemo(
    () => czml.filter((p) => keepForGlobe(p as CzmlLike, passthroughIds)),
    [czml, passthroughIds],
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
  const sunLightingRef = useRef(sunLighting); sunLightingRef.current = sunLighting;
  // Cesium's own fade band, read off the globe before we ever narrow it, so
  // turning the sun back off restores exactly what it shipped with.
  const stockFadeRef = useRef<{ out: number; in: number } | null>(null);
  const memMapRef = useRef(new Map<string, AtlasMemory>());
  memMapRef.current = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);
  // The live memory layer, so a focus change can repaint its two affected
  // pins instead of every pin re-evaluating a closure every frame.
  const memLayerRef = useRef<Cesium.CustomDataSource | null>(null);
  const highlightedRef = useRef<string | null>(focusedId);
  const placeMapRef = useRef(new Map<string, Place>());
  placeMapRef.current = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  // ---- mount: acquire the viewer, configure imagery, install picking ----
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let cleanupImageryError: (() => void) | undefined;
    let cleanupTerrainError: (() => void) | undefined;
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

      // Nothing here ever clears the whole stack. Either path can land while the
      // basemap effect has already attached the chosen overlay on top, and a
      // removeAll() would silently delete it — the globe then sits on two-level
      // Natural Earth and goes black as soon as the camera drops below orbit.
      // Insert underneath instead, so base and overlay coexist whatever order
      // they land in. `replace` is the one layer being given up on (the ion
      // layer whose tiles are erroring), removed by identity after the offline
      // floor is in place so there is never a frame with no ground at all.
      const loadOffline = async ({ replace }: { replace?: Cesium.ImageryLayer } = {}) => {
        try {
          const offline = await offlineImagery();
          if (!alive()) return;
          v.imageryLayers.add(new Cesium.ImageryLayer(offline), 0);
          if (replace) v.imageryLayers.remove(replace, true);
        } catch (e) {
          if (alive()) console.error('[cesium] offline imagery failed', e);
        }
      };

      void (async () => {
        if (hasIon) {
          try {
            const world = await withTimeout(Cesium.createWorldImageryAsync(), 8000, 'ion imagery');
            if (!alive()) return;
            const ionLayer = new Cesium.ImageryLayer(world);
            v.imageryLayers.add(ionLayer, 0);
            let swapped = false;
            const onImageryError = () => { if (swapped || !alive()) return; swapped = true; void loadOffline({ replace: ionLayer }); };
            world.errorEvent.addEventListener(onImageryError);
            cleanupImageryError = () => world.errorEvent.removeEventListener(onImageryError);
          } catch {
            await loadOffline();
          }
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

      // Terrain, deliberately *outside* the ion branch and not chained behind
      // the imagery await above.
      //
      // `createTerrain()` (renderers/terrain.ts) resolves in a defined order —
      // the deployment's own quantized-mesh tileset from `VITE_TERRAIN_URL`,
      // then ion World Terrain, then the ellipsoid — and only the middle rung
      // needs a token. This used to call `createWorldTerrainAsync()` inline
      // inside `if (hasIon)`, which made the one terrain option that works
      // *without* an account unreachable for exactly the keyless deployments it
      // exists for: `VITE_TERRAIN_URL` and `VITE_TERRAIN_CREDIT` were
      // documented settings that no code read. It also sat after `await`ing the
      // ion imagery, so a slow (or 8-second-timing-out) imagery handshake
      // delayed terrain that has nothing to do with it.
      //
      // No `withTimeout` here: `createTerrain` carries the same 8 s budget on
      // both of its remote rungs, and it resolves rather than rejects — the
      // ellipsoid is a legitimate answer, not a failure.
      void createTerrain()
        .then((choice) => {
          if (!alive()) return;
          console.info(`[cesium] terrain: ${choice.detail}`);
          // The ellipsoid is already what the Viewer mounts with. Assigning a
          // second one would call `invalidateAllTiles` — throwing away every
          // tile loaded so far — to arrive at the same globe.
          if (choice.source === 'ellipsoid') return;
          v.terrainProvider = choice.provider;
          cleanupTerrainError = watchTerrainFailure(v, choice.provider);
          nudge(v);
        })
        .catch((e) => console.warn('[cesium] terrain selection failed', e));

      // Apply the *current* lighting choice rather than a hard-coded `false`.
      // This runs a frame or more after mount (Resium hands the viewer over on a
      // later tick), so whether it lands before or after the sunLighting effect
      // below is a race — and hard-coding either answer here means one of the two
      // orders silently wins. Reading the prop makes both orders agree.
      stockFadeRef.current ??= {
        out: v.scene.globe.lightingFadeOutDistance,
        in: v.scene.globe.lightingFadeInDistance,
      };
      applySunLighting(v.scene.globe, sunLightingRef.current, stockFadeRef.current);
      v.scene.fog.enabled = true;
      if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
      nudge(v);
      // Render the globe at device resolution (crisp on HiDPI), capped for perf.
      //
      // `resolutionScale` is a MULTIPLIER on the device pixel ratio, not a
      // replacement for it: with `useBrowserRecommendedResolution` false Cesium
      // already renders at `devicePixelRatio`, and then multiplies by this. So
      // assigning `min(2, dpr)` asked for dpr * min(2, dpr) — on an ordinary 2x
      // display that is a pixel ratio of 4, i.e. sixteen times the CSS pixel
      // count. Measured on this machine: a 1380x846 canvas backed by a
      // 5520x3384 buffer, 18.7 megapixels, and with 4x MSAA on top of it about
      // 75 megapixels of samples every frame. The globe ran at 1.6 fps with the
      // camera sitting still.
      //
      // Dividing by the ratio Cesium is already applying leaves exactly the
      // cap the comment always claimed: pixelRatio = min(2, dpr).
      const dpr = window.devicePixelRatio || 1;
      v.useBrowserRecommendedResolution = false;
      v.resolutionScale = Math.min(2, dpr) / dpr;

      // NOT enabled here, deliberately: `v.scene.requestRenderMode = true`.
      //
      // Removing the pins' per-frame closures made it *possible* — 580
      // non-constant properties used to mark the scene dirty on every frame,
      // which defeats the mode outright — and an idle globe still costs a full
      // 24.6 ms frame forever, so the win is real and worth taking. What is
      // missing is proof. Its failure mode is that some mutation nobody thought
      // to follow with a `requestRender` stops appearing at all, which presents
      // as a frozen app, and that has to be verified against a *running* render
      // loop: the mode's gate is in the loop, not in `scene.render()`, so
      // driving `render()` by hand cannot tell you whether it works.
      //
      // The `nudge()` calls below are the groundwork and are already in place;
      // `requestRender` is a no-op while this stays off. Turning it on is one
      // line plus a pass over every mutation site.

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
      cleanupTerrainError?.();
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
    const ds = buildMemoryLayer(memories, focusedIdRef.current);
    memLayerRef.current = ds;
    // The layer is rebuilt from scratch, so the pin the highlight was last
    // applied to no longer exists. Forget it, or the next focus change would
    // try to un-highlight an entity from the previous layer.
    highlightedRef.current = focusedIdRef.current;
    // dataSources.add resolves on a microtask; remove() is synchronous. Remove
    // in the add promise's resolution so a fast rebuild/unmount can't leave an
    // orphaned layer that was pushed after cleanup ran.
    const added = viewer.dataSources.add(ds);
    return () => {
      if (memLayerRef.current === ds) memLayerRef.current = null;
      void added.then((d) => { if (!viewer.isDestroyed()) viewer.dataSources.remove(d ?? ds, true); });
    };
  }, [viewer, memories]);

  // ---- focus highlight: repaint two pins, rather than all of them every frame ----
  useEffect(() => {
    applyFocusHighlight(memLayerRef.current, highlightedRef.current, focusedId);
    highlightedRef.current = focusedId;
    // A constant property does not mark the scene dirty by itself, so ask for
    // the one frame that shows the change. Harmless while requestRenderMode is
    // off, and required the moment it is turned on.
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }, [viewer, focusedId, memories]);

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
  // User layers. `createLayerScene` owns everything it adds and diffs on a
  // source fingerprint, so this effect can run on every clock tick without
  // rebuilding providers.
  const layerSceneRef = useRef<LayerScene | null>(null);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const scene = createLayerScene(viewer);
    layerSceneRef.current = scene;
    return () => {
      scene.destroy();
      layerSceneRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    layerSceneRef.current?.sync(layers, timeMs);
  }, [viewer, layers, timeMs, basemap]);

  // Projection. Cesium morphs between the three rather than rebuilding, so the
  // camera, every data source and the clock survive the change — which is why
  // this is a scene call and not a remount.
  //
  // Guarded on the *current* mode: `morphTo*` restarts the animation even when
  // the scene is already there, and this effect re-runs for reasons that have
  // nothing to do with the projection.
  const requestedModeRef = useRef<Cesium.SceneMode | null>(null);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const scene = viewer.scene;
    const want =
      sceneMode === '2d' ? Cesium.SceneMode.SCENE2D
      : sceneMode === 'columbus' ? Cesium.SceneMode.COLUMBUS_VIEW
      : Cesium.SceneMode.SCENE3D;
    // Guard on the last mode we ASKED for, not on the scene's current mode.
    //
    // Those come apart, and when they do, guarding on `scene.mode` wedges the
    // control: a morph that is interrupted, or that Cesium does not finish,
    // leaves the scene in one projection while React holds another, and the
    // next press computes the mode the scene is *already* in — so the guard
    // returns and the button appears dead. Observed exactly that: the scene sat
    // in 2D while the control read "3D", and no number of presses moved it.
    //
    // Re-issuing a morph the scene is already in is harmless; failing to issue
    // one is not.
    if (requestedModeRef.current === want) return;
    requestedModeRef.current = want;
    const seconds = reduceMotion ? 0 : SCENE_MORPH_SECONDS;
    if (want === Cesium.SceneMode.SCENE2D) scene.morphTo2D(seconds);
    else if (want === Cesium.SceneMode.COLUMBUS_VIEW) scene.morphToColumbusView(seconds);
    else scene.morphTo3D(seconds);
  }, [viewer, sceneMode, reduceMotion]);

  // camera, clock and entity layers all survive a basemap change.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const token = Cesium.Ion.defaultAccessToken;
    const hasIon = Boolean(token) && token !== PLACEHOLDER_TOKEN;
    let cancelled = false;
    // Always keep the mounted base at index 0 and swap only what sits above it,
    // so the globe still has ground while a new basemap's tiles arrive.
    // Only sweep away *our* basemap overlay. The user's layers sit in the same
    // imagery collection, and the previous "remove everything above index 0"
    // deleted all of them on the first basemap swap. The layer adapter tags
    // what it owns for exactly this reason.
    const clearOverlay = () => {
      for (let i = viewer.imageryLayers.length - 1; i >= 1; i--) {
        const layer = viewer.imageryLayers.get(i);
        if (!isAtlasManagedImagery(layer)) viewer.imageryLayers.remove(layer, true);
      }
    };

    const entry = resolveBasemap(basemap);
    // Two ways the answer is "no overlay at all": an entry with no `create` is
    // the mounted base layer itself, and under ion the default choice already
    // *is* what is mounted — ion World Imagery is satellite imagery, so laying
    // Esri's on top of it would fetch a second set of tiles to draw the same
    // ground. Every other choice applies whether or not ion is configured;
    // this effect used to bail outright when it was, which quietly turned the
    // whole picker into a no-op the moment the ion token was wired up.
    if (!entry.create || (hasIon && entry.id === DEFAULT_BASEMAP)) { clearOverlay(); return; }

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
    stockFadeRef.current ??= {
      out: viewer.scene.globe.lightingFadeOutDistance,
      in: viewer.scene.globe.lightingFadeInDistance,
    };
    applySunLighting(viewer.scene.globe, sunLighting, stockFadeRef.current);
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    nudge(viewer); // plain property sets on `globe`; Cesium cannot see them
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
        nudge(viewer);
      })
      .catch((e) => console.error('[atlas] photorealistic tiles failed', e));
    return () => {
      cancelled = true;
      if (!viewer.isDestroyed()) {
        if (tileset) viewer.scene.primitives.remove(tileset);
        viewer.scene.globe.show = true;
        nudge(viewer);
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
        {ownTilesets.map((t) => (
          <Cesium3DTileset key={t.id} url={t.url} />
        ))}
      </Viewer>
    </div>
  );
}

/** Pin radius in pixels: ordinary, and the one the app is focused on. */
const PIN_PIXEL_SIZE = 11;
const FOCUSED_PIXEL_SIZE = 16;

const PIN_TEAL = Cesium.Color.fromCssColorString('#72ddd4');
const PIN_MINT = Cesium.Color.fromCssColorString('#58ebbf');

/**
 * Repaint only the pins whose focus state actually changed.
 *
 * This is the half of the job a `CallbackProperty` used to do every frame for
 * every pin. Touching two entities on a discrete focus change costs nothing and
 * leaves every property constant, which is what lets the scene go quiet.
 */
function applyFocusHighlight(
  ds: Cesium.CustomDataSource | null,
  previousId: string | null,
  nextId: string | null,
): void {
  if (!ds || previousId === nextId) return;
  for (const [id, focused] of [[previousId, false], [nextId, true]] as const) {
    if (!id) continue;
    const point = ds.entities.getById(`mem:${id}`)?.point;
    if (!point) continue; // filtered out, or the layer was rebuilt under us
    point.pixelSize = new Cesium.ConstantProperty(focused ? FOCUSED_PIXEL_SIZE : PIN_PIXEL_SIZE);
    point.color = new Cesium.ConstantProperty(focused ? PIN_MINT : PIN_TEAL);
  }
}

/** Build the interactive memory layer as a CustomDataSource. */
function buildMemoryLayer(memories: AtlasMemory[], focusedId: string | null): Cesium.CustomDataSource {
  const ds = new Cesium.CustomDataSource('atlas-memories');
  const teal = PIN_TEAL;
  const mint = PIN_MINT;
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
        // Plain values, not `CallbackProperty`. Focus is a discrete user action
        // — a click, a scrub — but a CallbackProperty constructed with
        // `isConstant = false` tells Cesium the value changes *every frame*, so
        // it re-evaluated two closures per pin, 580 of them here, on every
        // render and held the scene permanently dirty. That is also what made
        // `requestRenderMode` unusable: a scene that is always dirty never
        // stops rendering, so an idle globe cost a full frame forever.
        //
        // `applyFocusHighlight` repaints the two pins that actually changed.
        pixelSize: m.id === focusedId ? FOCUSED_PIXEL_SIZE : PIN_PIXEL_SIZE,
        color: m.id === focusedId ? mint : teal,
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
