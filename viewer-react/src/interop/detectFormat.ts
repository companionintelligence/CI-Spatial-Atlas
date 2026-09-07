/**
 * Work out what a dropped file actually is, before handing it to an importer.
 *
 * Extensions are a hint, not evidence: people rename `.json` to `.geojson` and
 * back, browsers report an empty `type` for both, and a KMZ dropped as `.kml`
 * is common enough that `@companion-atlas/story`'s KML importer has a dedicated
 * error for it. So sniff the bytes and let the extension only break ties.
 *
 * This is deliberately separate from the React layer so the decision table is
 * testable without a DOM — the same reason the xr-* suites keep their geometry
 * in plain modules.
 */

export type InteropFormat =
  | 'kml'
  | 'geojson'
  | 'story'
  | 'kmz'
  /** A photo or video uploaded through `MediaUploadSection`, which joins the
   *  imported list so it is listed, removable and merged by the same code.
   *  Never returned by `detectFormat` — nothing sniffs its way to this. */
  | 'media'
  | 'unknown';

/** ZIP local-file-header magic, `PK\003\004`. KMZ is a ZIP, and so is every
 *  other archive someone might drop; the KML importer rejects these with a
 *  message naming KMZ, and we want to reach that message rather than feed
 *  binary to an XML parser. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function looksLikeZip(head: Uint8Array): boolean {
  return ZIP_MAGIC.every((b, i) => head[i] === b);
}

/**
 * `text` is the leading slice of the file — a few KB is plenty, and reading
 * only the head keeps a 200 MB GeoJSON from being decoded twice.
 */
export function detectFormat(fileName: string, head: string, headBytes?: Uint8Array): InteropFormat {
  if (headBytes && headBytes.length >= 4 && looksLikeZip(headBytes)) return 'kmz';

  const name = fileName.toLowerCase();
  const trimmed = head.trimStart();

  // XML first: a KML document always has a <kml> root, but it may be preceded
  // by a declaration, a BOM (already stripped by trimStart for our purposes),
  // or comments. Matching on the root element rather than the declaration
  // avoids claiming every XML file is KML.
  if (/^<\?xml|^<kml[\s>]/i.test(trimmed)) {
    if (/<kml[\s>]/i.test(head)) return 'kml';
    return 'unknown';
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    // A Companion Atlas story is also JSON, and importing one as GeoJSON would
    // silently produce zero items. The schema id is the discriminator, and it
    // appears early in the document.
    if (/"schema"\s*:\s*"companion\.atlas\/story@1"/.test(head)) return 'story';
    if (/"type"\s*:\s*"(Feature|FeatureCollection|Point|LineString|Polygon|Multi\w+|GeometryCollection)"/.test(head)) {
      return 'geojson';
    }
    // Valid JSON we can't identify from the head. Fall back to the extension
    // rather than refusing — a FeatureCollection whose `type` sits after a
    // large `properties` block is real, and the importer will tell us if not.
    if (name.endsWith('.geojson')) return 'geojson';
    if (name.endsWith('.json')) return 'geojson';
    return 'unknown';
  }

  if (name.endsWith('.kml')) return 'kml';
  if (name.endsWith('.kmz')) return 'kmz';
  if (name.endsWith('.geojson')) return 'geojson';

  return 'unknown';
}

/** File-picker `accept` value. `.json` is included because GeoJSON is very
 *  often saved that way, and `detectFormat` separates a story from a
 *  FeatureCollection by content. */
export const INTEROP_ACCEPT = '.kml,.kmz,.geojson,.json,application/geo+json,application/vnd.google-earth.kml+xml';
