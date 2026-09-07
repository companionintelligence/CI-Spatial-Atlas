import * as Cesium from 'cesium';
import { isAvailableAt, sortLayers, type AtlasLayer, type LayerOptions } from './model.js';

/**
 * The layer stack → the Cesium scene.
 *
 * One object owns every layer Atlas mounts, so the viewer component stays a
 * component: `createLayerScene(viewer)` once, `sync(layers, timeMs)` whenever
 * the stack or the clock changes, `destroy()` on unmount. No React in here, and
 * no Cesium anywhere else in `src/layers` — this is the only file that has to
 * be loaded in a browser with a WebGL context, which is what keeps the rest of
 * the model unit-testable.
 *
 * ## Diffing, not rebuilding
 *
 * `sync` compares each layer against a fingerprint of the things that decide
 * *what gets fetched* (format, URL, provider options, resolved time). If those
 * are unchanged, only the cheap properties are touched — `show`, `alpha` and
 * position in the collection. Rebuilding a provider on every render would throw
 * away Cesium's tile cache and make a slider drag re-download the planet.
 *
 * ## Graceful degradation
 *
 * Every mount is wrapped: a layer that fails to load logs once and leaves the
 * rest of the scene alone. That is the guarantee `renderers/basemaps.ts` makes
 * for imagery and this file extends to user-supplied sources, which are far
 * more likely to be wrong — a typo'd tileset URL must not take the globe down.
 */

/**
 * Marks the imagery layers this module owns.
 *
 * `CesiumStoryViewer`'s basemap effect clears "everything above index 0" when
 * the basemap changes. Without a marker it would take our layers with it, and
 * they would silently disappear the first time someone switched basemap. The
 * fix on that side is one predicate — see `isAtlasManagedImagery` — and the tag
 * is a plain property so it survives without subclassing Cesium's type.
 */
export const ATLAS_LAYER_TAG = '__atlasLayerId';

/** True for an imagery layer mounted by this module. Use it in any code that
 *  sweeps `viewer.imageryLayers`, so a basemap swap leaves user layers alone. */
export function isAtlasManagedImagery(layer: Cesium.ImageryLayer): boolean {
  return typeof (layer as unknown as Record<string, unknown>)[ATLAS_LAYER_TAG] === 'string';
}

export interface LayerScene {
  /** Apply a stack. Safe to call on every render; it diffs. */
  sync(layers: readonly AtlasLayer[], atMs?: number | null): void;
  /** Remove everything this scene mounted and restore the original terrain. */
  destroy(): void;
}

interface Mounted {
  fingerprint: string;
  imagery?: Cesium.ImageryLayer;
  dataSource?: Cesium.DataSource;
  tileset?: Cesium.Cesium3DTileset;
  /** Set while an async mount is in flight; cleared if it is superseded. */
  cancelled?: boolean;
  credit?: Cesium.Credit;
}

/**
 * Resolve a colour that may be a CSS custom property reference.
 *
 * The catalog writes `var(--atlas-coral)` rather than a hex literal so layer
 * colours stay part of the one theme in `theme/atlas.css`. Cesium needs a real
 * colour, so the variable is read off the document at mount time, with the
 * fallback used when there is no document (tests, workers) or the variable is
 * not defined.
 */
export function resolveColour(value: string | undefined, fallback: Cesium.Color): Cesium.Color {
  if (!value) return fallback;
  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*?)\s*)?\)$/.exec(value.trim());
  let literal = value.trim();
  if (varMatch) {
    const name = varMatch[1]!;
    let resolved = '';
    try {
      resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    } catch { /* no DOM */ }
    literal = resolved || (varMatch[2] ?? '');
    if (!literal) return fallback;
  }
  try {
    return Cesium.Color.fromCssColorString(literal) ?? fallback;
  } catch {
    return fallback;
  }
}

const tilingSchemeFor = (o: LayerOptions | undefined): Cesium.TilingScheme =>
  // Web Mercator unless told otherwise: Cesium defaults to geographic, and
  // essentially every {z}/{x}/{y} source on the open web is Mercator. Taking
  // the library's default is the documented blank-globe bug (see basemaps.ts).
  o?.tilingScheme === 'geographic' ? new Cesium.GeographicTilingScheme() : new Cesium.WebMercatorTilingScheme();

/**
 * A query parameter, matched case-insensitively.
 *
 * OGC names are case-insensitive by specification and real services write them
 * every way there is. A KVP WMTS endpoint already carries `layer=` and
 * `tilematrixset=` in its own query, so reading them back is better than
 * handing Cesium an empty string and letting it build `&layer=`.
 */
function urlParam(url: string, name: string): string | undefined {
  try {
    const want = name.toLowerCase();
    for (const [k, v] of new URL(url.replace(/\{[^}]*\}/g, '_')).searchParams) {
      if (k.toLowerCase() === want && v) return v;
    }
  } catch { /* a template URL that will not parse has no query to read */ }
  return undefined;
}

const creditFor = (layer: AtlasLayer): Cesium.Credit | undefined =>
  layer.attribution?.text ? new Cesium.Credit(layer.attribution.text, layer.attribution.onScreen === true) : undefined;

/**
 * The date a time-dimensioned layer should ask for, quantised to the day.
 *
 * NASA GIBS publishes one granule per day. Substituting the exact clock instant
 * would rebuild the provider on every tick and throw the tile cache away sixty
 * times a second; the day is the granularity the data actually has.
 */
export function resolvedDimensions(layer: AtlasLayer, atMs: number | null | undefined): Record<string, string> | undefined {
  const dims = layer.options?.dimensions;
  if (!layer.options?.followsClock) return dims;
  const t = atMs == null || !Number.isFinite(atMs) ? Date.now() : atMs;
  return { ...dims, Time: new Date(t).toISOString().slice(0, 10) };
}

/** Everything that decides what gets fetched. Change it and the provider is
 *  rebuilt; leave it and only show/alpha/order are touched. */
function fingerprint(layer: AtlasLayer, atMs: number | null | undefined): string {
  return JSON.stringify([layer.format, layer.url, layer.options ?? null, resolvedDimensions(layer, atMs) ?? null]);
}

/** Build the imagery provider for a raster layer. Throws on a URL Cesium
 *  refuses; the caller degrades gracefully around it. */
export function createImageryProvider(layer: AtlasLayer, atMs?: number | null): Cesium.ImageryProvider {
  const o = layer.options ?? {};
  const credit = creditFor(layer);
  const common = {
    ...(credit ? { credit } : {}),
    ...(o.minimumLevel != null ? { minimumLevel: o.minimumLevel } : {}),
    ...(o.maximumLevel != null ? { maximumLevel: o.maximumLevel } : {}),
    ...(o.tileWidth ? { tileWidth: o.tileWidth } : {}),
    ...(o.tileHeight ? { tileHeight: o.tileHeight } : {}),
  };

  switch (layer.format) {
    case 'wmts':
      return new Cesium.WebMapTileServiceImageryProvider({
        url: layer.url,
        layer: o.wmtsLayer ?? urlParam(layer.url, 'layer') ?? '',
        style: o.wmtsStyle ?? urlParam(layer.url, 'style') ?? 'default',
        tileMatrixSetID: o.tileMatrixSet ?? urlParam(layer.url, 'tilematrixset') ?? 'GoogleMapsCompatible',
        format: o.mimeType ?? 'image/jpeg',
        tilingScheme: tilingSchemeFor(o),
        ...(o.subdomains ? { subdomains: o.subdomains } : {}),
        ...(resolvedDimensions(layer, atMs) ? { dimensions: resolvedDimensions(layer, atMs) } : {}),
        ...common,
      });
    case 'wms':
      return new Cesium.WebMapServiceImageryProvider({
        url: layer.url,
        layers: o.wmsLayers ?? urlParam(layer.url, 'layers') ?? '',
        parameters: {
          format: o.mimeType ?? 'image/png',
          // Transparency by default for an overlay: a WMS that returns opaque
          // white where it has no data hides the entire basemap under it.
          transparent: o.transparent !== false,
          ...(o.wmsStyles ? { styles: o.wmsStyles } : {}),
        },
        tilingScheme: tilingSchemeFor(o),
        ...common,
      });
    case 'tms':
      // TMS counts rows from the south; `{reverseY}` is Cesium's spelling of
      // the flip, so a `{-y}`/`{y}` template is rewritten rather than rejected.
      return new Cesium.UrlTemplateImageryProvider({
        url: layer.url.replace(/\{-y\}/gi, '{reverseY}').replace(/\{y\}/g, '{reverseY}'),
        tilingScheme: tilingSchemeFor(o),
        ...(o.subdomains ? { subdomains: o.subdomains } : {}),
        ...common,
      });
    case 'xyz':
    default:
      return new Cesium.UrlTemplateImageryProvider({
        url: layer.url,
        tilingScheme: tilingSchemeFor(o),
        ...(o.subdomains ? { subdomains: o.subdomains } : {}),
        ...common,
      });
  }
}

/**
 * Dim a vector layer.
 *
 * A `DataSource` has no single alpha, so the alpha is pushed into each entity's
 * constant colours. Only constant colour materials are touched: an image or
 * grid material has no colour to multiply, and a time-varying property would
 * need a wrapper that fights whatever set it. Those keep their own appearance
 * rather than being half-converted — a partially applied opacity looks like a
 * rendering bug, and this way the slider simply has no effect on them.
 */
export function applyDataSourceAlpha(ds: Cesium.DataSource, alpha: number): void {
  const withAlpha = (c: Cesium.Color) => Cesium.Color.fromAlpha(c, alpha);
  for (const entity of ds.entities.values) {
    const point = entity.point;
    if (point?.color instanceof Cesium.ConstantProperty) {
      point.color = new Cesium.ConstantProperty(withAlpha(point.color.getValue(Cesium.JulianDate.now())));
    }
    const billboard = entity.billboard;
    if (billboard?.color instanceof Cesium.ConstantProperty) {
      billboard.color = new Cesium.ConstantProperty(withAlpha(billboard.color.getValue(Cesium.JulianDate.now())));
    }
    for (const graphic of [entity.polygon, entity.polyline, entity.ellipse, entity.rectangle, entity.corridor]) {
      const material = graphic?.material;
      if (material instanceof Cesium.ColorMaterialProperty && material.color instanceof Cesium.ConstantProperty) {
        material.color = new Cesium.ConstantProperty(withAlpha(material.color.getValue(Cesium.JulianDate.now())));
      }
    }
  }
}

/**
 * Mount a stack of layers on a viewer and keep it in step.
 *
 * The returned object is the only handle: it holds every Cesium object it
 * created, so nothing leaks when the component unmounts and nothing else has to
 * know how a WMTS layer differs from a tileset.
 */
export function createLayerScene(viewer: Cesium.Viewer): LayerScene {
  const mounted = new Map<string, Mounted>();
  // Captured before we touch anything, so `destroy()` puts the globe back the
  // way the viewer configured it — Atlas's terrain may be ion's, may be the
  // ellipsoid, and this module must not decide which.
  const baseTerrain = viewer.terrainProvider;
  let terrainOwner: string | null = null;
  let destroyed = false;
  /** Set by any mount/unmount, cleared by the render request in `sync`. */
  let sceneChanged = false;

  const alive = () => !destroyed && !viewer.isDestroyed();
  /** A paused render loop cannot see a property set or a collection change. */
  const nudge = () => { if (alive()) viewer.scene.requestRender(); };

  const unmount = (id: string) => {
    const m = mounted.get(id);
    if (!m) return;
    m.cancelled = true;
    mounted.delete(id);
    sceneChanged = true;
    if (!viewer.isDestroyed()) {
      if (m.imagery) viewer.imageryLayers.remove(m.imagery, true);
      if (m.dataSource) viewer.dataSources.remove(m.dataSource, true);
      if (m.tileset) viewer.scene.primitives.remove(m.tileset);
      if (m.credit) {
        try { viewer.creditDisplay.removeStaticCredit(m.credit); } catch { /* already gone */ }
      }
    }
    if (terrainOwner === id) {
      terrainOwner = null;
      if (!viewer.isDestroyed()) viewer.terrainProvider = baseTerrain;
    }
  };

  const mount = (layer: AtlasLayer, atMs: number | null | undefined, fp: string) => {
    const record: Mounted = { fingerprint: fp };
    mounted.set(layer.id, record);
    sceneChanged = true;

    switch (layer.format) {
      case 'xyz':
      case 'tms':
      case 'wmts':
      case 'wms': {
        try {
          const imagery = new Cesium.ImageryLayer(createImageryProvider(layer, atMs));
          (imagery as unknown as Record<string, unknown>)[ATLAS_LAYER_TAG] = layer.id;
          viewer.imageryLayers.add(imagery);
          record.imagery = imagery;
        } catch (e) {
          console.error(`[atlas/layers] "${layer.name}" could not be mounted as ${layer.format}`, e);
          mounted.delete(layer.id);
        }
        return;
      }
      case 'geojson':
      case 'kml':
      case 'czml': {
        const credit = creditFor(layer);
        if (credit) {
          // Vector data sources take no credit of their own, so the obligation
          // is met by putting it in the same on-screen list the imagery uses.
          try { viewer.creditDisplay.addStaticCredit(credit); record.credit = credit; } catch { /* older Cesium */ }
        }
        void loadDataSource(layer, viewer)
          .then((ds) => {
            if (!alive() || record.cancelled) return;
            record.dataSource = ds;
            viewer.dataSources.add(ds);
            applyVectorAppearance(ds, layer);
            nudge();
          })
          .catch((e) => {
            console.error(`[atlas/layers] "${layer.name}" failed to load — the URL may be wrong, or the server may not allow cross-origin reads`, e);
          });
        return;
      }
      case '3d-tiles':
      case 'gaussian-splat': {
        // Splats reach the scene as 3D Tiles, exactly as `czml.ts` already
        // hands both kinds to a `Cesium3DTileset`; the distinct kind is kept
        // for the story's vocabulary, not for a different loader.
        //
        // The credit is registered separately rather than passed in: a tileset
        // takes its credits from its own `asset.copyright`, so a layer whose
        // attribution we know has to put it on the display itself.
        const tilesetCredit = creditFor(layer);
        if (tilesetCredit) {
          try { viewer.creditDisplay.addStaticCredit(tilesetCredit); record.credit = tilesetCredit; } catch { /* older Cesium */ }
        }
        void Cesium.Cesium3DTileset.fromUrl(layer.url, { showCreditsOnScreen: layer.attribution?.onScreen === true })
          .then((tileset) => {
            if (!alive() || record.cancelled) { tileset.destroy?.(); return; }
            record.tileset = tileset;
            viewer.scene.primitives.add(tileset);
            applyTilesetAppearance(tileset, layer);
            nudge();
          })
          .catch((e) => {
            console.error(`[atlas/layers] tileset "${layer.name}" failed to load`, e);
          });
        return;
      }
      case 'quantized-mesh': {
        void Cesium.CesiumTerrainProvider.fromUrl(layer.url, { requestVertexNormals: true })
          .then((terrain) => {
            // Only the layer that is still the chosen terrain owner may apply
            // it: two terrain layers loading at once must not race, and the
            // user may have hidden this one while it was in flight.
            if (!alive() || record.cancelled || terrainOwner !== layer.id) return;
            viewer.terrainProvider = terrain;
            nudge();
          })
          .catch((e) => {
            // Keep whatever terrain is already mounted. A failed terrain swap
            // that left the globe with *no* surface would be far worse than a
            // flat one.
            terrainOwner = null;
            console.error(`[atlas/layers] terrain "${layer.name}" failed to load; keeping the current terrain`, e);
          });
        return;
      }
    }
  };

  const sync: LayerScene['sync'] = (layers, atMs = null) => {
    if (!alive()) return;
    const ordered = sortLayers(layers);
    const wanted = new Set(ordered.map((l) => l.id));

    for (const id of [...mounted.keys()]) if (!wanted.has(id)) unmount(id);

    // Terrain is exclusive — the globe has exactly one surface. The topmost
    // visible, in-window terrain layer wins, which makes the stack order mean
    // the same thing for terrain as it does for imagery.
    const terrainLayer = [...ordered].reverse().find(
      (l) => l.format === 'quantized-mesh' && l.visible && isAvailableAt(l, atMs),
    );
    if (terrainOwner && terrainOwner !== terrainLayer?.id) {
      terrainOwner = null;
      viewer.terrainProvider = baseTerrain;
    }

    for (const layer of ordered) {
      const fp = fingerprint(layer, atMs);
      const existing = mounted.get(layer.id);
      if (existing && existing.fingerprint !== fp) unmount(layer.id);
      const isTerrain = layer.format === 'quantized-mesh';
      if (isTerrain) {
        // A terrain layer is only "mounted" while it owns the surface.
        if (terrainLayer?.id === layer.id && terrainOwner !== layer.id) {
          terrainOwner = layer.id;
          mount(layer, atMs, fp);
        }
        continue;
      }
      if (!mounted.has(layer.id)) mount(layer, atMs, fp);
    }

    // Cheap per-frame properties. `sync` runs on every clock tick as well as on
    // every stack edit, so each of these is compared before it is assigned:
    // Cesium fires change events and requests a render for a *set*, not for a
    // change, and a 4D app with a running clock would otherwise re-sort the
    // imagery collection sixty times a second to arrive at the same order.
    let changed = sceneChanged;
    sceneChanged = false;
    for (const layer of ordered) {
      const m = mounted.get(layer.id);
      if (!m) continue;
      const shown = layer.visible && isAvailableAt(layer, atMs);
      if (m.imagery) {
        if (m.imagery.show !== shown) { m.imagery.show = shown; changed = true; }
        if (m.imagery.alpha !== layer.opacity) { m.imagery.alpha = layer.opacity; changed = true; }
      }
      if (m.dataSource && m.dataSource.show !== shown) { m.dataSource.show = shown; changed = true; }
      if (m.tileset) {
        if (m.tileset.show !== shown) { m.tileset.show = shown; changed = true; }
        applyTilesetAppearance(m.tileset, layer);
      }
    }

    // Ordering, only when the collection is actually out of order. Raising each
    // in turn is the one primitive `ImageryLayerCollection` offers that does not
    // disturb the basemap sitting at index 0 — but it is a remove-and-insert
    // each time, so it is worth knowing whether it is needed.
    const ours = ordered
      .map((l) => mounted.get(l.id)?.imagery)
      .filter((i): i is Cesium.ImageryLayer => Boolean(i));
    const indices = ours.map((i) => viewer.imageryLayers.indexOf(i));
    // A layer that is no longer in the collection was removed by something else
    // — most likely a basemap swap that has not yet learned to skip ours (see
    // `isAtlasManagedImagery`). Forget it rather than raising a layer Cesium
    // does not hold, which throws; the next `sync` mounts it again.
    if (indices.some((i) => i < 0)) {
      for (const [id, m] of mounted) {
        if (m.imagery && viewer.imageryLayers.indexOf(m.imagery) < 0) mounted.delete(id);
      }
      viewer.scene.requestRender();
      return;
    }
    const inOrder = indices.every((v, i) => i === 0 || v > indices[i - 1]!)
      // …and all of ours above everything we do not own, or a basemap added
      // after them would cover the stack.
      && indices[0]! === viewer.imageryLayers.length - ours.length;
    if (ours.length && !inOrder) {
      for (const imagery of ours) viewer.imageryLayers.raiseToTop(imagery);
      changed = true;
    }

    // Property sets on Cesium objects are invisible to a paused render loop;
    // the viewer only redraws when something asks it to.
    if (changed) nudge();
  };

  return {
    sync,
    destroy() {
      for (const id of [...mounted.keys()]) unmount(id);
      destroyed = true;
    },
  };
}

async function loadDataSource(layer: AtlasLayer, viewer: Cesium.Viewer): Promise<Cesium.DataSource> {
  switch (layer.format) {
    case 'kml':
      // KML's screen overlays and `LookAt` need the camera and canvas to
      // resolve against; without them Cesium throws rather than degrading.
      return Cesium.KmlDataSource.load(layer.url, {
        camera: viewer.scene.camera,
        canvas: viewer.scene.canvas,
        clampToGround: layer.options?.clampToGround !== false,
      });
    case 'czml':
      return Cesium.CzmlDataSource.load(layer.url);
    default:
      return Cesium.GeoJsonDataSource.load(layer.url, {
        clampToGround: layer.options?.clampToGround === true,
      });
  }
}

/** Colour + opacity for a vector layer, re-applied whenever either changes. */
function applyVectorAppearance(ds: Cesium.DataSource, layer: AtlasLayer): void {
  const colour = resolveColour(layer.options?.colour, Cesium.Color.fromCssColorString('#72ddd4'));
  for (const entity of ds.entities.values) {
    if (entity.point && layer.options?.colour) entity.point.color = new Cesium.ConstantProperty(colour);
    if (entity.billboard && layer.options?.colour) entity.billboard.color = new Cesium.ConstantProperty(colour);
  }
  if (layer.opacity < 1) applyDataSourceAlpha(ds, layer.opacity);
}

/** Opacity for a tileset. Only set when it is actually asked for: a style
 *  overrides whatever the tileset author baked in, so a full-opacity layer must
 *  leave the authored appearance alone. */
function applyTilesetAppearance(tileset: Cesium.Cesium3DTileset, layer: AtlasLayer): void {
  if (layer.opacity >= 1) {
    if (tileset.style) tileset.style = undefined;
    return;
  }
  tileset.style = new Cesium.Cesium3DTileStyle({
    color: `color('#ffffff', ${layer.opacity.toFixed(3)})`,
  });
}
