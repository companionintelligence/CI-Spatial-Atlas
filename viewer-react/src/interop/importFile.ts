/**
 * Turn a dropped or picked file into canonical `Item`s.
 *
 * Everything lands in the `@companion-atlas/story` model rather than straight
 * into Cesium entities. That is the whole point: an imported placemark has to
 * be exportable back to KML, renderable on the WebXR globe, and collectable
 * into a scrapbook, and none of that happens for content that only exists as a
 * Cesium primitive. `storyToCzml` then draws it through the same path as
 * everything else.
 *
 * The React layer never calls the importers directly — it calls `importFiles`
 * and renders whatever comes back, including the failures, which are values
 * here rather than exceptions. A half-failed multi-file drop must still show
 * the files that worked.
 */
import {
  geoJsonToItems,
  kmlToItems,
  loadStory,
  storyEntities,
  KmzUnsupportedError,
  type Item,
} from '@companion-atlas/story';
import { detectFormat, type InteropFormat } from './detectFormat.js';

export interface ImportedFile {
  fileName: string;
  format: InteropFormat;
  items: Item[];
  /** Present when nothing could be read. `items` is empty when it is set. */
  error?: string;
}

export interface ImportResult {
  files: ImportedFile[];
  items: Item[];
  /** True when at least one file yielded no items and no error — a valid
   *  document that simply had nothing locatable in it. Worth saying out loud;
   *  otherwise the UI looks broken. */
  hadEmpty: boolean;
}

/** How much of a file to look at before deciding what it is. Big enough to
 *  clear a KML `<Document>` preamble or a GeoJSON `crs` block. */
const SNIFF_BYTES = 4096;

/**
 * Parse one already-read file. Separated from the File/FileReader plumbing so
 * the format→importer decision is testable without a DOM.
 */
export function importText(fileName: string, text: string, headBytes?: Uint8Array): ImportedFile {
  const format = detectFormat(fileName, text.slice(0, SNIFF_BYTES), headBytes);
  const idPrefix = safeIdPrefix(fileName);

  try {
    switch (format) {
      case 'kml':
        return { fileName, format, items: kmlToItems(text, { idPrefix }) };

      case 'geojson':
        return { fileName, format, items: geoJsonToItems(JSON.parse(text), { idPrefix }) };

      case 'story': {
        // A story document is a legitimate thing to drop — it is what this app
        // exports. Normalise it through loadStory (which accepts the legacy
        // Atlas and CI-Earth-2 shapes too) and take its entities, so dropping a
        // story merges its content rather than replacing the whole view.
        const story = loadStory(JSON.parse(text));
        return { fileName, format, items: storyEntities(story) };
      }

      case 'kmz':
        return {
          fileName,
          format,
          items: [],
          error:
            'KMZ archives are not supported yet. Unzip it and import the doc.kml inside.',
        };

      default:
        return {
          fileName,
          format,
          items: [],
          error: "Not a KML, GeoJSON or Atlas story file. Check the file's contents, not just its name.",
        };
    }
  } catch (err) {
    // The KML importer throws a typed error for KMZ even when the extension
    // lied, so surface its own message — it names the fix.
    if (err instanceof KmzUnsupportedError) {
      return { fileName, format: 'kmz', items: [], error: err.message };
    }
    return { fileName, format, items: [], error: describe(err) };
  }
}

/** Read and import a batch. Never rejects: per-file failures are reported in
 *  the result so one bad file in a multi-file drop does not lose the rest. */
export async function importFiles(files: readonly File[]): Promise<ImportResult> {
  const results = await Promise.all(
    files.map(async (file): Promise<ImportedFile> => {
      try {
        // Read the head as bytes first: a ZIP has to be caught before we try to
        // decode it as UTF-8, where the magic bytes turn into replacement
        // characters and the sniff fails.
        const headBytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        const text = await file.text();
        return importText(file.name, text, headBytes);
      } catch (err) {
        return { fileName: file.name, format: 'unknown', items: [], error: describe(err) };
      }
    }),
  );

  return {
    files: results,
    items: results.flatMap((r) => r.items),
    hadEmpty: results.some((r) => !r.error && r.items.length === 0),
  };
}

/**
 * Item ids must stay unique across imports — dropping the same file twice, or
 * two files that both use `<Placemark id="1">`, would otherwise collide and the
 * second silently win in any id-keyed lookup. Deriving the prefix from the file
 * name keeps ids readable while making collisions require the same file name
 * *and* the same inner id.
 *
 * Kept NCName-safe (letters, digits, `-`, `_`, `.`, not leading with a digit)
 * because these ids go back out through `storyToKml`, where `xsd:ID` rejects
 * anything else.
 */
export function safeIdPrefix(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const cleaned = stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z_]+/, '');
  return cleaned.slice(0, 40) || 'import';
}

function describe(err: unknown): string {
  if (err instanceof SyntaxError) return `Not valid JSON — ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
