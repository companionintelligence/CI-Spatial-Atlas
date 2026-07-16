/**
 * Derive the redesign shell's view-model from a loaded Story. The Story is the
 * same 4D unit CI-Server Memory produces (docs/REDESIGN.md); here we shape it
 * into the stats / scrapbook / inspector / time-machine the UI renders.
 */
import { storyEntities, timelineBounds, sceneNarrative, type Story } from '@companion-atlas/story';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

export interface AtlasMemory {
  id: string;
  title: string;
  narrative?: string;
  timeMs: number;
  whenDate: string; // "Jun 17, 2019"
  whenTime: string; // "7:41 PM" — local solar time at the memory's place
  tod: TimeOfDay;
  lat?: number;
  lon?: number;
  place?: string;
  gradient: string; // placeholder "photo" tint (real thumbnails arrive with CI-Server media)
}

export interface AtlasModel {
  title: string;
  stats: { memories: number; places: number; years: number };
  memories: AtlasMemory[];
  focused: AtlasMemory | null;
  timeline: { startMs: number; stopMs: number; ticks: { label: string; hot: boolean }[] };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GRADIENTS = [
  'linear-gradient(135deg,#0d5f67,#1c8791 60%,#72ddd4)',
  'linear-gradient(150deg,#0a222e,#ff8d6e 130%)',
  'linear-gradient(135deg,#0a222e,#2c676d,#abd4d8)',
  'linear-gradient(135deg,#123,#ffb27a)',
  'linear-gradient(135deg,#0d5f67,#b79cff)',
];

export function timeOfDay(hour: number): TimeOfDay {
  if (hour < 6 || hour >= 20) return 'night';
  if (hour < 8) return 'dawn';
  if (hour < 17) return 'day';
  return 'dusk';
}

/**
 * Format an instant as the *local solar* wall-clock at a given longitude
 * (≈ 1 hour per 15°), so the time-of-day cue matches the globe's day/night
 * terminator instead of the viewer's browser timezone. Reads the UTC fields of
 * a longitude-shifted instant, which keeps it independent of where the app runs.
 */
export function solarLocal(ms: number, lon?: number): { whenDate: string; whenTime: string; tod: TimeOfDay } {
  const shiftMs = ((lon ?? 0) / 15) * 3_600_000;
  const d = new Date(ms + shiftMs);
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    whenDate: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
    whenTime: `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`,
    tod: timeOfDay(h),
  };
}

type TimeLike = string | { at?: string; start?: string; end?: string; stop?: string } | undefined;
function timeSpecMs(t: TimeLike): number {
  const iso = typeof t === 'string' ? t : (t?.at ?? t?.start);
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

export function deriveModel(story: Story): AtlasModel {
  const entities = storyEntities(story);
  const bounds = timelineBounds(story);
  const startMs = Date.parse(bounds.start);
  const stopMs = Date.parse(bounds.stop);

  // Scenes are the narrative "memories" (sorted chronologically = journey order).
  const scenes = [...story.scenes].sort((a, b) => timeSpecMs(a.time) - timeSpecMs(b.time));
  let memories: AtlasMemory[] = scenes.map((sc, i) => {
    const ms = timeSpecMs(sc.time);
    const loc = sc.camera?.location;
    const t = Number.isFinite(ms) ? ms : startMs;
    return {
      id: sc.id,
      title: sc.title ?? `Memory ${i + 1}`,
      narrative: sceneNarrative(sc),
      timeMs: t,
      ...solarLocal(t, loc?.lon),
      lat: loc?.lat,
      lon: loc?.lon,
      place: sc.title,
      gradient: GRADIENTS[i % GRADIENTS.length]!,
    };
  });

  // Fallback: a CI-Server memory query yields located media/markers with no
  // authored scenes — project those entities into memories so the scrapbook,
  // inspector, and Time Machine still populate (rather than an empty shell that
  // the stats header claims has N memories).
  if (memories.length === 0) {
    const located: { id: string; title?: string; description?: string; lat: number; lon: number; ms: number }[] = [];
    for (const e of entities) {
      const pos = 'position' in e ? e.position : undefined;
      const ms = timeSpecMs(e.time);
      if (pos && Number.isFinite(ms)) located.push({ id: e.id, title: e.title, description: e.description, lat: pos.lat, lon: pos.lon, ms });
    }
    located.sort((a, b) => a.ms - b.ms);
    memories = located.map((x, i) => ({
      id: x.id,
      title: x.title ?? `Memory ${i + 1}`,
      narrative: x.description,
      timeMs: x.ms,
      ...solarLocal(x.ms, x.lon),
      lat: x.lat,
      lon: x.lon,
      place: x.title,
      gradient: GRADIENTS[i % GRADIENTS.length]!,
    }));
  }

  const places = new Set<string>();
  for (const e of entities) {
    if ('position' in e && e.position) places.add(`${e.position.lat.toFixed(1)},${e.position.lon.toFixed(1)}`);
  }
  const years = Number.isFinite(startMs) && Number.isFinite(stopMs)
    ? Math.max(1, new Date(stopMs).getFullYear() - new Date(startMs).getFullYear() + 1)
    : 1;

  // Timeline axis ticks (evenly spaced across the span).
  const ticks: { label: string; hot: boolean }[] = [];
  if (Number.isFinite(startMs) && Number.isFinite(stopMs) && stopMs > startMs) {
    const span = stopMs - startMs;
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const d = new Date(startMs + (span * i) / n);
      ticks.push({ label: `${MONTHS[d.getMonth()]} ${d.getDate()}`, hot: i === n - 1 });
    }
  }

  return {
    title: story.title,
    stats: { memories: Math.max(memories.length, entities.length), places: places.size, years },
    memories,
    focused: memories[memories.length - 1] ?? memories[0] ?? null,
    timeline: { startMs, stopMs, ticks },
  };
}
