import { safeMediaUrl } from '../ui/safeUrl.js';

/**
 * The marker icon gallery.
 *
 * ## Provenance — read this before adding one
 *
 * These glyphs are drawn on Maki's 15×15 grid and follow its conventions (a
 * single filled path, no strokes, 1px of padding on every side, shapes snapped
 * to half-pixels) so a set assembled from here and from upstream Maki/Temaki
 * looks like one family. They are **not** copies of Maki files: this build has
 * no network access and no icon package installed, so they were authored here
 * rather than vendored, and are released under CC0 with the rest of this file.
 * If someone later vendors the real Maki SVGs, drop them in beside these and
 * keep the same `maki:<name>` ids — the ids are the contract, not the paths.
 *
 * ## Why the ids and not the SVG go into the story
 *
 * `Item.icon` is a plain string, so the tempting thing is to store the data URI
 * this module generates. Three reasons not to:
 *
 *  1. Size. A story with 200 markers would carry 200 copies of the same ~400
 *     byte SVG — before base64 — into localStorage, into CI-Server, and into
 *     every export.
 *  2. Colour. The data URI bakes the colour in. Re-styling a marker would have
 *     to rewrite `icon` as well as `color`, and the two would drift.
 *  3. Portability. A story is a document other renderers read. `maki:cafe` is a
 *     name the WebXR globe and the KML exporter can each resolve their own way;
 *     an inlined SVG is a decision made for them.
 *
 * So `Item.icon` holds `maki:<name>` for a gallery pick, or an ordinary
 * `https://` URL for a custom one, and `resolveIconUrl` is the single place
 * that turns either into something a `<img>` or a Cesium billboard can load.
 *
 * ## Custom URLs are untrusted
 *
 * A story is attacker-controlled input (see `ui/safeUrl.ts`). A custom icon URL
 * goes through the same `safeMediaUrl` gate as every other media URL in the
 * app — http/https only, no `data:`, no `javascript:`. Gallery ids skip it
 * because the data URI is built here from a constant path string; it never came
 * from a document.
 */

export interface MarkerIcon {
  /** Canonical id, stored verbatim in `Item.icon`. */
  id: string;
  /** Accessible label, and the gallery button's tooltip. */
  label: string;
  /** Filled path data on a 15×15 viewBox. */
  path: string;
}

/** `d` attributes only — a filled path on a 15×15 grid, `fill-rule: evenodd`. */
export const MARKER_ICONS: readonly MarkerIcon[] = [
  {
    id: 'maki:marker',
    label: 'Pin',
    path: 'M7.5 1a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 7.5 1zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z',
  },
  {
    id: 'maki:circle',
    label: 'Dot',
    path: 'M7.5 2.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  },
  {
    id: 'maki:star',
    label: 'Star',
    path: 'M7.5 1.2 9.4 5l4.1.6-3 2.9.7 4.1-3.7-2-3.7 2 .7-4.1-3-2.9L5.6 5z',
  },
  {
    id: 'maki:home',
    label: 'Home',
    path: 'M7.5 1.5 1 7h2v6.5h3.2V10h2.6v3.5H12V7h2z',
  },
  {
    id: 'maki:heart',
    label: 'Heart',
    path: 'M7.5 13.2 2.4 8.3a3.1 3.1 0 0 1 0-4.5 3.3 3.3 0 0 1 4.6 0l.5.5.5-.5a3.3 3.3 0 0 1 4.6 0 3.1 3.1 0 0 1 0 4.5z',
  },
  {
    id: 'maki:camera',
    label: 'Photo',
    path: 'M5.4 2.5 4.5 4H2a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-2.5l-.9-1.5zm2.1 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 1.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z',
  },
  {
    id: 'maki:restaurant',
    label: 'Food',
    path: 'M3.2 1.3v4.2c0 .8.5 1.4 1.2 1.6v6.6h1.5V7.1c.7-.2 1.2-.8 1.2-1.6V1.3H6.1v3.4h-.7V1.3H4.2v3.4h-.7V1.3zM11 1.3c-1 0-1.8 1.6-1.8 3.6 0 1.5.5 2.7 1.2 3.1v5.7h1.5V1.3z',
  },
  {
    id: 'maki:lodging',
    label: 'Stay',
    path: 'M1.5 3.5v8h1.8V9.2h8.4v2.3h1.8V6.8c0-.9-.7-1.6-1.6-1.6H6.6v4H3.3V3.5zM4.6 5.6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  },
  {
    id: 'maki:mountain',
    label: 'Summit',
    path: 'M7.5 2 13.8 13H1.2zm0 3.2L4.4 10.4h1.9l1.2-2 1.2 2h1.9z',
  },
  {
    id: 'maki:water',
    label: 'Water',
    path: 'M7.5 1.3 4 6.6a4.3 4.3 0 0 0-.7 2.3 4.2 4.2 0 0 0 8.4 0c0-.8-.2-1.6-.7-2.3z',
  },
  {
    id: 'maki:flag',
    label: 'Flag',
    path: 'M3 1.3h1.5v12.4H3zM5.5 2c1.6-1 3.2-1 4.8 0s3.2 1 4.8 0v6.4c-1.6 1-3.2 1-4.8 0s-3.2-1-4.8 0z',
  },
  {
    id: 'maki:car',
    label: 'Drive',
    path: 'M3.4 3.4 2 7.2v5h2V11h7v1.2h2v-5l-1.4-3.8zm.7 1.3h6.8l.9 2.5H3.2zM4 8.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  },
];

const BY_ID = new Map(MARKER_ICONS.map((i) => [i.id, i]));

/** Is this an id from the gallery (rather than a URL)? */
export function isGalleryIcon(icon: string | null | undefined): boolean {
  return typeof icon === 'string' && BY_ID.has(icon);
}

export function galleryIcon(id: string | null | undefined): MarkerIcon | null {
  return (typeof id === 'string' ? BY_ID.get(id) : undefined) ?? null;
}

/**
 * A gallery glyph as an `<svg>` document string, in the given colour.
 *
 * Exported separately from the data URI because the toolbar renders the gallery
 * inline — an `<img>` per swatch would be twelve requests for markup we already
 * have in memory, and an inline `<svg>` can inherit `currentColor` for the
 * hover/active states the buttons need.
 */
export function iconSvg(id: string, color = 'currentColor'): string | null {
  const icon = galleryIcon(id);
  if (!icon) return null;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 15" width="15" height="15">` +
    `<path fill="${escapeAttr(color)}" fill-rule="evenodd" d="${icon.path}"/></svg>`
  );
}

/**
 * The URL a billboard or `<img>` should load for an `Item.icon` value.
 *
 * Gallery id → a `data:image/svg+xml` URI built here, coloured to match the
 * item. Anything else → the story's own URL, put through `safeMediaUrl` first.
 * Returns `null` when there is nothing loadable, which callers treat as "draw a
 * plain point" — the same fallback `czml.ts` takes for an unresolved
 * `ci-memory://` image, and for the same reason: Cesium's `fetchImage` rejects
 * an unknown scheme with a console error rather than a visible failure.
 *
 * `encodeURIComponent`, not base64: it is shorter for SVG, it stays readable in
 * devtools, and — the actual bug it avoids — `btoa` throws a
 * `InvalidCharacterError` on any non-Latin-1 character, which a label or a
 * future glyph could easily contain.
 */
export function resolveIconUrl(icon: string | null | undefined, color = '#72ddd4'): string | null {
  if (!icon) return null;
  const svg = iconSvg(icon, color);
  if (svg) return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return safeMediaUrl(icon);
}

/** Is this string usable as a custom icon? Drives the toolbar's inline
 *  validation, so a rejected URL says so instead of silently doing nothing. */
export function isUsableCustomIcon(url: string): boolean {
  return safeMediaUrl(url) != null;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
