/**
 * Legacy input shapes accepted by the normalizers in `./normalize`.
 *
 * These describe the two historical documents this package consolidates. They
 * are intentionally hand-written (not inferred) because they describe EXTERNAL
 * data we must read, not the canonical model we produce. Kept dependency-free.
 */

/** ---- CI-Earth-2 `Scrapbook` (packages/scrapbook) ---- */

export interface LegacyPosition {
  lon: number;
  lat: number;
  height?: number;
}

export type LegacyTimeRef = { at: string } | { start: string; end: string };

export interface LegacyCamera {
  lon: number;
  lat: number;
  height?: number;
  heading?: number;
  pitch?: number;
  roll?: number;
  durationMs?: number;
}

export interface LegacyScrapbookScene {
  id: string;
  title?: string;
  caption?: string;
  camera?: LegacyCamera;
  time?: LegacyTimeRef;
  items?: string[];
  transition?: { type?: 'flyTo' | 'cut'; durationMs?: number };
  audioUrl?: string;
  layout?: string;
}

export interface LegacyScrapbook {
  version: string;
  id: string;
  title: string;
  description?: string;
  author?: { id?: string; name?: string; avatarUrl?: string };
  createdAt?: string;
  updatedAt?: string;
  visibility?: 'private' | 'unlisted' | 'public';
  cover?: string;
  timeline: {
    start: string;
    end: string;
    clock?: { currentTime?: string; multiplier?: number; loop?: boolean };
  };
  view?: { camera?: LegacyCamera; basemap?: string; terrain?: string };
  /** Earth-2 items already match the canonical `Item` union shape. */
  items: Array<Record<string, unknown>>;
  scenes: LegacyScrapbookScene[];
  source?: { kind?: string; memoryId?: string; query?: string; importedAt?: string; [k: string]: unknown };
}

/** ---- Companion-Atlas `Story` (src/atlas/schema.ts) ---- */

export interface LegacyAtlasStory {
  schema: 'companion.atlas/story@1';
  id: string;
  title: string;
  /** Atlas stories are already canonical-compatible; this type documents the
   *  fields the normalizer relies on. All other fields pass through. */
  media?: unknown[];
  items?: unknown[];
  scenes: unknown[];
  timeline?: { start: string; stop?: string; end?: string };
  [k: string]: unknown;
}

export type StoryFormat = 'canonical' | 'atlas' | 'scrapbook' | 'unknown';
