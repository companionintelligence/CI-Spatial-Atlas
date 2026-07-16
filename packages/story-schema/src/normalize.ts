/**
 * Consolidation layer: detect a legacy document's shape and normalize it into
 * the canonical `Story`. This is what makes "one repo, one schema" real —
 * historical Atlas `Story` docs AND CI-Earth-2 `Scrapbook` docs both load here.
 *
 * Dependency-free apart from the canonical Zod schema (used for the final parse).
 */
import { Story, STORY_SCHEMA_ID } from './schema.js';
import type { Camera, Item, MediaItem, Scene, Story as StoryT } from './schema.js';
import type { LegacyScrapbook, StoryFormat } from './legacy.js';

/** Which of the historical shapes is this document? */
export function detectFormat(doc: unknown): StoryFormat {
  if (typeof doc !== 'object' || doc === null) return 'unknown';
  const d = doc as Record<string, unknown>;
  if (d.schema === STORY_SCHEMA_ID) {
    // Canonical if it already carries typed `items`; otherwise a legacy Atlas
    // `Story` that leads with `media` (both validate as canonical — the split is
    // informational only).
    return Array.isArray(d.items) ? 'canonical' : 'atlas';
  }
  if (typeof d.version === 'string' && Array.isArray(d.items)) return 'scrapbook';
  return 'unknown';
}

/** Parse any time spec down to epoch ms (for sorting / clock math). */
export function resolveInstant(time: unknown): number {
  if (!time) return Number.POSITIVE_INFINITY;
  const iso =
    typeof time === 'string'
      ? time
      : (time as { at?: string; start?: string }).at ?? (time as { start?: string }).start;
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** Resolve a story's clock bounds. Uses `timeline` when present (accepting
 *  `stop` or legacy `end`); otherwise derives the window from scene + entity
 *  times so legacy Atlas stories that omit `timeline` still get a clock. */
export function timelineBounds(story: StoryT): { start: string; stop: string } {
  const tl = story.timeline;
  if (tl) return { start: tl.start, stop: tl.stop ?? tl.end ?? tl.start };

  const times: number[] = [];
  for (const e of storyEntities(story)) {
    if (e.type === 'track') for (const s of e.path) times.push(Date.parse(s.time));
    else if (e.time) times.push(resolveInstant(e.time));
  }
  for (const sc of story.scenes) if (sc.time) times.push(resolveInstant(sc.time));
  const finite = times.filter((t) => Number.isFinite(t));
  if (finite.length) {
    return { start: new Date(Math.min(...finite)).toISOString(), stop: new Date(Math.max(...finite)).toISOString() };
  }
  const fallback = story.createdAt ?? story.updatedAt ?? new Date(0).toISOString();
  return { start: fallback, stop: fallback };
}

/** Collapse either camera form into one carrying `location`. */
export function normalizeCamera(c: unknown): Camera | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const raw = c as Record<string, number | undefined> & { location?: { lat: number; lon: number; height?: number } };
  const location =
    raw.location ?? (raw.lon != null && raw.lat != null ? { lat: raw.lat, lon: raw.lon, height: raw.height } : undefined);
  if (!location) return undefined;
  return {
    location,
    heading: raw.heading,
    pitch: raw.pitch,
    roll: raw.roll,
    range: raw.range,
    durationMs: raw.durationMs,
  };
}

/** CI-Earth-2 `Scrapbook` → canonical `Story` (unvalidated object). */
export function fromScrapbook(sb: LegacyScrapbook): Record<string, unknown> {
  const clock = sb.timeline.clock ?? {};
  const scenes = (sb.scenes ?? []).map((sc): Record<string, unknown> => ({
    id: sc.id,
    title: sc.title,
    narrative: sc.caption,
    time: sc.time,
    camera: normalizeCamera(sc.camera),
    itemIds: sc.items,
    transition: sc.transition ? { kind: sc.transition.type, durationMs: sc.transition.durationMs } : undefined,
    layout: sc.layout,
    audioUrl: sc.audioUrl,
  }));
  return {
    schema: STORY_SCHEMA_ID,
    id: sb.id,
    title: sb.title,
    description: sb.description,
    author: sb.author,
    createdAt: sb.createdAt,
    updatedAt: sb.updatedAt,
    visibility: sb.visibility,
    cover: sb.cover,
    timeline: {
      start: sb.timeline.start,
      stop: sb.timeline.end,
      current: clock.currentTime,
      multiplier: clock.multiplier,
      loop: clock.loop,
    },
    view: sb.view
      ? { camera: normalizeCamera(sb.view.camera), basemap: sb.view.basemap, terrain: sb.view.terrain }
      : undefined,
    items: sb.items,
    scenes,
    // Spread to preserve any extra provenance keys (the model is passthrough on
    // both sides) — not just the four well-known ones.
    provenance: sb.source ? { ...sb.source } : undefined,
  };
}

/** Read a scene's narration regardless of legacy spelling (`narrative`/`caption`). */
export function sceneNarrative(scene: Scene): string | undefined {
  return scene.narrative ?? scene.caption;
}

/** Read a scene's highlighted entity ids regardless of legacy spelling. */
export function sceneHighlightIds(scene: Scene): string[] {
  return scene.itemIds ?? scene.items ?? scene.mediaIds ?? [];
}

/** Keep the two legacy visibility spellings in sync so consumers can read either. */
function reconcileVisibility(s: StoryT): void {
  const v = s.visibility ?? s.access?.visibility;
  if (!v) return;
  if (!s.visibility) s.visibility = v;
  if (!s.access) s.access = { visibility: v };
}

/** Detect the format, normalize, and validate. Throws on an invalid document. */
export function loadStory(doc: unknown): StoryT {
  const fmt = detectFormat(doc);
  let candidate: unknown;
  switch (fmt) {
    case 'scrapbook':
      candidate = fromScrapbook(doc as LegacyScrapbook);
      break;
    case 'canonical':
    case 'atlas':
      candidate = doc; // already canonical-compatible
      break;
    default:
      throw new Error('Unrecognized document: not a Companion Atlas Story or CI-Earth-2 Scrapbook');
  }
  const parsed = Story.safeParse(candidate);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '/'}: ${i.message}`).join('; ');
    throw new Error(`Invalid story (${fmt}): ${msg}`);
  }
  reconcileVisibility(parsed.data);
  return parsed.data;
}

/** Map an Atlas `MediaItem` to the renderable entity list (source + any
 *  reconstruction). Media without a location can't be placed and are skipped. */
export function mediaToEntities(m: MediaItem): Item[] {
  if (!m.location) return [];
  const time = m.capturedAt ? { at: m.capturedAt } : undefined;
  const source = m.sourceMemoryId ? { kind: 'ci-memory' as const, memoryId: m.sourceMemoryId } : undefined;
  const out: Item[] = [];

  if (m.kind === 'video') {
    out.push({ id: m.id, type: 'video', position: m.location, time, source, title: m.caption, description: m.description, media: { url: m.uri, posterUrl: m.thumbnailUri, thumbnailUrl: m.thumbnailUri } });
  } else if (m.kind === 'gaussian-splat') {
    out.push({ id: m.id, type: 'splat', position: m.location, time, source, tileset: m.derived3d?.uri ?? m.uri });
  } else if (m.kind === 'pointcloud') {
    out.push({ id: m.id, type: 'tileset', position: m.location, time, source, tileset: m.derived3d?.uri ?? m.uri });
  } else if (m.kind === 'model3d') {
    out.push({ id: m.id, type: 'model', position: m.location, time, source, gltf: m.derived3d?.uri ?? m.uri });
  } else if (m.kind === 'audio') {
    // Preserve the audio uri on the projected entity so a renderer can reach it.
    out.push({ id: m.id, type: 'marker', position: m.location, time, source, title: m.caption, description: m.uri });
  } else {
    // image | image-set | pano360 → photo. Its reconstruction (if any) is
    // emitted below as a distinct entity, so it is NOT attached inline here
    // (attaching it too would double-count in the CZML converter).
    out.push({ id: m.id, type: 'photo', position: m.location, time, source, title: m.caption, description: m.description, heading: m.heading, media: { url: m.uri, thumbnailUrl: m.thumbnailUri } });
  }

  // A reconstruction attached to a 2D capture (photo/video) becomes its own
  // renderable tileset/splat entity.
  if (m.derived3d && (m.kind === 'image' || m.kind === 'image-set' || m.kind === 'pano360' || m.kind === 'video')) {
    const type = m.derived3d.kind === 'gaussian-splat' ? 'splat' : 'tileset';
    out.push({ id: `${m.id}#derived`, type, position: m.location, time, tileset: m.derived3d.uri } as Item);
  }
  return out;
}

/** The full renderable entity list: typed `items` plus any `media` projected
 *  into entities. This is what the CZML converter and the globe renderers read. */
export function storyEntities(story: StoryT): Item[] {
  const fromItems = story.items ?? [];
  const fromMedia = (story.media ?? []).flatMap(mediaToEntities);
  return [...fromItems, ...fromMedia];
}
