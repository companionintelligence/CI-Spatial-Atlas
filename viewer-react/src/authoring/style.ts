import type { Item } from '@companion-atlas/story';

/**
 * The style a drawing tool is currently set to, and how it lands on an `Item`.
 *
 * ## There is no style store
 *
 * `AuthoringStyle` is the *tool's* current setting — what the next shape will
 * be drawn with — and nothing else. The moment a shape exists, its style lives
 * in the canonical fields the schema already defines (`marker.color`,
 * `line.color`/`width`, `polygon.fillColor`/`fillOpacity`/`outlineColor`/
 * `outlineWidth`), and `applyStyle` is the only writer. That is the whole point:
 * a parallel `Map<itemId, Style>` would render correctly in this app and export
 * to KML, CZML and WebXR with every shape the same default blue, which is the
 * failure mode the schema's flat style fields were designed to prevent.
 *
 * `styleOf` reads the same fields back, so selecting a shape re-arms the tool
 * with that shape's own style rather than with whatever was last picked.
 *
 * ## One colour control, three field names
 *
 * A person drawing does not think "fill colour" versus "point colour"; they
 * think "this shape is orange". So the toolbar has one primary colour and one
 * outline colour, and this module maps them onto whichever fields the item's
 * type actually has. Writing `fillColor` onto a `line` (or `width` onto a
 * `polygon`) would be silently dropped by Zod's `strip` behaviour on the next
 * parse — a style that survives in memory and vanishes on save is worse than
 * one that was never applied, so the mapping is explicit and exhaustive.
 */

export interface AuthoringStyle {
  /** The shape's dominant colour: `marker.color`, `line.color`, `polygon.fillColor`. */
  color: string;
  /** Stroke width in SCREEN PIXELS (CZML `polyline.width`), not metres. */
  width: number;
  /** 0..1. `0` is meaningful — it means outline-only. */
  fillOpacity: number;
  outlineColor: string;
  /** Screen pixels. `0` means no outline. */
  outlineWidth: number;
  /** Gallery id (`maki:marker`) or a URL — see `icons.ts`. Markers only. */
  icon?: string;
  /**
   * Drape onto terrain instead of honouring per-vertex heights.
   *
   * **Drawn shapes default this to `true`, explicitly**, and that is not the
   * same as leaving it unset. The schema's own default (in `czml.ts`) is
   * "clamp when no vertex carries a height", which is the right rule for an
   * *import* — a 2D GeoJSON drapes, a surveyed 3D line does not. It is the
   * wrong rule here, because every vertex a person clicks does carry a height:
   * the pick returns the terrain elevation at the tile LOD that happened to be
   * loaded. Zoom in afterwards, finer terrain streams in, and an unclamped
   * shape floats above a ridge or sinks into it — the "my outline is buried in
   * the hill" bug, which only shows up after the shape looked perfect.
   *
   * The heights are still stored (KML and GeoJSON exports want real
   * elevations, and turning clamping off is then a meaningful choice rather
   * than a shape that collapses to sea level).
   */
  clampToGround?: boolean;
}

/**
 * Defaults, in the app's own palette.
 *
 * These are DATA — they end up inside `Item.color` and travel to KML, CZML and
 * the WebXR renderer, none of which can read a CSS custom property. So they are
 * hex literals here and CSS variables everywhere in `theme/authoring.css`; the
 * values mirror `--atlas-teal`/`--atlas-mint` in `theme/atlas.css`, the same way
 * `CesiumStoryViewer`'s `PIN_TEAL`/`PIN_MINT` do for the memory pins.
 */
export const DEFAULT_STYLE: AuthoringStyle = {
  color: '#72ddd4',       // --atlas-teal
  width: 3,
  fillOpacity: 0.35,
  outlineColor: '#58ebbf', // --atlas-mint
  outlineWidth: 2,
  icon: 'maki:marker',
  clampToGround: true,
};

/** The palette the toolbar offers. Every entry is a colour the shell already
 *  uses, so a drawn shape reads as part of this app rather than as something
 *  pasted onto it. Named, because "the orange one" is how people refer to them
 *  and because a swatch needs an accessible label. */
export const STYLE_SWATCHES: ReadonlyArray<{ id: string; label: string; hex: string }> = [
  { id: 'teal', label: 'Teal', hex: '#72ddd4' },
  { id: 'mint', label: 'Mint', hex: '#58ebbf' },
  { id: 'aqua', label: 'Aqua', hex: '#00a9a7' },
  { id: 'dusk', label: 'Dusk', hex: '#ffb27a' },
  { id: 'coral', label: 'Coral', hex: '#ff8d6e' },
  { id: 'violet', label: 'Violet', hex: '#b79cff' },
  { id: 'bone', label: 'Bone', hex: '#f3f9f9' },
];

/** Line widths the toolbar offers, in screen pixels. */
export const WIDTH_STEPS: readonly number[] = [1, 2, 3, 5, 8];

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Merge a patch over a style, dropping anything that is not usable. A colour
 *  input can hand back an empty string mid-edit, and a number input hands back
 *  NaN for "", both of which would otherwise poison every subsequent shape. */
export function mergeStyle(base: AuthoringStyle, patch: Partial<AuthoringStyle>): AuthoringStyle {
  const out: AuthoringStyle = { ...base };
  if (typeof patch.color === 'string' && patch.color) out.color = patch.color;
  if (typeof patch.outlineColor === 'string' && patch.outlineColor) out.outlineColor = patch.outlineColor;
  if (Number.isFinite(patch.width)) out.width = Math.max(0, patch.width as number);
  if (Number.isFinite(patch.outlineWidth)) out.outlineWidth = Math.max(0, patch.outlineWidth as number);
  if (Number.isFinite(patch.fillOpacity)) out.fillOpacity = clamp01(patch.fillOpacity as number);
  if ('icon' in patch) out.icon = patch.icon || undefined;
  if ('clampToGround' in patch) out.clampToGround = patch.clampToGround;
  return out;
}

/**
 * Write a style patch onto an item's canonical fields.
 *
 * Returns a NEW item (never mutates), and only ever touches fields the item's
 * own variant declares. An item type with no style fields (`note`, `photo`,
 * `track`…) comes back untouched rather than throwing — the toolbar is allowed
 * to be open over any selection.
 */
export function applyStyle(item: Item, patch: Partial<AuthoringStyle>): Item {
  switch (item.type) {
    case 'marker': {
      const next = { ...item };
      if (typeof patch.color === 'string' && patch.color) next.color = patch.color;
      if ('icon' in patch) next.icon = patch.icon || undefined;
      return next;
    }
    case 'line': {
      const next = { ...item };
      if (typeof patch.color === 'string' && patch.color) next.color = patch.color;
      if (Number.isFinite(patch.width)) next.width = Math.max(0, patch.width as number);
      if ('clampToGround' in patch) next.clampToGround = patch.clampToGround;
      return next;
    }
    case 'polygon': {
      const next = { ...item };
      // The tool's single "colour" is a polygon's FILL. Its outline is the
      // separate control, so a shape can be a translucent wash with a bright
      // edge — which is what an area annotation over imagery has to be to stay
      // readable.
      if (typeof patch.color === 'string' && patch.color) next.fillColor = patch.color;
      if (typeof patch.outlineColor === 'string' && patch.outlineColor) next.outlineColor = patch.outlineColor;
      // `?? 0` is load-bearing: `fillOpacity: 0` is a real value (outline-only,
      // how KML's `<fill>0</fill>` arrives) and a truthiness test would discard it.
      if (Number.isFinite(patch.fillOpacity)) next.fillOpacity = clamp01(patch.fillOpacity as number);
      if (Number.isFinite(patch.outlineWidth)) next.outlineWidth = Math.max(0, patch.outlineWidth as number);
      if ('clampToGround' in patch) next.clampToGround = patch.clampToGround;
      return next;
    }
    default:
      return item;
  }
}

/** Read an item's style back out, so selecting a shape re-arms the tool with
 *  that shape's own settings. Only the fields the type carries are returned;
 *  the caller merges over its current style, so the rest is unchanged. */
export function styleOf(item: Item): Partial<AuthoringStyle> {
  switch (item.type) {
    case 'marker':
      return { color: item.color, icon: item.icon };
    case 'line':
      return { color: item.color, width: item.width, clampToGround: item.clampToGround };
    case 'polygon':
      return {
        color: item.fillColor,
        fillOpacity: item.fillOpacity,
        outlineColor: item.outlineColor,
        outlineWidth: item.outlineWidth,
        clampToGround: item.clampToGround,
      };
    default:
      return {};
  }
}

/**
 * Does the toolbar have anything to offer for this item type or mode?
 *
 * Takes a plain string rather than a union, because the caller is asking about
 * whichever of two different vocabularies is live — an `AuthoringMode` when a
 * tool is armed, an `Item['type']` when a shape is selected — and a union of
 * both would need a cast at every call site to say something this function
 * already answers for anything.
 *
 * Drives whether the style row is rendered at all. A style row over a `note`
 * would be four dead controls: the schema gives a note no style fields.
 */
export function isStyleable(type: string): boolean {
  return type === 'marker' || type === 'line' || type === 'polygon';
}
