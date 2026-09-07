/**
 * Companion Memory as an interop peer of files — the DOM-free half.
 *
 * `src/memory/import.ts` and `src/memory/export.ts` are the real transfer; this
 * module is everything that stands between them and a form: turning the strings
 * an `<input>` produces into the filter the importer takes, and turning the
 * progress/warning/lossy shapes those modules return into sentences a person
 * can read.
 *
 * It lives apart from the component on purpose. The viewer's suite has no DOM
 * (no jsdom, no testing-library — see `viewer-react/test/`), so anything that
 * only exists inside a `.tsx` is untestable here, and the parts of this feature
 * that are actually easy to get wrong — the end-of-day boundary, a half-typed
 * bounding box — are exactly the parts worth a test.
 */
import type { Story } from '@companion-atlas/story';
import type { MemorySource } from '../memory/client.js';
import {
  importFromMemory,
  type MemoryImport,
  type MemoryImportFilter,
  type MemoryImportPhase,
  type MemoryImportProgress,
} from '../memory/import.js';
import {
  exportStoryToMemory,
  type MemoryExportProgress,
  type MemoryExportResult,
} from '../memory/export.js';

// ---------------------------------------------------------------------------
// The form's own state
// ---------------------------------------------------------------------------

/**
 * The filter as the form holds it: strings, because that is what an `<input>`
 * gives back and because a half-typed number has to survive a re-render.
 * `start`/`end` are `<input type="date">` values (`YYYY-MM-DD`); the four edges
 * are decimal degrees.
 */
export interface MemoryFilterDraft {
  start: string;
  end: string;
  west: string;
  south: string;
  east: string;
  north: string;
}

export const EMPTY_MEMORY_FILTER: MemoryFilterDraft = {
  start: '', end: '', west: '', south: '', east: '', north: '',
};

/** True when the user has narrowed nothing — the "import my entire life" case,
 *  which the panel warns about rather than quietly running. */
export function isUnfiltered(draft: MemoryFilterDraft): boolean {
  return Object.values(draft).every((v) => v.trim() === '');
}

export interface ParsedMemoryFilter {
  filter: MemoryImportFilter;
  /** Reasons this draft cannot be sent. Non-empty means do not import. */
  problems: string[];
}

const DEGREES = /^[-+]?\d+(\.\d+)?$/;

/**
 * Turn the draft into a `MemoryImportFilter`, or into the reasons it isn't one.
 *
 * Two decisions here are load-bearing:
 *
 * 1. **A day is inclusive at both ends, in UTC.** `<input type="date">` yields a
 *    bare date; sending it as `2019-06-30` makes CI-Server's `endTime` compare
 *    against midnight, so every memory on the last day of a trip falls outside
 *    the window the user just typed. Widening to `23:59:59.999` fixes that. UTC
 *    rather than the browser's zone because the server compares ISO strings on a
 *    column stored in UTC — converting through local time would silently shift
 *    the window by the viewer's offset, differently for every user, which is the
 *    kind of wrong nobody ever sees.
 * 2. **A partial box is an error, not a hint.** `validBbox()` in the importer
 *    drops a malformed box and carries on, and a server handed no box returns
 *    *everything* — so three-quarters of a bounding box reads to the user as
 *    "the area filter did nothing". Refuse it here, where we can name the field.
 */
export function parseMemoryFilter(draft: MemoryFilterDraft): ParsedMemoryFilter {
  const problems: string[] = [];
  const filter: MemoryImportFilter = {};

  const start = draft.start.trim();
  const end = draft.end.trim();
  if (start) filter.start = `${start}T00:00:00.000Z`;
  if (end) filter.end = `${end}T23:59:59.999Z`;
  if (start && end && start > end) {
    // Lexical comparison is exact for `YYYY-MM-DD`, and cheaper than two Dates.
    problems.push('The start date is after the end date.');
  }

  const edges: { key: keyof MemoryFilterDraft; label: string; limit: number }[] = [
    { key: 'west', label: 'West', limit: 180 },
    { key: 'south', label: 'South', limit: 90 },
    { key: 'east', label: 'East', limit: 180 },
    { key: 'north', label: 'North', limit: 90 },
  ];
  const filled = edges.filter((e) => draft[e.key].trim() !== '');
  if (filled.length > 0 && filled.length < 4) {
    problems.push('Give all four edges of the area, or none — a partial box would import everything.');
  } else if (filled.length === 4) {
    const values: number[] = [];
    for (const e of edges) {
      const raw = draft[e.key].trim();
      const n = DEGREES.test(raw) ? Number(raw) : NaN;
      if (!Number.isFinite(n)) problems.push(`${e.label} is not a number of degrees.`);
      else if (Math.abs(n) > e.limit) problems.push(`${e.label} must be between -${e.limit} and ${e.limit}.`);
      values.push(n);
    }
    const [w, s, e2, n2] = values as [number, number, number, number];
    if (Number.isFinite(s) && Number.isFinite(n2) && s > n2) {
      problems.push('South is north of North.');
    }
    // West > east is deliberately allowed: that is a box crossing the
    // antimeridian, which CI-Server's PostGIS predicate handles. Latitude has no
    // such wrap, hence the asymmetry — same rule as `validBbox()` in the importer.
    if (problems.length === 0) filter.bbox = [w, s, e2, n2];
  }

  return { filter, problems };
}

// ---------------------------------------------------------------------------
// Progress, in words
// ---------------------------------------------------------------------------

const PHASE_LABEL: Record<MemoryImportPhase, string> = {
  places: 'Places',
  memories: 'Memories',
  stories: 'Saved stories',
};

/**
 * One line for the current phase. The count is the point: a multi-minute import
 * with no numbers on screen is indistinguishable from a hung one, and the
 * importer's own bounds (50 pages, 5000 rows) mean "still going" is a real and
 * legitimate state for a while.
 */
export function importProgressLabel(p: MemoryImportProgress): string {
  const what = PHASE_LABEL[p.phase];
  const count = typeof p.total === 'number' && p.total > 0
    ? `${p.loaded} of ${p.total}`
    : `${p.loaded}`;
  // Page number only once it means something. "(page 1)" on every one-page
  // import is noise that trains the eye to skip the whole line.
  const page = p.page > 1 ? ` · page ${p.page}` : '';
  return `${what} — ${count}${page}`;
}

/** 0–100 for a determinate bar, or null when the server reported no total (in
 *  which case the caller should show an indeterminate one rather than lie). */
export function importProgressPercent(p: MemoryImportProgress): number | null {
  if (typeof p.total !== 'number' || p.total <= 0) return null;
  // A server's `totalCount` can lag the rows it is handing back; clamp rather
  // than render a bar past its own end.
  return Math.max(0, Math.min(100, Math.round((p.loaded / p.total) * 100)));
}

export function exportProgressLabel(p: MemoryExportProgress): string {
  const what = p.phase === 'story' ? 'Story' : p.phase === 'media' ? 'Media' : 'Places';
  return `${what} — ${p.written} of ${p.total}`;
}

// ---------------------------------------------------------------------------
// Results, in words
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What actually arrived. Reads off `stats` rather than the story, because the
 * two disagree in a way that matters: `stats.markers` counts entities restored
 * from a previous Atlas export as well as plain located memories.
 */
export function importSummary(r: MemoryImport): string {
  if (!r.connected) return r.error ?? 'Could not reach Companion Memory.';
  const parts: string[] = [];
  if (r.stats.media) parts.push(plural(r.stats.media, 'photo'));
  if (r.stats.markers) parts.push(plural(r.stats.markers, 'pin'));
  if (r.stats.places) parts.push(plural(r.stats.places, 'place'));
  if (r.stats.stories) parts.push(plural(r.stats.stories, 'saved story', 'saved stories'));
  // An archive legitimately has zero located rows, and that is a different
  // sentence from "not connected" — see `MemoryImport.connected`.
  return parts.length ? parts.join(' · ') : 'Nothing located to import.';
}

/**
 * The sentence that goes with `stats.truncated`. Separate from `warnings`
 * because the importer only warns about truncation in the memories phase, and
 * because this one needs to say what to *do* about it.
 */
export function truncationNote(r: MemoryImport): string | null {
  if (!r.stats.truncated) return null;
  return `This is a partial import — it stopped at ${plural(r.stats.pages, 'page')}. ` +
    'Narrow the dates or the area to bring in the rest.';
}

export function exportSummary(r: MemoryExportResult): string {
  if (!r.ok) return r.error ?? 'Companion Memory did not confirm the save.';
  const parts = ['Saved to Companion Memory'];
  if (r.mediaEventIds.length) parts.push(plural(r.mediaEventIds.length, 'media event'));
  if (r.placeIds.length) parts.push(plural(r.placeIds.length, 'place row'));
  if (r.failed.length) parts.push(`${plural(r.failed.length, 'entity', 'entities')} the server refused`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------

/** A refused draft never reaches the network — see `parseMemoryFilter`. */
export type MemoryImportOutcome =
  | { ok: true; result: MemoryImport }
  | { ok: false; problems: string[] };

export interface RunImportOptions {
  signal?: AbortSignal;
  onProgress?: (p: MemoryImportProgress) => void;
}

/**
 * Validate the form, then import. Resolves — never rejects — because
 * `importFromMemory` doesn't either, and a click handler that can reject is an
 * unhandled rejection waiting for a slow server.
 */
export async function importFilteredMemory(
  src: MemorySource,
  draft: MemoryFilterDraft,
  opts: RunImportOptions = {},
): Promise<MemoryImportOutcome> {
  const { filter, problems } = parseMemoryFilter(draft);
  if (problems.length) return { ok: false, problems };
  const result = await importFromMemory(src, {
    ...filter,
    signal: opts.signal,
    onProgress: opts.onProgress,
  });
  return { ok: true, result };
}

export interface RunExportOptions {
  signal?: AbortSignal;
  onProgress?: (p: MemoryExportProgress) => void;
  /** The roster from the last import. `exportStoryToMemory` derives one from the
   *  story's own fields when this is absent, but the imported roster is better:
   *  it carries server place ids and names the story never learned. */
  places?: MemoryImport['places'];
  /** Public link stored on the event for the household feed. Must already be
   *  scrubbed of `?memory=`/`?token=` — that is the caller's job, not ours. */
  shareUrl?: string;
}

export async function exportStoryWithReport(
  src: MemorySource,
  story: Story,
  opts: RunExportOptions = {},
): Promise<MemoryExportResult> {
  return exportStoryToMemory(src, story, {
    shareUrl: opts.shareUrl,
    places: opts.places,
    signal: opts.signal,
    onProgress: opts.onProgress,
  });
}
