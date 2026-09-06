/**
 * Runtime (Zod) mirror of the Companion Atlas story schema.
 *
 * The viewer-facing TypeScript types live in `src/atlas/schema.ts`. This file
 * is the server-side runtime-validated copy used by the REST API and MCP tools.
 * In a monorepo both would be generated from / import one shared package; they
 * are kept structurally identical here.
 */

import { z } from 'zod';

export const Iso8601 = z.string().describe('ISO-8601 timestamp, e.g. 2026-03-14T09:00:00Z');

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  height: z.number().optional().describe('metres above the WGS84 ellipsoid')
});

export const TimeInterval = z.object({ start: Iso8601, stop: Iso8601 });

export const MediaKind = z.enum([
  'image',
  'image-set',
  'video',
  'pano360',
  'gaussian-splat',
  'model3d',
  'pointcloud',
  'audio'
]);

export const Derived3d = z.object({
  kind: z.enum(['3d-tiles', 'gaussian-splat', 'gltf', 'pointcloud']),
  uri: z.string(),
  job: z.string().optional()
});

export const MediaItem = z.object({
  id: z.string(),
  kind: MediaKind,
  uri: z.string(),
  thumbnailUri: z.string().optional(),
  caption: z.string().optional(),
  capturedAt: Iso8601.optional(),
  location: GeoPoint.optional(),
  heading: z.number().optional(),
  exif: z.record(z.unknown()).optional(),
  derived3d: Derived3d.optional(),
  sourceMemoryId: z.string().optional()
});

/**
 * Licence-required credit for a layer's source. Not presentation polish: most
 * open sources a layer can point at are attribution-conditioned (OSM/ODbL,
 * EOX and CARTO/CC BY, OpenSeaMap/CC BY-SA), so this has to survive a write
 * through the API. A `z.object` strips unknown keys, so a credit that is not
 * declared here is a credit this server silently deletes.
 */
export const LayerAttribution = z.object({
  text: z.string().describe('credit line to display, e.g. "© OpenStreetMap contributors"'),
  licence: z.string().optional().describe('licence name or id, e.g. ODbL-1.0, CC BY 4.0'),
  url: z.string().optional().describe("link to the source's page or the licence deed"),
  onScreen: z
    .boolean()
    .optional()
    .describe('licence requires the notice on the map itself, not behind a control')
});

/** Wire format of a layer's `uri`. `kind` cannot stand in for it: 'imagery'
 *  spans xyz/tms/wmts/wms, and 'geojson' is also where kml and czml land. */
export const LayerFormat = z.enum([
  'xyz',
  'tms',
  'wmts',
  'wms',
  'geojson',
  'kml',
  'czml',
  '3d-tiles',
  'gaussian-splat',
  'quantized-mesh'
]);

export const Layer = z.object({
  id: z.string(),
  kind: z.enum(['imagery', 'terrain', '3d-tiles', 'gaussian-splat', 'geojson', 'model', 'pin']),
  name: z.string().optional().describe('human label for a layer list'),
  uri: z.string().optional(),
  format: LayerFormat.optional(),
  attribution: LayerAttribution.optional(),
  style: z.record(z.unknown()).optional(),
  availability: TimeInterval.optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional().describe('drawn state; absent means visible'),
  order: z.number().optional().describe('draw order, low to high; absent means array position')
});

export const CameraPose = z.object({
  location: GeoPoint,
  heading: z.number().optional(),
  pitch: z.number().optional(),
  range: z.number().optional()
});

export const Scene = z.object({
  id: z.string(),
  title: z.string(),
  narrative: z.string().optional(),
  time: z.union([Iso8601, TimeInterval]).optional(),
  camera: CameraPose.optional(),
  mediaIds: z.array(z.string()).optional(),
  layerIds: z.array(z.string()).optional(),
  transition: z.object({ kind: z.enum(['fly', 'cut']), durationMs: z.number().optional() }).optional()
});

export const Timeline = z.object({
  start: Iso8601,
  stop: Iso8601,
  current: Iso8601.optional(),
  multiplier: z.number().optional(),
  loop: z.boolean().optional()
});

export const Basemap = z.object({
  imagery: z.string().optional(),
  terrain: z.boolean().optional(),
  provider: z.string().optional()
});

export const Visibility = z.enum(['private', 'unlisted', 'public']);

export const Story = z.object({
  schema: z.literal('companion.atlas/story@1'),
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  createdAt: Iso8601,
  updatedAt: Iso8601.optional(),
  basemap: Basemap.optional(),
  timeline: Timeline.optional(),
  media: z.array(MediaItem),
  layers: z.array(Layer).optional(),
  scenes: z.array(Scene),
  access: z.object({ visibility: Visibility, oidcSubject: z.string().optional() }).optional(),
  provenance: z
    .object({ source: z.string().optional(), memoryQuery: z.string().optional(), agent: z.string().optional() })
    .optional()
});

export type Story = z.infer<typeof Story>;
export type Scene = z.infer<typeof Scene>;
export type MediaItem = z.infer<typeof MediaItem>;
export type Layer = z.infer<typeof Layer>;
export type LayerAttribution = z.infer<typeof LayerAttribution>;
export type LayerFormat = z.infer<typeof LayerFormat>;
export type Derived3d = z.infer<typeof Derived3d>;

export const STORY_SCHEMA_ID = 'companion.atlas/story@1' as const;
