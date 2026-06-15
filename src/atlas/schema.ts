/**
 * Companion Atlas — 4D spatial story schema (canonical, viewer-facing types).
 *
 * A `Story` is a spatio-temporal document: media + layers pinned to WGS84
 * coordinates and tagged with time, sequenced into narrative `Scene`s and
 * driven by a `Timeline`. This is the "4D" (3D space + time) unit that the
 * processing server produces and the web viewer renders.
 *
 * The schema is deliberately viewer-agnostic so the same document can be
 * rendered by:
 *   - CesiumJS  → maps onto CZML entities + Clock + 3D Tiles (recommended)
 *   - MapLibre + deck.gl → time-filtered layers + TripsLayer animation
 *   - the current three.js globe → scrapbook pins + auto-fly journeys
 *
 * The server mirrors these types as a Zod runtime schema in
 * `server/src/schema.ts`; in a monorepo both would import one shared package.
 */

/** ISO-8601 timestamp, e.g. "2026-03-14T09:00:00Z". */
export type Iso8601 = string;

/** WGS84 geographic point. `height` is metres above the ellipsoid. */
export interface GeoPoint {
  lat: number;
  lon: number;
  height?: number;
}

export interface TimeInterval {
  start: Iso8601;
  stop: Iso8601;
}

/** Kinds of source media a story can hold. */
export type MediaKind =
  | 'image'
  | 'image-set'
  | 'video'
  | 'pano360'
  | 'gaussian-splat'
  | 'model3d'
  | 'pointcloud'
  | 'audio';

/** A processed 3D asset produced by the reconstruction pipeline. */
export interface Derived3d {
  kind: '3d-tiles' | 'gaussian-splat' | 'gltf' | 'pointcloud';
  /** tileset.json, .splat/.ksplat, .glb, or .laz served from the object store. */
  uri: string;
  /** Reconstruction job that produced this asset. */
  job?: string;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  /** Original media (object store URL or `ci-memory://<id>`). */
  uri: string;
  thumbnailUri?: string;
  caption?: string;
  /** Capture time — the temporal axis of the 4D timeline. */
  capturedAt?: Iso8601;
  /** Where the media sits on the globe (from EXIF/GPS, telemetry, or manual). */
  location?: GeoPoint;
  /** Orientation in degrees (yaw), where known. */
  heading?: number;
  /** Raw extracted metadata (EXIF, GPMF telemetry, etc.). */
  exif?: Record<string, unknown>;
  /** Link to a 3D reconstruction of this media, if one was produced. */
  derived3d?: Derived3d;
  /** Provenance: the CI-Server memory this media came from. */
  sourceMemoryId?: string;
}

export type LayerKind =
  | 'imagery'
  | 'terrain'
  | '3d-tiles'
  | 'gaussian-splat'
  | 'geojson'
  | 'model'
  | 'pin';

export interface Layer {
  id: string;
  kind: LayerKind;
  uri?: string;
  style?: Record<string, unknown>;
  /** Clock window during which this layer is shown (omitted = always). */
  availability?: TimeInterval;
  opacity?: number;
}

/** Camera framing for a scene (target-relative orbit, viewer-agnostic). */
export interface CameraPose {
  /** Look-at target on the globe. */
  location: GeoPoint;
  /** Compass heading in degrees. */
  heading?: number;
  /** Pitch in degrees; negative looks down at the ground. */
  pitch?: number;
  /** Orbit distance from the target, in metres. */
  range?: number;
}

/** A scrapbook "page": one keyframe in the story's timeline. */
export interface Scene {
  id: string;
  title: string;
  /** Markdown narrative shown in the storytelling panel. */
  narrative?: string;
  /** When this scene happens — an instant or an interval. */
  time?: Iso8601 | TimeInterval;
  /** Where the camera flies for this scene. */
  camera?: CameraPose;
  /** Media surfaced on this page (ids into `Story.media`). */
  mediaIds?: string[];
  /** Layers enabled for this page (ids into `Story.layers`). */
  layerIds?: string[];
  transition?: { kind: 'fly' | 'cut'; durationMs?: number };
}

/** Playback clock for the whole story. */
export interface Timeline {
  start: Iso8601;
  stop: Iso8601;
  current?: Iso8601;
  /** Playback speed multiplier (seconds of story per real second). */
  multiplier?: number;
  loop?: boolean;
}

export interface Basemap {
  imagery?: 'satellite' | 'osm' | 'local' | (string & {});
  terrain?: boolean;
  /** e.g. "cesium-ion", "google-3d-tiles", "maplibre", "three-local". */
  provider?: string;
}

export type Visibility = 'private' | 'unlisted' | 'public';

export interface Story {
  /** Schema discriminator + version. */
  schema: 'companion.atlas/story@1';
  id: string;
  title: string;
  description?: string;
  author?: string;
  createdAt: Iso8601;
  updatedAt?: Iso8601;
  basemap?: Basemap;
  timeline?: Timeline;
  media: MediaItem[];
  layers?: Layer[];
  scenes: Scene[];
  access?: { visibility: Visibility; oidcSubject?: string };
  /** How this story was created (memory query, agent, import). */
  provenance?: { source?: string; memoryQuery?: string; agent?: string };
}

export const STORY_SCHEMA_ID = 'companion.atlas/story@1' as const;

/** Narrow `unknown` to a `Story` with the minimal structural checks the
 *  viewer needs before rendering a fetched document. */
export function isStory(value: unknown): value is Story {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    s.schema === STORY_SCHEMA_ID &&
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    Array.isArray(s.scenes) &&
    Array.isArray(s.media)
  );
}

/** Resolve the time of a scene to a single sortable instant. */
export function sceneInstant(scene: Scene): number {
  const t = scene.time;
  if (!t) return Number.POSITIVE_INFINITY;
  const iso = typeof t === 'string' ? t : t.start;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}
