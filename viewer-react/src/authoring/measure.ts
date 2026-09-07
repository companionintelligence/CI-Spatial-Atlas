import type { GeoPath } from '@companion-atlas/story';
import { dedupePath, pathLengthMeters, ringAreaMeters, ringSelfIntersects } from './geometry.js';

/**
 * Measuring — asking the globe a question, without answering it in the story.
 *
 * ## Why this is not a drawing tool with the save turned off
 *
 * The drawing tools already computed everything a tape measure needs:
 * `pathLengthMeters` and `ringAreaMeters` are exact, and `snapshot()` surfaces
 * both while a shape is being drawn. What was missing was the ability to ask
 * "how far is it from here to there" **without committing an `Item`** — the only
 * way to get a number out of the app was to draw a line, read the toolbar, and
 * then delete the line again. People do not delete the line. They save the
 * story, and a scratch line drawn to check a distance ships to whoever the story
 * is shared with, exports to KML, and comes back the next time the story is
 * opened.
 *
 * So a `Measurement` is deliberately NOT an `Item` and has no id. It cannot be
 * upserted into the item list, it is not in `exportStory`, and there is no code
 * path from here into `mergeAuthoredItems`. That is enforced by construction
 * rather than by a flag someone could forget to check: this type has no `type`
 * field and no `source`, so it would not survive `Item.parse`.
 *
 * ## How long a measurement lives
 *
 * **For the session, until it is replaced or cleared — surviving a tool change,
 * and never written to storage.**
 *
 * Both halves of that are deliberate. It survives a tool change because the
 * whole reason to measure is usually to then *do* something with the number:
 * measure a 200 m setback, then switch to the polygon tool and draw the parcel
 * that respects it. A measurement that evaporated the moment you armed another
 * tool would have to be re-drawn every single time, which is the same as not
 * having the feature.
 *
 * It is never persisted (not to `localStorage` via `persist.ts`, not to the
 * story) because a measurement that reappeared after a reload — drawn on the
 * same globe, in the same layer as real work — would read as content the user
 * authored and then forgot about. A question you asked yesterday is not an
 * annotation. Disarming the authoring surface entirely drops it for the same
 * reason.
 *
 * Only ONE measurement is retained at a time: the newest replaces the previous.
 * A pile of stale measurements accumulating over a globe is indistinguishable
 * from drawn content, which is exactly the confusion this module exists to
 * avoid.
 *
 * ## Units
 *
 * One setting (`MeasureUnits`), threaded through `formatLength`/`formatArea`,
 * and nothing else in the feature converts anything. Every stored and computed
 * value stays in metres and square metres — the conversion happens once, at the
 * moment a number becomes a string for a human. Scattering `* 3.28` through
 * call sites is how a readout ends up disagreeing with the label on the globe.
 */

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export type MeasureUnits = 'metric' | 'imperial';

/** In toolbar order. */
export const MEASURE_UNITS: readonly MeasureUnits[] = ['metric', 'imperial'];

export const UNIT_LABEL: Record<MeasureUnits, string> = {
  metric: 'Metric',
  imperial: 'Imperial',
};

/** Short form for a two-state toggle where space is 40 px. */
export const UNIT_SHORT: Record<MeasureUnits, string> = {
  metric: 'm / km',
  imperial: 'ft / mi',
};

// Exact definitions, not approximations: the international foot is defined as
// 0.3048 m exactly and everything else below derives from it, so a length
// converted out and back is bit-stable rather than drifting by a millimetre per
// round trip.
const METRES_PER_FOOT = 0.3048;
const METRES_PER_MILE = 1609.344;
const SQ_METRES_PER_SQ_FOOT = METRES_PER_FOOT * METRES_PER_FOOT;
const SQ_METRES_PER_ACRE = 4046.8564224;
const SQ_METRES_PER_SQ_MILE = METRES_PER_MILE * METRES_PER_MILE;

/**
 * Metres → a human string.
 *
 * The metric branch is the one the drawing toolbar has always used, moved here
 * unchanged so there is one formatter rather than two that drift apart. The
 * precision ladder (whole metres below a kilometre, two decimals below ten,
 * one above) is about honesty as much as tidiness: a hand-clicked vertex is
 * accurate to roughly a pixel of terrain, so `1.4837 km` would be claiming
 * precision the input never had.
 */
export function formatLength(metres: number, units: MeasureUnits = 'metric'): string {
  if (!Number.isFinite(metres) || metres <= 0) return units === 'imperial' ? '0 ft' : '0 m';
  if (units === 'imperial') {
    const feet = metres / METRES_PER_FOOT;
    if (metres < METRES_PER_MILE) return `${Math.round(feet)} ft`;
    const miles = metres / METRES_PER_MILE;
    return `${miles.toFixed(miles < 10 ? 2 : 1)} mi`;
  }
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 2 : 1)} km`;
}

/** Square metres → a human string. Hectares and acres are the units land is
 *  actually described in, so a mid-sized area gets those rather than a six-digit
 *  count of square metres nobody can picture. */
export function formatArea(squareMetres: number, units: MeasureUnits = 'metric'): string {
  if (!Number.isFinite(squareMetres) || squareMetres <= 0) return units === 'imperial' ? '0 ft²' : '0 m²';
  if (units === 'imperial') {
    if (squareMetres < SQ_METRES_PER_ACRE) return `${Math.round(squareMetres / SQ_METRES_PER_SQ_FOOT)} ft²`;
    if (squareMetres < SQ_METRES_PER_SQ_MILE) return `${(squareMetres / SQ_METRES_PER_ACRE).toFixed(2)} ac`;
    return `${(squareMetres / SQ_METRES_PER_SQ_MILE).toFixed(2)} mi²`;
  }
  if (squareMetres < 10_000) return `${Math.round(squareMetres)} m²`;
  if (squareMetres < 1_000_000) return `${(squareMetres / 10_000).toFixed(2)} ha`;
  return `${(squareMetres / 1_000_000).toFixed(2)} km²`;
}

// ---------------------------------------------------------------------------
// The measurement itself
// ---------------------------------------------------------------------------

/** Two points is the least that can answer "how far". */
export const MIN_MEASURE_POINTS = 2;

/** Three is the least that encloses anything, so it is where area appears. */
export const MIN_MEASURE_RING_POINTS = 3;

/**
 * A completed measurement. Note what is *not* here: no id, no `type`, no
 * `source`, no style. It is a reading, not a thing on the map that belongs to
 * anybody — see the header.
 */
export interface Measurement {
  /** The points as clicked, de-duplicated. Kept so it can be drawn back. */
  points: GeoPath;
  /** Distance along the open path, metres. This is the answer to "how far from
   *  here to there" — the closing segment of a ring is not walked. */
  lengthMeters: number;
  /** Area of the ring the path would close into, square metres. Zero below
   *  three points, and zero when the ring crosses itself (see `crosses`). */
  areaMeters: number;
  /** Perimeter of that closed ring, metres. Zero when there is no ring. Kept
   *  separate from `lengthMeters` because they are different questions and
   *  reporting one as the other is how a fence gets ordered short by one side. */
  perimeterMeters: number;
  /** The ring crosses itself, so `areaMeters` would be meaningless and is 0.
   *  Reported rather than silently returning a plausible-looking number — the
   *  spherical-excess sum happily returns *something* for a bow-tie. */
  crosses: boolean;
}

/**
 * Points → a `Measurement`, or `null` when there is not enough to measure.
 *
 * `null` rather than a zeroed measurement, so a caller cannot render "0 m" for
 * a single click and have it read as a real answer.
 */
export function measurementOf(points: GeoPath): Measurement | null {
  const pts = dedupePath(points);
  if (pts.length < MIN_MEASURE_POINTS) return null;

  const lengthMeters = pathLengthMeters(pts);
  if (pts.length < MIN_MEASURE_RING_POINTS) {
    return { points: pts, lengthMeters, areaMeters: 0, perimeterMeters: 0, crosses: false };
  }

  // Closing the ring can take the count back below three — three clicks whose
  // last landed on the first is a there-and-back line, not a triangle. Measured
  // as a path, then, rather than reporting the zero area a degenerate ring
  // would otherwise produce alongside a confident-looking perimeter.
  const ring = dedupePath(pts, { ring: true });
  if (ring.length < MIN_MEASURE_RING_POINTS) {
    return { points: pts, lengthMeters, areaMeters: 0, perimeterMeters: 0, crosses: false };
  }

  const crosses = ringSelfIntersects(ring);
  return {
    points: pts,
    lengthMeters,
    // A bow-tie's "area" is the signed lobes cancelling each other out. It is a
    // number, it is not an area, and printing it would be worse than printing
    // nothing — so it is refused here and the caller says why.
    areaMeters: crosses ? 0 : ringAreaMeters(ring),
    perimeterMeters: pathLengthMeters([...ring, ring[0]!]),
    crosses,
  };
}

/**
 * One line a person can read: `"1.24 km"`, or `"3.40 ha · 1.24 km around"`.
 *
 * Used verbatim by both the toolbar readout and the label drawn on the globe,
 * so the two cannot disagree — which they would within a week if each formatted
 * its own.
 */
export function describeMeasurement(m: Measurement | null, units: MeasureUnits = 'metric'): string {
  if (!m) return '';
  const parts: string[] = [];
  if (m.areaMeters > 0) {
    parts.push(formatArea(m.areaMeters, units));
    parts.push(`${formatLength(m.perimeterMeters, units)} around`);
  } else {
    parts.push(formatLength(m.lengthMeters, units));
  }
  return parts.join(' · ');
}

/** The warning a measured ring earns, or null. Kept beside the maths rather
 *  than in the toolbar so the globe label and the panel say the same thing. */
export function measurementWarning(m: Measurement | null): string | null {
  if (!m) return null;
  return m.crosses ? 'This outline crosses itself — there is no area to report.' : null;
}
