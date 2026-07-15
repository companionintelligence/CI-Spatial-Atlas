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
import type { Item, Story, TimeSpec, TrackSample } from './schema.js';
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
  return new Date(d).toISOString();
}

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

export function storyToCzml(story: Story): CzmlResult {
  const bounds = timelineBounds(story);
  const docInterval = `${iso(bounds.start)}/${iso(bounds.stop)}`;

  const documentPacket: CzmlPacket = {
    id: 'document',
    name: story.title,
    version: '1.0',
    clock: {
      interval: docInterval,
      currentTime: iso(story.timeline?.current ?? bounds.start),
      multiplier: story.timeline?.multiplier ?? 3600,
      range: story.timeline?.loop === false ? 'CLAMPED' : 'LOOP_STOP',
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
        czml.push({
          id: item.id,
          name: item.title ?? item.id,
          description: mediaCardHtml(item),
          availability: availability(item.time, docInterval),
          position: { cartographicDegrees: [pos.lon, pos.lat, pos.height ?? 0] },
          billboard: {
            image: item.type === 'photo' ? item.media.thumbnailUrl ?? item.media.url : item.media.posterUrl ?? item.media.thumbnailUrl,
            scale: 0.5,
            verticalOrigin: 'BOTTOM',
          },
        });
        // A 2D capture may carry a linked reconstruction.
        if (item.type !== 'video' && item.derived3d) {
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
        const first = iso(item.path[0].time);
        const last = iso(item.path[item.path.length - 1].time);
        czml.push({
          id: item.id,
          name: item.title ?? item.id,
          availability: `${first}/${last}`,
          position: { epoch: first, cartographicDegrees: relativeSamples(item.path) },
          path: { material: { solidColor: { color: cssToRgba(item.color ?? '#39c0ff') } }, width: 3, leadTime: 0 },
          point: { pixelSize: 8, color: cssToRgba(item.color ?? '#39c0ff') },
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

  return { czml, tilesets };
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

function mediaCardHtml(item: Extract<Item, { type: 'photo' | 'video' }>): string {
  const src = item.type === 'photo' ? item.media.url : item.media.posterUrl ?? item.media.url;
  const cap = item.description ?? item.title ?? '';
  return `<div class="atlas-card"><img src="${src}" style="max-width:320px"/><p>${cap}</p></div>`;
}

/** "#rrggbb" → CZML rgba [r,g,b,a] (0-255). */
function cssToRgba(hex: string): { rgba: [number, number, number, number] } {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { rgba: [Number.isNaN(r) ? 255 : r, Number.isNaN(g) ? 64 : g, Number.isNaN(b) ? 64 : b, 255] };
}
