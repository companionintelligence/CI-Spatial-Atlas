import type { Layer } from '@companion-atlas/story';
import {
  clampOpacity,
  DEFAULT_OPACITY,
  isLayerFormat,
  layerKind,
  normaliseOrder,
  type AtlasLayer,
  type LayerAttribution,
  type LayerAvailability,
  type LayerFormat,
  type LayerOptions,
  type StoryLayerKind,
} from './model.js';
import { defaultOptionsFor, nameFromUrl, sniffLayerFormat } from './sniff.js';

/**
 * Round-tripping the layer stack through the canonical `Story` schema.
 *
 * A Story is the shareable artefact — the whole point of collecting layers is
 * that a story can carry them — so this file is the contract with
 * `@companion-atlas/story`. Two rules keep the two shapes from drifting apart:
 *
 *  1. **The schema is the schema.** We never write a top-level field it does
 *     not define. Zod's `z.object` strips unknown keys on parse, so anything we
 *     invented at the top level would survive in memory and vanish the moment a
 *     story made the round trip through the server — the worst kind of bug,
 *     because it only appears after a save.
 *  2. **Everything else lives in `style.atlas`.** `Layer.style` is a
 *     `z.record(z.unknown())` free-form bag, which is exactly where viewer-side
 *     presentation belongs. Namespacing under `atlas` leaves the rest of the
 *     bag free for renderer style hints an authoring tool may add.
 *
 * What a story genuinely cannot express, and is therefore lost to anything but
 * Atlas, is written down in the reader below rather than in a wiki nobody opens.
 */

/** The key inside `Layer.style` where the viewer's own fields live. */
const STYLE_NS = 'atlas';

/** Shape stored under `style.atlas`. Everything here is optional on the way in:
 *  a story authored by another tool will have none of it. */
interface AtlasStyleBag {
  name?: string;
  format?: LayerFormat;
  visible?: boolean;
  order?: number;
  attribution?: LayerAttribution;
  options?: LayerOptions;
  catalogId?: string;
}

/** Schema kind → the format to assume when the story does not say. Only used
 *  for layers Atlas did not author; ours carry the exact format in the bag. */
const FORMAT_FOR_KIND: Partial<Record<StoryLayerKind, LayerFormat>> = {
  imagery: 'xyz',
  terrain: 'quantized-mesh',
  geojson: 'geojson',
  '3d-tiles': '3d-tiles',
  'gaussian-splat': 'gaussian-splat',
  // `model` and `pin` are deliberately absent: they are single entities placed
  // at a coordinate, not sources with a URL and a stack position. `czml.ts`
  // already renders them from `items`, and the layer manager must not offer to
  // reorder or dim something it does not own.
};

/** Serialise one layer into the canonical schema shape. */
export function toStoryLayer(l: AtlasLayer): Layer {
  const bag: AtlasStyleBag = {
    name: l.name,
    format: l.format,
    visible: l.visible,
    order: l.order,
    ...(l.attribution ? { attribution: l.attribution } : {}),
    ...(l.options ? { options: l.options } : {}),
    ...(l.catalogId ? { catalogId: l.catalogId } : {}),
  };
  return {
    id: l.id,
    kind: layerKind(l.format),
    uri: l.url,
    opacity: l.opacity,
    ...(l.availability ? { availability: { start: l.availability.start, ...(l.availability.stop ? { stop: l.availability.stop } : {}) } } : {}),
    style: { [STYLE_NS]: bag as unknown as Record<string, unknown> },
  };
}

export const toStoryLayers = (layers: readonly AtlasLayer[]): Layer[] => layers.map(toStoryLayer);

/**
 * Read one story layer back.
 *
 * Returns `null` for the kinds this manager does not own (`model`, `pin`) and
 * for a layer with no `uri` — a layer with nothing to fetch cannot be drawn,
 * reordered or credited, and putting a dead row in the panel is worse than
 * leaving it to the CZML path that does understand it.
 *
 * Everything else is read defensively: a story is a document that may have been
 * authored by another tool, hand-edited, or written by an older version of this
 * one, and none of those are a reason to throw.
 */
export function fromStoryLayer(layer: Layer, index = 0): AtlasLayer | null {
  const uri = typeof layer.uri === 'string' ? layer.uri.trim() : '';
  if (!uri) return null;

  const bag = readBag(layer);
  // Prefer what we wrote, then what the URL says, then the schema kind's
  // default. The URL beats the kind because `kind: 'geojson'` is also what a
  // KML layer serialises as — the kind is lossy, the extension is not.
  const format = (bag.format && isLayerFormat(bag.format) ? bag.format : undefined)
    ?? sniffLayerFormat(uri)
    ?? FORMAT_FOR_KIND[layer.kind];
  if (!format) return null;

  const availability = readAvailability(layer);
  return {
    id: layer.id,
    name: (typeof bag.name === 'string' && bag.name.trim()) || nameFromUrl(uri),
    format,
    url: uri,
    // A story layer that says nothing about visibility is meant to be seen:
    // it was authored into the story on purpose.
    visible: bag.visible !== false,
    opacity: layer.opacity == null ? DEFAULT_OPACITY : clampOpacity(layer.opacity),
    order: typeof bag.order === 'number' && Number.isFinite(bag.order) ? bag.order : index,
    ...(bag.attribution?.text ? { attribution: bag.attribution } : {}),
    ...(availability ? { availability } : {}),
    ...(bag.options ? { options: { ...defaultOptionsFor(format).options, ...bag.options } } : defaultOptionsFor(format)),
    ...(typeof bag.catalogId === 'string' ? { catalogId: bag.catalogId } : {}),
  };
}

/** Read a story's whole layer array, dropping what this manager cannot own and
 *  re-densifying the draw order so imported layers stack predictably. */
export function fromStoryLayers(layers: readonly Layer[] | undefined): AtlasLayer[] {
  if (!Array.isArray(layers)) return [];
  const read = layers.map((l, i) => fromStoryLayer(l, i)).filter((l): l is AtlasLayer => l !== null);
  return normaliseOrder(dedupeById(read));
}

/** Two layers with the same id would make every list key collide and every
 *  edit hit both. Later wins, which matches "the story was appended to". */
function dedupeById(layers: AtlasLayer[]): AtlasLayer[] {
  const byId = new Map<string, AtlasLayer>();
  for (const l of layers) byId.set(l.id, l);
  return [...byId.values()];
}

function readBag(layer: Layer): AtlasStyleBag {
  const style = layer.style as Record<string, unknown> | undefined;
  const bag = style?.[STYLE_NS];
  return bag && typeof bag === 'object' ? (bag as AtlasStyleBag) : {};
}

/**
 * Availability, tolerating the schema's two spellings of the end bound.
 *
 * `Layer.availability` allows both `stop` (the CZML word, and the canonical
 * one) and `end` (what older Atlas stories wrote). The model keeps only `stop`,
 * so this is where the older spelling is folded in — otherwise a story written
 * last year would silently lose its end date and its layers would stay visible
 * for ever.
 */
function readAvailability(layer: Layer): LayerAvailability | null {
  const a = layer.availability;
  if (!a || typeof a.start !== 'string') return null;
  const stop = a.stop ?? a.end;
  return { start: a.start, ...(typeof stop === 'string' ? { stop } : {}) };
}
