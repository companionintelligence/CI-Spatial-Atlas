/**
 * Canonical `Story` → KML 2.2.
 *
 * Hand-written serialiser, deliberately. A generic XML builder would have to be
 * fed a tree that mirrors the output exactly, so it saves nothing over template
 * strings while adding a dependency to a package whose whole job is to be the
 * one thing everything else depends on. The only real work an XML library would
 * do for us is escaping, and that is `escapeXml` below.
 *
 * Reads `storyEntities()` rather than `story.items`, so an Atlas story whose
 * content lives in `media[]` exports too — otherwise "export to Google Earth"
 * would silently produce an empty file for exactly the pipeline-built stories
 * users most want to share.
 */
import { cssToKmlColor } from './kml.js';
import { storyEntities } from './normalize.js';
import type { GeoPath, GeoPoint, Item, Story, TimeSpec, TrackSample } from './schema.js';

export interface KmlExportOptions {
  /**
   * How to write a `track`. Default `gx:Track`.
   *
   * `gx:Track` is the honest representation: it keeps the per-sample time
   * association, so "where were you at 09:14" survives and Google Earth drives
   * its own time slider from it. The cost is that `gx:` is a Google extension —
   * a strict KML 2.2 reader will skip the whole geometry. `LineString` is the
   * lowest-common-denominator fallback: universally readable, but it flattens
   * the trajectory to a single `<TimeSpan>` and throws away every intermediate
   * timestamp. Time fidelity is the reason this package exists, so the
   * extension wins by default.
   */
  trackAs?: 'gx:Track' | 'LineString';
  /** Document-level `<name>`; defaults to `story.title`. */
  name?: string;
  /** Document-level `<description>`; defaults to `story.description`. */
  description?: string;
}

/** XML 1.0 forbids most C0 control characters outright — no entity can encode
 *  them. They turn up in descriptions carried over from EXIF and from scraped
 *  HTML, and a single stray 0x00 makes the whole export unparseable, so drop
 *  them before escaping rather than emitting a file that fails to open. */
const stripInvalidXmlChars = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');

function escapeXml(s: string): string {
  return stripInvalidXmlChars(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * A Placemark's `id` is typed `xsd:ID` in the KML 2.2 schema, i.e. an XML
 * NCName: no `#`, no spaces, no colon, no leading digit. Story ids are
 * free-form (a UUID, a Companion Memory id, `photo_7#derived` from
 * `mediaToEntities`), so fold them into the allowed set rather than emit a
 * document that fails schema validation for a reason nobody would guess.
 * The mapping is many-to-one, so two ids differing only in punctuation would
 * collide — harmless in every reader, but that is why the importers keep the
 * ids they generate NCName-safe to begin with.
 */
function xmlId(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '_');
  return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`;
}

/** Balloon HTML has to survive as markup, so it goes in CDATA. `]]>` inside the
 *  payload would close the section early and produce malformed XML — split the
 *  sequence across two CDATA sections, the standard escape. */
function cdata(html: string): string {
  return `<![CDATA[${stripInvalidXmlChars(html).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

/** Normalise to a full RFC-3339 instant, matching what the CZML converter does.
 *  KML's `<when>`/`<begin>` accept truncated forms, but emitting whatever the
 *  source happened to hold makes round-trip comparisons meaningless. */
function iso(d: string): string {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toISOString();
}

/** `TimeSpec` → `<TimeStamp>` (an instant) or `<TimeSpan>` (an interval). */
function timeXml(time: TimeSpec | undefined, indent: string): string {
  if (!time) return '';
  if (typeof time === 'string') return `${indent}<TimeStamp><when>${iso(time)}</when></TimeStamp>\n`;
  const start = time.start ?? time.at;
  const end = time.end ?? time.stop;
  if (start && end) {
    return `${indent}<TimeSpan><begin>${iso(start)}</begin><end>${iso(end)}</end></TimeSpan>\n`;
  }
  const at = time.at ?? start;
  if (!at) return '';
  return `${indent}<TimeStamp><when>${iso(at)}</when></TimeStamp>\n`;
}

/**
 * KML `<coordinates>` is `lon,lat,alt` — LONGITUDE FIRST, the same trap as
 * GeoJSON but with commas. Altitude is only written when something in the
 * geometry actually has one; emitting a bogus `,0` alongside
 * `altitudeMode>absolute` would bury a 2D shape at sea level.
 */
function coordList(path: GeoPath, withHeight: boolean): string {
  return path.map((p) => (withHeight ? `${p.lon},${p.lat},${p.height ?? 0}` : `${p.lon},${p.lat}`)).join(' ');
}

function pointCoord(p: GeoPoint): string {
  return p.height != null ? `${p.lon},${p.lat},${p.height}` : `${p.lon},${p.lat}`;
}

const hasHeights = (path: { height?: number }[]): boolean =>
  path.some((p) => p.height != null && p.height !== 0);

/** KML rings must repeat the opening vertex. `GeoPath` stores them open — see
 *  the note on `GeoPath` — so close them on the way out. */
function closeRing(ring: GeoPath): GeoPath {
  if (ring.length < 3) return ring;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (a.lat === b.lat && a.lon === b.lon && (a.height ?? 0) === (b.height ?? 0)) return ring;
  return [...ring, a];
}

/**
 * A shared `<Style>` reused by every item that draws the same way.
 *
 * Inline styles per Placemark would be simpler to emit but Google Earth builds
 * one style object per Placemark from them, which is why a few thousand
 * imported features can bring the desktop client to a crawl. Deduplicating by
 * value costs one Map.
 */
class StyleTable {
  private readonly ids = new Map<string, string>();
  private readonly bodies: string[] = [];

  /** Returns the style id to reference, or undefined when there is nothing to say. */
  add(body: string): string | undefined {
    if (!body) return undefined;
    const existing = this.ids.get(body);
    if (existing) return existing;
    const id = `atlas-s${this.bodies.length}`;
    this.ids.set(body, id);
    this.bodies.push(`  <Style id="${id}">\n${body}  </Style>\n`);
    return id;
  }

  render(): string {
    return this.bodies.join('');
  }
}

function lineStyleXml(color: string | undefined, width: number | undefined): string {
  const kml = cssToKmlColor(color);
  if (!kml && width == null) return '';
  let out = '    <LineStyle>\n';
  if (kml) out += `      <color>${kml}</color>\n`;
  if (width != null) out += `      <width>${width}</width>\n`;
  out += '    </LineStyle>\n';
  return out;
}

function polyStyleXml(item: Extract<Item, { type: 'polygon' }>): string {
  const fill = cssToKmlColor(item.fillColor ?? '#39c0ff', item.fillOpacity ?? 0.5);
  let out = '    <PolyStyle>\n';
  if (fill) out += `      <color>${fill}</color>\n`;
  // `fillOpacity: 0` and `outlineWidth: 0` are the model's way of saying
  // "outline only" / "no outline"; KML has dedicated booleans for both, and
  // round-tripping through them is what makes those two zeros survive.
  if (item.fillOpacity === 0) out += '      <fill>0</fill>\n';
  if (item.outlineWidth === 0) out += '      <outline>0</outline>\n';
  out += '    </PolyStyle>\n';
  return lineStyleXml(item.outlineColor ?? item.fillColor, item.outlineWidth) + out;
}

function iconStyleXml(color: string | undefined): string {
  const kml = cssToKmlColor(color);
  if (!kml) return '';
  return `    <IconStyle>\n      <color>${kml}</color>\n    </IconStyle>\n`;
}

/** Common Placemark head: id attribute, name, description, time, style ref.
 *  Takes an explicit description so callers can substitute one (a `note`'s
 *  `text`, a 3D asset's uri) without cloning the item just to override a field. */
function placemarkHead(
  item: Item,
  styleId: string | undefined,
  description?: { text?: string; html?: string },
): string {
  const plain = description?.text ?? item.description;
  let out = `  <Placemark id="${xmlId(item.id)}">\n`;
  if (item.title) out += `    <name>${escapeXml(item.title)}</name>\n`;
  if (description?.html) out += `    <description>${cdata(description.html)}</description>\n`;
  else if (plain) out += `    <description>${escapeXml(plain)}</description>\n`;
  out += timeXml(item.time, '    ');
  if (styleId) out += `    <styleUrl>#${styleId}</styleUrl>\n`;
  return out;
}

/** A `photo`/`video` balloon. Google Earth renders HTML in a description, so the
 *  image travels with the placemark instead of becoming a bare pin. */
function mediaBalloon(item: Extract<Item, { type: 'photo' | 'video' }>): string {
  const caption = item.description ?? item.title ?? '';
  const src = item.type === 'photo' ? item.media.thumbnailUrl ?? item.media.url : item.media.posterUrl;
  const parts: string[] = [];
  if (src) parts.push(`<img src="${src}" style="max-width:320px"/>`);
  if (caption) parts.push(`<p>${caption}</p>`);
  // A video can't play in a KML balloon; a link is the honest fallback.
  if (item.type === 'video') parts.push(`<p><a href="${item.media.url}">${item.media.url}</a></p>`);
  return parts.join('');
}

/** An `altitudeMode` block. `clampToGround` + `tessellate` is what makes a 2D
 *  path follow terrain in Google Earth instead of cutting through hillsides. */
function altitudeXml(clamped: boolean, tessellate: boolean): string {
  let out = `      <altitudeMode>${clamped ? 'clampToGround' : 'absolute'}</altitudeMode>\n`;
  if (tessellate && clamped) out += '      <tessellate>1</tessellate>\n';
  return out;
}

/**
 * Serialise a `Story` as a KML 2.2 document.
 *
 * NOT representable, and dropped rather than faked:
 *   - `splat` / `tileset` / `model` geometry. KML's `<Model>` takes COLLADA,
 *     not glTF or 3D Tiles, so pointing it at our asset URIs would produce a
 *     Placemark Google Earth cannot load. They export as a Point at their
 *     placement with the asset URI in the description — locatable, not
 *     renderable — and are skipped entirely when they carry no position.
 *   - Scenes, camera moves, narration, layers, provenance. KML has `<LookAt>`
 *     and tours (`gx:Tour`), but a Story's scene graph is richer than either;
 *     mapping it partially would imply a fidelity that isn't there.
 */
export function storyToKml(story: Story, opts: KmlExportOptions = {}): string {
  const trackAs = opts.trackAs ?? 'gx:Track';
  const styles = new StyleTable();
  const placemarks: string[] = [];

  for (const item of storyEntities(story)) {
    switch (item.type) {
      case 'photo':
      case 'video': {
        placemarks.push(
          placemarkHead(item, undefined, { html: mediaBalloon(item) }) +
            `    <Point><coordinates>${pointCoord(item.position)}</coordinates></Point>\n  </Placemark>\n`,
        );
        break;
      }
      case 'marker': {
        const styleId = styles.add(iconStyleXml(item.color));
        placemarks.push(
          placemarkHead(item, styleId) +
            `    <Point><coordinates>${pointCoord(item.position)}</coordinates></Point>\n  </Placemark>\n`,
        );
        break;
      }
      case 'note': {
        // A note's `text` IS its content and both `title` and `description` are
        // optional on it, so without this fallback a note exports as a nameless,
        // wordless pin.
        placemarks.push(
          placemarkHead(item, undefined, { text: item.description ?? item.text }) +
            `    <Point><coordinates>${pointCoord(item.position)}</coordinates></Point>\n  </Placemark>\n`,
        );
        break;
      }
      case 'line': {
        const styleId = styles.add(lineStyleXml(item.color, item.width));
        const withHeight = hasHeights(item.positions);
        const clamped = item.clampToGround ?? !withHeight;
        placemarks.push(
          placemarkHead(item, styleId) +
            '    <LineString>\n' +
            altitudeXml(clamped, true) +
            `      <coordinates>${coordList(item.positions, withHeight && !clamped)}</coordinates>\n` +
            '    </LineString>\n  </Placemark>\n',
        );
        break;
      }
      case 'polygon': {
        const styleId = styles.add(polyStyleXml(item));
        const withHeight = hasHeights(item.positions);
        const clamped = item.clampToGround ?? !withHeight;
        let geom = '    <Polygon>\n' + altitudeXml(clamped, true);
        geom += `      <outerBoundaryIs><LinearRing><coordinates>${coordList(closeRing(item.positions), withHeight && !clamped)}</coordinates></LinearRing></outerBoundaryIs>\n`;
        for (const hole of item.holes ?? []) {
          geom += `      <innerBoundaryIs><LinearRing><coordinates>${coordList(closeRing(hole), withHeight && !clamped)}</coordinates></LinearRing></innerBoundaryIs>\n`;
        }
        geom += '    </Polygon>\n';
        placemarks.push(placemarkHead(item, styleId) + geom + '  </Placemark>\n');
        break;
      }
      case 'track': {
        const styleId = styles.add(lineStyleXml(item.color, 3));
        // Sort a copy: the CZML converter does the same, and an out-of-order
        // `<when>` list makes Google Earth's time slider jump backwards.
        const path = [...item.path].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
        placemarks.push(placemarkHead(item, styleId) + trackGeometry(path, trackAs) + '  </Placemark>\n');
        break;
      }
      case 'model':
      case 'splat':
      case 'tileset': {
        // See the function doc: KML cannot carry glTF/3D-Tiles/splat geometry,
        // so these degrade to a located pin that names the asset. A splat or
        // tileset with no `position` has nowhere to put that pin and is dropped.
        const { position } = item;
        if (!position) break;
        const uri = item.type === 'model' ? item.gltf : item.type === 'splat' ? item.tileset ?? item.splatUrl : item.tileset;
        const text = [item.description, uri && `3D asset: ${uri}`].filter(Boolean).join('\n');
        placemarks.push(
          placemarkHead(item, undefined, { text: text || undefined }) +
            `    <Point><coordinates>${pointCoord(position)}</coordinates></Point>\n  </Placemark>\n`,
        );
        break;
      }
    }
  }

  const name = opts.name ?? story.title;
  const description = opts.description ?? story.description;

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">\n' +
    '<Document>\n' +
    `  <name>${escapeXml(name)}</name>\n` +
    (description ? `  <description>${escapeXml(description)}</description>\n` : '') +
    styles.render() +
    placemarks.join('') +
    '</Document>\n</kml>\n'
  );
}

function trackGeometry(path: TrackSample[], trackAs: 'gx:Track' | 'LineString'): string {
  const withHeight = hasHeights(path);
  if (trackAs === 'LineString') {
    // The fallback: one interval for the whole path, every intermediate
    // timestamp gone. See `KmlExportOptions.trackAs`.
    const first = path[0]!;
    const last = path[path.length - 1]!;
    const coords = path.map((s) => (withHeight ? `${s.lon},${s.lat},${s.height ?? 0}` : `${s.lon},${s.lat}`)).join(' ');
    return (
      `    <TimeSpan><begin>${iso(first.time)}</begin><end>${iso(last.time)}</end></TimeSpan>\n` +
      '    <LineString>\n' +
      altitudeXml(!withHeight, true) +
      `      <coordinates>${coords}</coordinates>\n` +
      '    </LineString>\n'
    );
  }
  // The gx:Track content model is all `<when>` then all `<gx:coord>`; Google
  // Earth also tolerates them interleaved, but the grouped form is what the
  // gx schema and libkml expect, so emit that.
  let out = '    <gx:Track>\n' + altitudeXml(!withHeight, false);
  for (const s of path) out += `      <when>${iso(s.time)}</when>\n`;
  // `gx:coord` is SPACE separated — unlike `<coordinates>` two lines above.
  for (const s of path) out += `      <gx:coord>${withHeight ? `${s.lon} ${s.lat} ${s.height ?? 0}` : `${s.lon} ${s.lat}`}</gx:coord>\n`;
  out += '    </gx:Track>\n';
  return out;
}
