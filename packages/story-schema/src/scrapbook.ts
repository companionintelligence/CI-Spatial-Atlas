/**
 * Scrapbooking: turn collected memories into a canonical `Story` — the unit that
 * plays on the globe, saves back into Companion Memory (social sharing rides the
 * event's `sharingLevel`), and carries agent provenance when a curator built it.
 *
 * `ScrapbookEntry` is deliberately plain data (no viewer types) so agents and
 * other surfaces can call these too.
 */
import { STORY_SCHEMA_ID, type MediaItem, type Story, type Visibility } from './schema.js';
import { loadStory } from './normalize.js';

export interface ScrapbookEntry {
  id: string;
  title: string;
  narrative?: string;
  /** Human place label ("Reykjavík, Iceland"). */
  place?: string;
  timeMs: number;
  lat?: number;
  lon?: number;
  people?: string[];
  media?: { url?: string; thumbnailUrl?: string; kind?: 'image' | 'video' | 'image-set' };
}

export interface ScrapbookOptions {
  id?: string;
  title?: string;
  visibility?: Visibility;
  /** Set when a curator (not the user by hand) assembled the story. */
  curatedBy?: string;
}

const isHttp = (u?: string): u is string => !!u && /^https?:\/\//i.test(u);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function day(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Reykjavík → San Francisco · Mar 14–20, 2026" (falls back gracefully). */
export function journeyTitle(entries: ScrapbookEntry[]): string {
  if (entries.length === 0) return 'My journey';
  const sorted = [...entries].sort((a, b) => a.timeMs - b.timeMs);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const from = (first.place ?? first.title).split(',')[0]!.trim();
  const to = (last.place ?? last.title).split(',')[0]!.trim();
  const a = new Date(first.timeMs);
  const b = new Date(last.timeMs);
  const year = b.getUTCFullYear();
  const range = day(first.timeMs) === day(last.timeMs)
    ? `${day(first.timeMs)}, ${year}`
    : a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()
      ? `${day(first.timeMs)}–${b.getUTCDate()}, ${year}` // same month: "Mar 14–20"
      : `${day(first.timeMs)}–${day(last.timeMs)}, ${year}`;
  const arc = from === to ? from : `${from} → ${to}`;
  return `${arc} · ${range}`;
}

/** Local-solar time-of-day word at a longitude (≈1h per 15°). */
function todWord(ms: number, lon?: number): string {
  const h = new Date(ms + ((lon ?? 0) / 15) * 3_600_000).getUTCHours();
  if (h < 6 || h >= 20) return 'Night';
  if (h < 8) return 'Dawn';
  if (h < 17) return 'Daylight';
  return 'Dusk';
}

/** Build a valid, renderable `Story` from collected entries (chronological). */
export function buildScrapbookStory(entries: ScrapbookEntry[], opts: ScrapbookOptions = {}): Story {
  const sorted = [...entries].sort((a, b) => a.timeMs - b.timeMs);
  const visibility = opts.visibility ?? 'private';
  const id = opts.id ?? `scrapbook-${sorted[0]?.id ?? 'empty'}-${sorted.length}`;

  const media: MediaItem[] = [];
  for (const e of sorted) {
    if (e.lat == null || e.lon == null) continue;
    const uri = isHttp(e.media?.url) ? e.media!.url! : isHttp(e.media?.thumbnailUrl) ? e.media!.thumbnailUrl! : undefined;
    if (!uri) continue; // scene still carries the place via its camera
    media.push({
      id: `sb-media-${e.id}`,
      kind: e.media?.kind === 'video' ? 'video' : 'image',
      uri,
      thumbnailUri: isHttp(e.media?.thumbnailUrl) ? e.media!.thumbnailUrl : undefined,
      caption: e.title,
      description: e.narrative,
      locationName: e.place,
      capturedAt: new Date(e.timeMs).toISOString(),
      location: { lat: e.lat, lon: e.lon },
      people: e.people,
    });
  }

  const scenes = sorted.map((e) => ({
    id: `sb-${e.id}`,
    title: e.title,
    narrative: e.narrative,
    time: new Date(e.timeMs).toISOString(),
    ...(e.lat != null && e.lon != null
      ? { camera: { location: { lat: e.lat, lon: e.lon }, range: 1_800_000 } }
      : {}),
  }));

  const timeline = sorted.length
    ? { start: new Date(sorted[0]!.timeMs).toISOString(), stop: new Date(sorted[sorted.length - 1]!.timeMs).toISOString() }
    : undefined;

  return loadStory({
    schema: STORY_SCHEMA_ID,
    id,
    title: opts.title ?? journeyTitle(sorted),
    visibility,
    access: { visibility },
    ...(timeline ? { timeline } : {}),
    media,
    scenes,
    provenance: opts.curatedBy
      ? { kind: 'ci-memory', source: 'companion-atlas', agent: opts.curatedBy }
      : { kind: 'manual', source: 'companion-atlas' },
  });
}

/**
 * The on-device curator: fill in missing narratives from what the memory knows
 * (place + local solar time), title the journey, and stamp agent provenance.
 * Deterministic and local — the hook where a Companion LLM curator plugs in.
 */
export function curateJourney(entries: ScrapbookEntry[], opts: Omit<ScrapbookOptions, 'curatedBy'> = {}): Story {
  const sorted = [...entries].sort((a, b) => a.timeMs - b.timeMs);
  const narrated = sorted.map((e, i) => ({
    ...e,
    narrative:
      e.narrative ??
      `${todWord(e.timeMs, e.lon)}${e.place ? ` over ${e.place}` : ''} — stop ${i + 1} of ${sorted.length} on this journey.`,
  }));
  return buildScrapbookStory(narrated, { ...opts, title: opts.title ?? journeyTitle(narrated), curatedBy: 'atlas-curator' });
}
