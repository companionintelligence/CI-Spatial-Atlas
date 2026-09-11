/**
 * @companion-atlas/story — the canonical 4D Story schema for Companion Atlas.
 *
 * Consolidates the two prior data models (Companion-Atlas `Story`, CI-Earth-2
 * `Scrapbook`) into one Zod-sourced schema, with normalizers that load either
 * legacy shape and a CZML converter for CesiumJS timeline playback, plus
 * GeoJSON/KML import and KML export — all of which land in (or start from) the
 * canonical model rather than any one renderer's entities.
 */
export * from './schema.js';
export * from './normalize.js';
export * from './czml.js';
export * from './geojson.js';
export * from './kml.js';
export * from './kml-export.js';
export * from './validate.js';
export * from './memory.js';
export * from './places.js';
export * from './scrapbook.js';
export type {
  LegacyScrapbook,
  LegacyAtlasStory,
  LegacyCamera,
  LegacyScrapbookScene,
  StoryFormat,
} from './legacy.js';
