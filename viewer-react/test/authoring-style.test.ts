import { describe, expect, it } from 'vitest';
import { Item as ItemSchema, type Item } from '@companion-atlas/story';
import {
  applyStyle,
  DEFAULT_STYLE,
  isStyleable,
  mergeStyle,
  styleOf,
  STYLE_SWATCHES,
  WIDTH_STEPS,
} from '../src/authoring/style.js';
import {
  galleryIcon,
  isGalleryIcon,
  isUsableCustomIcon,
  iconSvg,
  MARKER_ICONS,
  resolveIconUrl,
} from '../src/authoring/icons.js';
import { formatArea, formatLength } from '../src/authoring/Toolbar.js';

/**
 * Style, and the icon gallery.
 *
 * The property under test throughout is "style lands on the canonical fields
 * and nowhere else". A parallel `Map<itemId, Style>` would render perfectly in
 * this app and export to KML, CZML and WebXR with every shape the same default
 * blue — the failure the schema's flat style fields exist to prevent. The proof
 * is a Zod parse after every write: Zod's `strip` behaviour silently discards a
 * field that does not belong to the item's variant, so a style that survives in
 * memory and vanishes on save would otherwise be invisible here.
 */

const p = (lon: number, lat: number) => ({ lon, lat });

const polygon = (over: Partial<Extract<Item, { type: 'polygon' }>> = {}): Item => ({
  id: 'p', type: 'polygon', positions: [p(0, 0), p(1, 0), p(1, 1)], ...over,
} as Item);

describe('the tool’s style', () => {
  it('defaults to the shell’s own palette and drapes on terrain', () => {
    // Drawn shapes clamp EXPLICITLY. Picks carry the terrain height at whatever
    // LOD happened to be loaded, so an unclamped shape floats above a ridge or
    // sinks into it once finer terrain streams in.
    expect(DEFAULT_STYLE.clampToGround).toBe(true);
    expect(STYLE_SWATCHES.map((s) => s.hex)).toContain(DEFAULT_STYLE.color);
    expect(WIDTH_STEPS).toContain(DEFAULT_STYLE.width);
  });

  it('shrugs off the empty string a colour input hands back mid-edit', () => {
    const merged = mergeStyle(DEFAULT_STYLE, { color: '', width: Number.NaN });
    expect(merged.color).toBe(DEFAULT_STYLE.color);
    expect(merged.width).toBe(DEFAULT_STYLE.width);
  });

  it('clamps opacity and refuses negative widths', () => {
    expect(mergeStyle(DEFAULT_STYLE, { fillOpacity: 2 }).fillOpacity).toBe(1);
    expect(mergeStyle(DEFAULT_STYLE, { fillOpacity: -1 }).fillOpacity).toBe(0);
    expect(mergeStyle(DEFAULT_STYLE, { outlineWidth: -3 }).outlineWidth).toBe(0);
  });

  it('lets fillOpacity 0 through — outline-only is a real value', () => {
    expect(mergeStyle(DEFAULT_STYLE, { fillOpacity: 0 }).fillOpacity).toBe(0);
  });

  it('clears an icon back to a plain dot', () => {
    expect(mergeStyle(DEFAULT_STYLE, { icon: undefined }).icon).toBeUndefined();
  });
});

describe('writing style onto canonical fields', () => {
  it('maps the single colour control onto each type’s own field', () => {
    const m = applyStyle({ id: 'm', type: 'marker', position: p(0, 0) }, { color: '#ff8d6e' });
    expect(ItemSchema.parse(m)).toMatchObject({ color: '#ff8d6e' });

    const l = applyStyle({ id: 'l', type: 'line', positions: [p(0, 0), p(1, 1)] }, { color: '#ff8d6e', width: 5 });
    expect(ItemSchema.parse(l)).toMatchObject({ color: '#ff8d6e', width: 5 });

    // For a polygon the tool's "colour" is its FILL, and the outline is the
    // separate control — an area annotation over imagery has to be a
    // translucent wash with a bright edge to stay readable.
    const g = applyStyle(polygon(), { color: '#ff8d6e', outlineColor: '#58ebbf', outlineWidth: 4 });
    expect(ItemSchema.parse(g)).toMatchObject({
      fillColor: '#ff8d6e',
      outlineColor: '#58ebbf',
      outlineWidth: 4,
    });
  });

  it('never writes a field the item’s variant does not have', () => {
    // `width` belongs to `line`, not `polygon`. Writing it would be dropped by
    // Zod's strip on the next parse — a style that works until it is saved.
    const g = applyStyle(polygon(), { width: 9 });
    expect('width' in (g as Record<string, unknown>)).toBe(false);
    const l = applyStyle({ id: 'l', type: 'line', positions: [p(0, 0), p(1, 1)] }, { fillOpacity: 0.5 });
    expect('fillOpacity' in (l as Record<string, unknown>)).toBe(false);
  });

  it('leaves an item with no style fields alone rather than throwing', () => {
    // The toolbar is allowed to be open over any selection.
    const note: Item = { id: 'n', type: 'note', position: p(0, 0), text: 'hi' };
    expect(applyStyle(note, { color: '#fff' })).toBe(note);
    expect(isStyleable('note')).toBe(false);
    expect(isStyleable('polygon')).toBe(true);
  });

  it('does not mutate the item it restyles', () => {
    const original = polygon({ fillColor: '#111111' });
    applyStyle(original, { color: '#ffffff' });
    expect(original).toMatchObject({ fillColor: '#111111' });
  });

  it('preserves fillOpacity 0 through a restyle', () => {
    expect(applyStyle(polygon(), { fillOpacity: 0 })).toMatchObject({ fillOpacity: 0 });
  });
});

describe('reading style back off a shape', () => {
  it('re-arms the tool with the selected shape’s own settings', () => {
    const g = polygon({ fillColor: '#b79cff', fillOpacity: 0.1, outlineColor: '#ffb27a', outlineWidth: 6 });
    expect(styleOf(g)).toEqual({
      color: '#b79cff',
      fillOpacity: 0.1,
      outlineColor: '#ffb27a',
      outlineWidth: 6,
      clampToGround: undefined,
    });
    // Merged over the current style, so unset fields keep what the tool had.
    expect(mergeStyle(DEFAULT_STYLE, styleOf(g)).width).toBe(DEFAULT_STYLE.width);
  });

  it('has nothing to say about an item with no style', () => {
    expect(styleOf({ id: 'n', type: 'note', position: p(0, 0), text: 'x' })).toEqual({});
  });
});

describe('the icon gallery', () => {
  it('offers ids that are stable names, not inlined SVG', () => {
    // A story with 200 markers would otherwise carry 200 copies of the same
    // SVG, with the colour baked in so restyling could not touch it.
    for (const icon of MARKER_ICONS) {
      expect(icon.id.startsWith('maki:')).toBe(true);
      expect(icon.label.length).toBeGreaterThan(0);
      expect(icon.path.length).toBeGreaterThan(10);
    }
    expect(new Set(MARKER_ICONS.map((i) => i.id)).size).toBe(MARKER_ICONS.length);
    expect(isGalleryIcon('maki:marker')).toBe(true);
    expect(isGalleryIcon('https://x/pin.svg')).toBe(false);
    expect(galleryIcon('nope')).toBeNull();
  });

  it('renders a gallery id as a coloured data URI a billboard can load', () => {
    const url = resolveIconUrl('maki:marker', '#ff8d6e');
    expect(url?.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url!)).toContain('#ff8d6e');
    // Percent-encoded, not base64: `btoa` throws on any non-Latin-1 character.
    expect(url).not.toContain('base64');
  });

  it('escapes the colour it interpolates into the SVG attribute', () => {
    const svg = iconSvg('maki:marker', '"/><script>x</script>');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;');
  });

  it('passes a real custom URL through', () => {
    expect(resolveIconUrl('https://example.org/pin.png')).toBe('https://example.org/pin.png');
    expect(isUsableCustomIcon('https://example.org/pin.png')).toBe(true);
  });

  it('refuses a custom URL that is a script, or a scheme Cesium cannot fetch', () => {
    // A story is attacker-controlled input; icons go through the same gate as
    // every other media URL in the app.
    expect(resolveIconUrl('javascript:alert(1)')).toBeNull();
    expect(resolveIconUrl('java\tscript:alert(1)')).toBeNull();
    expect(resolveIconUrl('data:image/svg+xml,<svg onload="x"/>')).toBeNull();
    expect(isUsableCustomIcon('ftp://x/pin.png')).toBe(false);
  });

  it('has nothing to resolve for an unset icon', () => {
    expect(resolveIconUrl(undefined)).toBeNull();
    expect(resolveIconUrl('')).toBeNull();
  });
});

describe('measurement readouts', () => {
  it('switches units where a person would', () => {
    expect(formatLength(0)).toBe('0 m');
    expect(formatLength(940)).toBe('940 m');
    expect(formatLength(1500)).toBe('1.50 km');
    expect(formatLength(42_000)).toBe('42.0 km');
  });

  it('uses hectares for a parcel and km² for a district', () => {
    expect(formatArea(850)).toBe('850 m²');
    expect(formatArea(25_000)).toBe('2.50 ha');
    expect(formatArea(3_400_000)).toBe('3.40 km²');
    expect(formatArea(0)).toBe('0 m²');
  });
});
