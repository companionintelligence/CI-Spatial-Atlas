/**
 * Canonical `Story` → CZML converter (ported and generalized from CI-Earth-2's
 * `packages/scrapbook/src/czml.ts`).
 *
 * CZML is CesiumJS's native time-dynamic format, so this gives the Cesium viewer
 * a real 4D timeline (clock + per-entity `availability`) for free — closing the
 * "4D isn't actually wired" gap that both prior builds had.
 *
 * Gaussian splats and 3D Tiles are NOT expressible in CZML; they are returned
 * separately in `tilesets` for the viewer to add as `Cesium3DTileset`s.
 */
import type { GeoPath, Item, Story, TimeSpec, TrackSample } from './schema.js';
import { storyEntities, timelineBounds } from './normalize.js';

export interface CzmlPacket {
  id: string;
  name?: string;
  description?: string;
  availability?: string;
  position?: unknown;
  point?: unknown;
  billboard?: unknown;
  label?: unknown;
  path?: unknown;
  polyline?: unknown;
  polygon?: unknown;
  model?: unknown;
  [k: string]: unknown;
}

export interface TilesetRef {
  id: string;
  url: string;
  kind: '3d-tiles' | 'gaussian-splat';
  position?: { lon: number; lat: number; height?: number };
  availability?: string;
}

export interface CzmlResult {
  /** CZML document array (first packet is the `document`/clock packet). */
  czml: CzmlPacket[];
  /** 3D Tiles / splat tilesets to add to the scene outside CZML. */
  tilesets: TilesetRef[];
}

function iso(d: string): string {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toISOString();
}

/** Cesium's billboard can only load real (http/data) images. A non-loadable URI
 *  (e.g. `ci-memory://…` before it's resolved) must NOT be set as a billboard
 *  image — Cesium's fetchImage rejects the scheme and logs a console error. */
const isLoadableImage = (u: string | undefined): u is string => !!u && /^(https?:|data:|blob:)/i.test(u);

/** A TimeSpec → CZML availability interval, defaulting to the doc interval. */
function availability(time: TimeSpec | undefined, docInterval: string): string {
  if (!time) return docInterval;
  const docStop = docInterval.split('/')[1];
  if (typeof time === 'string') return `${iso(time)}/${docStop ?? iso(time)}`;
  if (time.at) return `${iso(time.at)}/${docStop ?? iso(time.at)}`;
  if (time.start && (time.end || time.stop)) return `${iso(time.start)}/${iso((time.end ?? time.stop) as string)}`;
  if (time.start) return `${iso(time.start)}/${docStop ?? iso(time.start)}`;
  return docInterval;
}

/** A journey should take roughly this long to play back, whatever its real span:
 *  a fixed multiplier blows a 70-minute trip past in seconds and makes a decade
 *  crawl. Authored `timeline.multiplier` still wins. */
const PLAYBACK_SECONDS = 45;

function pacedMultiplier(startIso: string, stopIso: string): number {
  const spanSec = (Date.parse(stopIso) - Date.parse(startIso)) / 1000;
  if (!Number.isFinite(spanSec) || spanSec <= 0) return 1;
  return Math.max(1, spanSec / PLAYBACK_SECONDS);
}

export function storyToCzml(story: Story): CzmlResult {
  const bounds = timelineBounds(story);
  const docInterval = `${iso(bounds.start)}/${iso(bounds.stop)}`;

  // NOTE: Cesium copies this document clock onto the viewer *every time* the
  // data source loads (trackDataSourceClock), so the pacing and range have to
  // live here. Patching `viewer.clock` after mount silently reverts on the next
  // story swap — which is what made curated journeys loop forever at 600x.
  const documentPacket: CzmlPacket = {
    id: 'document',
    name: story.title,
    version: '1.0',
    clock: {
      interval: docInterval,
      currentTime: iso(story.timeline?.current ?? bounds.start),
      multiplier: story.timeline?.multiplier ?? pacedMultiplier(bounds.start, bounds.stop),
      // Play the journey once and stop; only loop when the story asks to.
      range: story.timeline?.loop === true ? 'LOOP_STOP' : 'CLAMPED',
      step: 'SYSTEM_CLOCK_MULTIPLIER',
    },
  };

  const czml: CzmlPacket[] = [documentPacket];
  const tilesets: TilesetRef[] = [];

  for (const item of storyEntities(story)) {
    switch (item.type) {
      case 'photo':
      case 'video': {
        const pos = item.position;
        const img = item.type === 'photo' ? item.media.thumbnailUrl ?? item.media.url : item.media.posterUrl ?? item.media.thumbnailUrl;
        czml.push({
          id: item.id,
          name: item.title ?? item.id,
          description: mediaCardHtml(item),
          availability: availability(item.time, docInterval),
          position: { cartographicDegrees: [pos.lon, pos.lat, pos.height ?? 0] },
          // A billboard needs a *loadable* image; otherwise place a point so an
          // unresolved URI (ci-memory://…) doesn't trigger a fetch error.
          ...(isLoadableImage(img)
            ? { billboard: { image: img, scale: 0.5, verticalOrigin: 'BOTTOM' } }
            : { point: { pixelSize: 10, color: cssToRgba('#39c0ff') } }),
        });
        // Either a photo or a video may carry a linked reconstruction.
        if (item.derived3d) {
          tilesets.push({
            id: `${item.id}#derived`,
            url: item.derived3d.uri,
            kind: item.derived3d.kind === 'gaussian-splat' ? 'gaussian-splat' : '3d-tiles',
            position: pos,
            availability: availability(item.time, docInterval),
          });
        }
        break;
      }
      case 'marker': {
        czml.push({
          id: item.id,
          name: item.title ?? item.id,
          description: item.description,
          availability: availability(item.time, docInterval),
          position: { cartographicDegrees: [item.position.lon, item.position.lat, item.position.height ?? 0] },
          point: { pixelSize: 12, color: cssToRgba(item.color ?? '#ff4444') },
        });
        break;
      }
      case 'note': {
        czml.push({
          id: item.id,
          name: item.title ?? item.id,
          availability: availability(item.time, docInterval),
          position: { cartographicDegrees: [item.position.lon, item.position.lat, item.position.height ?? 0] },
          label: { text: item.text, font: '14px sans-serif', showBackground: true },
        });
        break;
      }
      case 'track': {
        // Don't trust input order; sort a copy by time before sampling.
        const path = [...item.path].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
        const first = iso(path[0]!.time);
        // A single-sample track has no span — extend availability to the doc stop
        // so the entity stays visible instead of flashing for zero seconds.
        const last = path.length > 1 ? iso(path[path.length - 1]!.time) : iso(bounds.stop);
        czml.push({
          id: item.id,
          name: item.title ?? item.id,
          availability: `${first}/${last}`,
          position: { epoch: first, cartographicDegrees: relativeSamples(path) },
          path: { material: { solidColor: { color: cssToRgba(item.color ?? '#39c0ff') } }, width: 3, leadTime: 0 },
          point: { pixelSize: 8, color: cssToRgba(item.color ?? '#39c0ff') },
        });
        break;
      }
      case 'line': {
        // A polyline's vertices live in `polyline.positions`, NOT the packet's
        // top-level `position` — set the latter and Cesium draws nothing while
        // reporting no error, because the polyline graphic simply has no
        // hierarchy to build from.
        const clamp = item.clampToGround ?? !hasHeights(item.positions);
        czml.push({
          id: item.id,
          name: item.title ?? item.id,
          description: item.description,
          availability: availability(item.time, docInterval),
          polyline: {
            positions: { cartographicDegrees: flatDegrees(item.positions) },
            material: { solidColor: { color: cssToRgba(item.color ?? '#39c0ff') } },
            width: item.width ?? 3,
            // `clampToGround` needs a ground-primitive path, which only works
            // with GEODESIC arcs; RHUMB silently ignores the draping.
            clampToGround: clamp,
            arcType: 'GEODESIC',
          },
        });
        break;
      }
      case 'polygon': {
        const clamp = item.clampToGround ?? !hasHeights(item.positions);
        // fillOpacity 0 is a real, load-bearing value (KML `<fill>0</fill>`,
        // simplestyle `"fill-opacity": 0`) meaning outline-only, so `??` — not
        // `||` — is what decides the default.
        const fillOpacity = item.fillOpacity ?? 0.5;
        const outlineWidth = item.outlineWidth ?? 1;
        czml.push({
          id: item.id,
          name: item.title ?? item.id,
          description: item.description,
          availability: availability(item.time, docInterval),
          polygon: {
            positions: { cartographicDegrees: flatDegrees(item.positions) },
            ...(item.holes?.length ? { holes: { cartographicDegrees: item.holes.map(flatDegrees) } } : {}),
            fill: fillOpacity > 0,
            material: { solidColor: { color: cssToRgba(item.fillColor ?? '#39c0ff', fillOpacity) } },
            outline: outlineWidth > 0,
            outlineColor: cssToRgba(item.outlineColor ?? item.fillColor ?? '#ffffff'),
            outlineWidth,
            // Cesium only drapes a polygon onto terrain when it is NOT told to
            // honour per-vertex heights. Leaving this true on a 2D import pins
            // every vertex to h=0 and the shape vanishes inside any hill.
            perPositionHeight: !clamp,
            arcType: 'GEODESIC',
          },
        });
        break;
      }
      case 'model': {
        czml.push({
          id: item.id,
          name: item.title ?? item.id,
          availability: availability(item.time, docInterval),
          position: { cartographicDegrees: [item.position.lon, item.position.lat, item.position.height ?? 0] },
          model: { gltf: item.gltf, scale: item.scale ?? 1 },
        });
        break;
      }
      case 'splat':
      case 'tileset': {
        const url = item.type === 'splat' ? item.tileset ?? item.splatUrl : item.tileset;
        if (url) {
          tilesets.push({
            id: item.id,
            url,
            kind: item.type === 'splat' ? 'gaussian-splat' : '3d-tiles',
            position: item.position,
            availability: item.time ? availability(item.time, docInterval) : undefined,
          });
        }
        break;
      }
    }
  }

  // Global renderable layers → tilesets too.
  for (const layer of story.layers ?? []) {
    if ((layer.kind === '3d-tiles' || layer.kind === 'gaussian-splat') && layer.uri) {
      const av = layer.availability;
      tilesets.push({
        id: layer.id,
        url: layer.uri,
        kind: layer.kind === 'gaussian-splat' ? 'gaussian-splat' : '3d-tiles',
        availability: av ? `${iso(av.start)}/${iso((av.stop ?? av.end ?? bounds.stop) as string)}` : undefined,
      });
    }
  }

  // Deduplicate tilesets by URL: a media reconstruction and an authored layer can
  // point at the same tileset.json/.splat — loading it twice causes z-fighting and
  // doubled VRAM. Keep the first occurrence.
  const seenUrls = new Set<string>();
  const dedupedTilesets = tilesets.filter((t) => (seenUrls.has(t.url) ? false : (seenUrls.add(t.url), true)));

  return { czml, tilesets: dedupedTilesets };
}

/** CZML sampled positions are [secondsFromEpoch, lon, lat, height, …]. */
function relativeSamples(path: TrackSample[]): number[] {
  const epoch = new Date(path[0].time).getTime();
  const out: number[] = [];
  for (const s of path) {
    out.push((new Date(s.time).getTime() - epoch) / 1000, s.lon, s.lat, s.height ?? 0);
  }
  return out;
}

/** A ring/path → the flat `[lon, lat, height, …]` CZML position list. */
function flatDegrees(path: GeoPath): number[] {
  const out: number[] = [];
  for (const p of path) out.push(p.lon, p.lat, p.height ?? 0);
  return out;
}

/** Did the author actually supply elevations, or is this a 2D import? Drives the
 *  clamp-to-terrain default for `line`/`polygon`. */
function hasHeights(path: GeoPath): boolean {
  return path.some((p) => p.height != null && p.height !== 0);
}

function mediaCardHtml(item: Extract<Item, { type: 'photo' | 'video' }>): string {
  const src = item.type === 'photo' ? item.media.url : item.media.posterUrl ?? item.media.url;
  const cap = item.description ?? item.title ?? '';
  return `<div class="atlas-card"><img src="${src}" style="max-width:320px"/><p>${cap}</p></div>`;
}

/**
 * "#rgb" / "#rrggbb" / "#rrggbbaa" → CZML rgba [r,g,b,a] (0-255).
 *
 * `alpha` (0..1) overrides any alpha carried by the string. That split exists
 * because the two importers disagree about where opacity lives: simplestyle
 * keeps `fill` and `fill-opacity` in separate properties, while KML packs it
 * into the colour's leading byte. Both end up here.
 *
 * Exported because the KML serialiser needs the same permissive parse to build
 * `aabbggrr` — two colour parsers would drift.
 */
export function cssToRgba(hex: string, alpha?: number): { rgba: [number, number, number, number] } {
  let h = hex.replace('#', '').trim();
  // "#f0c" is a legal CSS shorthand and shows up in hand-written GeoJSON.
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const embedded = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : NaN;
  const a = alpha != null ? Math.round(clamp01(alpha) * 255) : Number.isNaN(embedded) ? 255 : embedded;
  return { rgba: [Number.isNaN(r) ? 255 : r, Number.isNaN(g) ? 64 : g, Number.isNaN(b) ? 64 : b, a] };
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
