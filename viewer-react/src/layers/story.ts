import type { Layer, Story } from '@companion-atlas/story';
import {
  adoptStoryLayer,
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
 * ## The bag used to hold much more than it does now
 *
 * When this file was written the schema's `Layer` had only `id`/`kind`/`uri`/
 * `style`/`opacity`/`availability`, so the five fields that make a layer usable
 * — `name`, `format`, `visible`, `order` and `attribution` — were smuggled
 * through `style.atlas` because there was nowhere else to put them. The schema
 * has since GAINED all five as real top-level fields (see
 * `packages/story-schema/src/schema.ts`), and this writer now uses them.
 *
 * That matters most for **attribution**, which is a licence condition and not
 * presentation: nearly every open source in the catalog (OSM/ODbL, EOX and
 * CARTO/CC BY, OpenSeaMap/CC BY-SA) requires its credit line to be carried and
 * shown, so a story that holds a layer but drops its credit is a story that
 * cannot lawfully be published. Inside `style` the credit was one
 * unknown-key-dropping renderer or one lossy server round-trip away from
 * disappearing with nothing logged; the schema's own comment on
 * `LayerAttribution` says exactly this. Top level, it is a field a validator can
 * see and a foreign tool can honour.
 *
 * The bag is still written, but only for what the schema genuinely has no field
 * for (`options`, `catalogId`), and still *read* for all five migrated fields so
 * that documents written by earlier versions of this code — which are already
 * out there in localStorage exports and saved stories — keep loading intact.
 * Nothing is dual-written: two copies of `visible` in one document is a question
 * ("which one is true?") that no reader can answer correctly.
 *
 * What a story genuinely cannot express, and is therefore lost to anything but
 * Atlas, is written down in the reader below rather than in a wiki nobody opens.
 */

/** The key inside `Layer.style` where the viewer's own fields live. */
const STYLE_NS = 'atlas';

/**
 * Shape stored under `style.atlas`.
 *
 * Everything here is optional on the way in: a story authored by another tool
 * will have none of it, and a story written before the schema grew the real
 * fields will have the whole of it. The five migrated fields stay in the type
 * because this is also the *read* shape — see `readBag`.
 */
interface AtlasStyleBag {
  /** @deprecated Legacy read path — written as `Layer.name` since the schema grew it. */
  name?: string;
  /** @deprecated Legacy read path — written as `Layer.format`. */
  format?: LayerFormat;
  /** @deprecated Legacy read path — written as `Layer.visible`. */
  visible?: boolean;
  /** @deprecated Legacy read path — written as `Layer.order`. */
  order?: number;
  /** @deprecated Legacy read path — written as `Layer.attribution`. */
  attribution?: LayerAttribution;
  /** Provider options: no schema field, so this is the only home it has. */
  options?: LayerOptions;
  /** Catalog provenance: likewise viewer-only, and likewise bag-resident. */
  catalogId?: string;
}

/** Schema kind → the format to assume when the story does not say. Only used
 *  for layers Atlas did not author; ours carry the exact format in `format`. */
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
    ...(l.options ? { options: l.options } : {}),
    ...(l.catalogId ? { catalogId: l.catalogId } : {}),
  };
  return {
    id: l.id,
    // `kind` is what the layer *is* for the scene graph; `format` is what its
    // endpoint speaks. Both are written because neither implies the other:
    // `imagery` spans four incompatible tile protocols, and `geojson` is also
    // where KML and CZML land.
    kind: layerKind(l.format),
    name: l.name,
    format: l.format,
    uri: l.url,
    opacity: l.opacity,
    visible: l.visible,
    order: l.order,
    ...(l.attribution ? { attribution: l.attribution } : {}),
    ...(l.availability ? { availability: { start: l.availability.start, ...(l.availability.stop ? { stop: l.availability.stop } : {}) } } : {}),
    // An empty bag is still written rather than omitted-when-empty, because a
    // present-but-empty `style` is what tells a later reader "Atlas wrote this
    // and had nothing viewer-only to add", as opposed to "another tool wrote
    // it". Cheap, and it keeps `style` a stable object for style hints.
    style: { [STYLE_NS]: bag as unknown as Record<string, unknown> },
  };
}

export const toStoryLayers = (layers: readonly AtlasLayer[]): Layer[] => layers.map(toStoryLayer);

/**
 * Fold the current stack into a story, for save and export.
 *
 * The outbound half of this bridge, and the reason it exists: without a call to
 * this, a user adds four layers, exports the story and gets a document with
 * none of them — silently, because an absent `layers` array is perfectly valid.
 *
 * Merged by id rather than assigned wholesale, because the stack is not the
 * whole truth about `story.layers`. `fromStoryLayers` deliberately drops the
 * kinds this manager does not own (`model`, `pin`, anything without a `uri`), so
 * a story that arrived carrying those would lose them for good if saving
 * replaced the array with only what the panel holds — a data-loss bug that would
 * look exactly like the one this function fixes, only pointed the other way.
 * Layers the panel does own keep their original array position so a saved
 * story's diff stays small; new ones append.
 *
 * ## Absence has to mean deletion, and only the reader can say which absence
 *
 * The first version of this kept *every* unmatched entry, justifying it with the
 * paragraph above — but it never tested for the case the paragraph describes. A
 * layer the user explicitly removed in the panel is also unmatched (the ids are
 * preserved verbatim on the way in, so a removed layer is exactly an id that is
 * no longer in the stack), so Remove was silently absent from every save and
 * every export: the row vanished from the panel and came straight back the next
 * time the document was opened, with nothing logged and nothing to undo.
 *
 * `fromStoryLayer(existing) === null` is the honest test, because it is the same
 * predicate that decided whether the layer ever reached the panel. Null means
 * the manager could not own it and its absence proves nothing; non-null means
 * the panel had it and the user took it away on purpose.
 *
 * Returns the story unchanged (same object identity) when the merge would not
 * change the array — the renderer rebuilds its CZML data source when the story
 * reference changes, so handing back a fresh object every render would be
 * visible.
 */
export function withStoryLayers(story: Story | null, layers: readonly AtlasLayer[]): Story | null {
  if (!story) return story;
  const existingLayers = story.layers ?? [];
  // Nothing on either side: not even a `layers: []` is written, so a document
  // that never had the key keeps not having it.
  if (existingLayers.length === 0 && layers.length === 0) return story;

  const mine = new Map(toStoryLayers(layers).map((l) => [l.id, l]));
  const merged: Layer[] = [];
  for (const existing of existingLayers) {
    const replacement = mine.get(existing.id);
    if (replacement) {
      merged.push(replacement);
      mine.delete(existing.id);
    } else if (fromStoryLayer(existing) === null) {
      // A kind the panel cannot hold (`model`, `pin`, no `uri`). It was never in
      // the stack, so its absence is not a decision — carry it through.
      merged.push(existing);
    }
    // Otherwise: the panel owned this layer and it is gone from the stack. That
    // is a removal, and a save that quietly resurrected it would make Remove a
    // button that does nothing durable.
  }
  merged.push(...mine.values());

  if (sameLayers(existingLayers, merged)) return story;
  return { ...story, layers: merged };
}

/** Reference-equal, element for element. Enough to answer "did the merge change
 *  anything?", because every layer this function keeps is either the caller's
 *  own object or a freshly built one. */
function sameLayers(a: readonly Layer[], b: readonly Layer[]): boolean {
  return a.length === b.length && a.every((l, i) => l === b[i]);
}

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
 * one, and none of those are a reason to throw. Each field therefore reads
 * top-level first (what the schema now defines), then `style.atlas` (what this
 * code used to write), then a derivation from the URL or the kind.
 */
export function fromStoryLayer(layer: Layer, index = 0): AtlasLayer | null {
  const uri = typeof layer.uri === 'string' ? layer.uri.trim() : '';
  if (!uri) return null;

  const bag = readBag(layer);
  // Prefer an explicit statement of the protocol — the schema's `format` first,
  // then the legacy bag copy — then what the URL says, then the schema kind's
  // default. The URL beats the kind because `kind: 'geojson'` is also what a
  // KML layer serialises as: the kind is lossy, the extension is not.
  const format = pickFormat(layer.format)
    ?? pickFormat(bag.format)
    ?? sniffLayerFormat(uri)
    ?? FORMAT_FOR_KIND[layer.kind];
  if (!format) return null;

  const name = firstString(layer.name, bag.name) ?? nameFromUrl(uri);
  // A story layer that says nothing about visibility is meant to be seen: it
  // was authored into the story on purpose. That is also what the schema says
  // ("Absent means visible"), so `!== false` and not `?? true` — a bag holding
  // a hand-edited non-boolean must not read as hidden.
  const visible = firstBoolean(layer.visible, bag.visible) !== false;
  const order = firstFinite(layer.order, bag.order) ?? index;
  const attribution = readAttribution(layer.attribution) ?? readAttribution(bag.attribution);

  const availability = readAvailability(layer);
  return {
    id: layer.id,
    name,
    format,
    url: uri,
    visible,
    opacity: layer.opacity == null ? DEFAULT_OPACITY : clampOpacity(layer.opacity),
    order,
    ...(attribution ? { attribution } : {}),
    ...(availability ? { availability } : {}),
    ...(bag.options ? { options: { ...defaultOptionsFor(format).options, ...bag.options } } : defaultOptionsFor(format)),
    ...(typeof bag.catalogId === 'string' ? { catalogId: bag.catalogId } : {}),
  };
}

/** Everything the inbound merge needs to know beyond the layers themselves. */
export interface AdoptOptions {
  /**
   * The id of the document these layers belong to, stamped on every row that is
   * genuinely the document's. Omit for layers the user brought deliberately —
   * a dropped `.story.json` — which are theirs to keep and to persist.
   */
  storyId?: string;
  /**
   * Source URLs the user has removed. A merge that ignored these would undo
   * every removal on the next re-render that produced a new story object, which
   * is what made Remove look like a button with no effect.
   */
  dismissed?: ReadonlySet<string>;
}

/**
 * The inbound half of the bridge: fold a story's layers into the live stack.
 *
 * Pure, and here rather than inside `useLayers`, for the same reason the rest of
 * this directory is: the decisions it makes — what is the user's, what is the
 * document's, what stays gone — are exactly the ones a rendering bug would hide,
 * so they have to be testable without a DOM.
 *
 * Adds rather than replaces. The user's stack is theirs, and a story opening
 * should put its layers on top of it, not delete what they collected.
 */
export function adoptStoryLayers(
  stack: readonly AtlasLayer[],
  storyLayers: readonly Layer[] | undefined,
  opts: AdoptOptions = {},
): AtlasLayer[] {
  const { storyId, dismissed } = opts;
  const incoming = fromStoryLayers(storyLayers)
    .filter((l) => !dismissed?.has(l.url))
    .map((l) => (storyId ? { ...l, fromStoryId: storyId } : l));
  // Identity when there is nothing to add: the caller feeds this to `setLayers`
  // on every document change, and a fresh array each time would re-persist the
  // stack and re-run every memo that depends on it for no reason.
  if (!incoming.length) return stack as AtlasLayer[];
  return incoming.reduce((acc, l) => adoptStoryLayer(acc, l), stack as AtlasLayer[]);
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
 * `unknown` in, `LayerFormat` out.
 *
 * The schema's `LayerFormat` enum and this module's are the same ten strings
 * today, but they are two separate declarations in two packages, so this
 * validates rather than casts: a format the schema gains and Atlas cannot draw
 * must fall through to the sniffer, not reach `FORMAT_META[format]` and index
 * `undefined`.
 */
const pickFormat = (v: unknown): LayerFormat | undefined => (isLayerFormat(v) ? v : undefined);

/** First value that is a non-empty string, trimmed. The bag is hand-editable,
 *  so "present" is not the same as "usable". */
function firstString(...vs: unknown[]): string | undefined {
  for (const v of vs) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function firstBoolean(...vs: unknown[]): boolean | undefined {
  for (const v of vs) if (typeof v === 'boolean') return v;
  return undefined;
}

function firstFinite(...vs: unknown[]): number | undefined {
  for (const v of vs) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

/**
 * Normalise a credit, from either the schema field or the legacy bag.
 *
 * `text` is the whole point — a credit with no line to display is not a credit
 * — so an entry without one is dropped rather than carried as an empty badge.
 * The remaining fields are copied individually instead of spread: the bag is
 * hand-editable free-form JSON, and a stray key spread into the model would
 * ride along into the next `toStoryLayer` and get stripped by Zod on the way
 * back, which is a diff that appears and disappears for no visible reason.
 */
function readAttribution(a: unknown): LayerAttribution | null {
  if (!a || typeof a !== 'object') return null;
  const src = a as Partial<LayerAttribution>;
  const text = firstString(src.text);
  if (!text) return null;
  const licence = firstString(src.licence);
  const url = firstString(src.url);
  return {
    text,
    ...(licence ? { licence } : {}),
    ...(url ? { url } : {}),
    ...(typeof src.onScreen === 'boolean' ? { onScreen: src.onScreen } : {}),
  };
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
