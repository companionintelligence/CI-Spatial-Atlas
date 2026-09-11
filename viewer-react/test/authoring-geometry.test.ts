import { describe, expect, it } from 'vitest';
import {
  centroid,
  closeRing,
  dedupePath,
  distanceMeters,
  EARTH_RADIUS_M,
  isFinitePoint,
  openRing,
  pathLengthMeters,
  pathSelfIntersects,
  removeVertex,
  replaceVertex,
  ringAreaMeters,
  ringSelfIntersects,
  samePoint,
  segmentsIntersect,
  translatePath,
  wrapLon,
} from '../src/authoring/geometry.js';

/**
 * The geometry the drawing tools stand on.
 *
 * Two things are being defended here. The first is the unclosed-ring
 * convention: `GeoPath` in the canonical schema stores rings WITHOUT a repeated
 * first vertex, GeoJSON and KML both require one on the wire, and every bug in
 * this area is a missing or doubled closing vertex — a zero-length final edge
 * that breaks outline widths, or an "unclosed ring" rejection from a validator.
 *
 * The second is self-intersection. Cesium triangulates a polygon with an
 * ear-clipping pass that assumes a simple ring; a bow-tie produces overlapping
 * triangles with inverted winding and renders as garbage while logging
 * absolutely nothing. Detecting it before the shape is committed is the whole
 * point, so the cases below are the ones that actually occur — a proper
 * crossing, a shape that only becomes invalid when it is closed, and the
 * collinear backtrack that a naive orientation test misses.
 */

const p = (lon: number, lat: number, height?: number) =>
  height == null ? { lon, lat } : { lon, lat, height };

describe('point predicates', () => {
  it('treats a re-picked ray as the same point and two street-zoom clicks as different ones', () => {
    expect(samePoint(p(-21.9426, 64.1466), p(-21.9426, 64.1466))).toBe(true);
    // 1 px at street zoom is roughly 5e-6 degrees. The default epsilon must NOT
    // swallow that, or two deliberate adjacent vertices collapse into one.
    expect(samePoint(p(0, 0), p(5e-6, 0))).toBe(false);
    expect(samePoint(p(0, 0), p(1e-10, 0))).toBe(true);
  });

  it('rejects the NaN a missed globe pick turns into', () => {
    expect(isFinitePoint(p(0, 0))).toBe(true);
    expect(isFinitePoint({ lon: Number.NaN, lat: 0 })).toBe(false);
    expect(isFinitePoint({ lon: 0, lat: 0, height: Number.NaN })).toBe(false);
    expect(isFinitePoint(null)).toBe(false);
  });
});

describe('the unclosed-ring convention', () => {
  it('closes for the wire and opens back to canonical form', () => {
    const ring = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
    const closed = closeRing(ring);
    expect(closed).toHaveLength(5);
    expect(closed[4]).toEqual(closed[0]);
    // Round trip: closing then opening is the identity on a canonical ring.
    expect(openRing(closed)).toEqual(ring);
  });

  it('is idempotent — a ring that arrived closed is not closed twice', () => {
    const closed = [p(0, 0), p(1, 0), p(1, 1), p(0, 0)];
    expect(closeRing(closed)).toHaveLength(4);
    expect(openRing(closed)).toEqual([p(0, 0), p(1, 0), p(1, 1)]);
  });

  it('drops consecutive duplicates but keeps a legitimate revisit', () => {
    // A figure-of-eight passes through the middle twice; those two vertices are
    // NOT consecutive and must survive.
    const path = [p(0, 0), p(0, 0), p(1, 1), p(2, 0), p(1, 1), p(2, 2)];
    expect(dedupePath(path)).toEqual([p(0, 0), p(1, 1), p(2, 0), p(1, 1), p(2, 2)]);
  });

  it('never lets a degenerate ring survive closing', () => {
    expect(openRing([p(0, 0), p(0, 0), p(0, 0)])).toEqual([p(0, 0)]);
    expect(closeRing([])).toEqual([]);
  });
});

describe('segment intersection', () => {
  it('finds a proper crossing', () => {
    expect(segmentsIntersect(p(0, 0), p(2, 2), p(0, 2), p(2, 0))).toBe(true);
  });

  it('does not invent one for parallel or distant segments', () => {
    expect(segmentsIntersect(p(0, 0), p(2, 0), p(0, 1), p(2, 1))).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(1, 0), p(5, 5), p(6, 6))).toBe(false);
  });

  it('counts a collinear overlap — the backtrack case', () => {
    // Tracing a street out and part-way back. No X-crossing, but the ring is
    // still not simple and Cesium still cannot triangulate it.
    expect(segmentsIntersect(p(0, 0), p(4, 0), p(2, 0), p(6, 0))).toBe(true);
  });

  it('counts a T-junction where an endpoint lands mid-segment', () => {
    expect(segmentsIntersect(p(0, 0), p(4, 0), p(2, 0), p(2, 3))).toBe(true);
  });
});

describe('self-intersection', () => {
  it('passes a simple square', () => {
    expect(ringSelfIntersects([p(0, 0), p(1, 0), p(1, 1), p(0, 1)])).toBe(false);
  });

  it('passes any triangle — three segments cannot cross', () => {
    expect(ringSelfIntersects([p(0, 0), p(1, 0), p(0.5, 1)])).toBe(false);
    expect(ringSelfIntersects([p(0, 0), p(4, 3), p(1, -2)])).toBe(false);
  });

  it('catches a bow-tie', () => {
    // The classic: vertices ordered so two opposite edges cross.
    expect(ringSelfIntersects([p(0, 0), p(2, 2), p(2, 0), p(0, 2)])).toBe(true);
  });

  it('catches a ring that only becomes invalid once it is CLOSED', () => {
    // Drawn as an open path this is perfectly simple — no two of its four
    // segments cross.
    const path = [p(0, 0), p(2, 0), p(2, 4), p(3, 6), p(4, 4)];
    expect(pathSelfIntersects(path)).toBe(false);
    // The wrap-around segment (4,4) → (0,0) runs back through (2,2), straight
    // across the second segment. The shape is invalid only as a ring — which
    // is exactly the moment the polygon tool commits it, and exactly the case
    // a path-only check misses.
    expect(ringSelfIntersects(path)).toBe(true);
  });

  it('does not flag adjacent segments for sharing an endpoint', () => {
    // Every consecutive pair touches by construction. A test that forgot to
    // skip them would call every shape self-intersecting.
    expect(ringSelfIntersects([p(0, 0), p(1, 0), p(2, 1), p(1, 2), p(0, 2)])).toBe(false);
  });

  it('tolerates a duplicated vertex rather than reading it as a crossing', () => {
    expect(ringSelfIntersects([p(0, 0), p(1, 0), p(1, 0), p(1, 1), p(0, 1)])).toBe(false);
  });

  it('flags a self-crossing open line, which is legal but worth saying', () => {
    expect(pathSelfIntersects([p(0, 0), p(2, 2), p(2, 0), p(0, 2)])).toBe(true);
  });
});

describe('measurement', () => {
  it('measures a degree of latitude as a real great-circle distance', () => {
    // One degree of latitude is ~111.2 km everywhere.
    expect(distanceMeters(p(0, 0), p(0, 1))).toBeCloseTo((Math.PI / 180) * EARTH_RADIUS_M, 0);
  });

  it('shrinks a degree of longitude towards the pole — the reason this is not planar', () => {
    const atEquator = distanceMeters(p(0, 0), p(1, 0));
    const atReykjavik = distanceMeters(p(0, 64.15), p(1, 64.15));
    // cos(64.15°) ≈ 0.436. A planar approximation would report them equal, and
    // the toolbar's length readout would be 2.3x too large in Iceland.
    expect(atReykjavik / atEquator).toBeCloseTo(Math.cos((64.15 * Math.PI) / 180), 2);
  });

  it('sums an open path and returns zero for a single vertex', () => {
    expect(pathLengthMeters([p(0, 0)])).toBe(0);
    const two = pathLengthMeters([p(0, 0), p(0, 1)]);
    expect(pathLengthMeters([p(0, 0), p(0, 1), p(0, 2)])).toBeCloseTo(two * 2, 0);
  });

  it('measures a ring area with the spherical formula', () => {
    // A 1° × 1° cell on the equator: 111.2 km on each side, ~1.237e10 m².
    const area = ringAreaMeters([p(0, 0), p(1, 0), p(1, 1), p(0, 1)]);
    expect(area / 1e10).toBeCloseTo(1.237, 1);
  });

  it('reports the same area whichever way the ring is wound', () => {
    const cw = ringAreaMeters([p(0, 0), p(0, 1), p(1, 1), p(1, 0)]);
    const ccw = ringAreaMeters([p(0, 0), p(1, 0), p(1, 1), p(0, 1)]);
    expect(cw).toBeCloseTo(ccw, 6);
    expect(cw).toBeGreaterThan(0);
  });

  it('is zero for anything that is not a ring', () => {
    expect(ringAreaMeters([p(0, 0), p(1, 1)])).toBe(0);
  });
});

describe('moving geometry', () => {
  it('puts the move handle inside the shape, and averages heights', () => {
    const c = centroid([p(0, 0, 100), p(2, 0, 200), p(2, 2), p(0, 2)]);
    expect(c).toEqual({ lon: 1, lat: 1, height: 150 });
  });

  it('has no anchor for an empty path', () => {
    expect(centroid([])).toBeNull();
  });

  it('preserves per-vertex heights through a translation', () => {
    const moved = translatePath([p(10, 20, 55)], 1, -2);
    expect(moved).toEqual([p(11, 18, 55)]);
  });

  it('clamps latitude at the pole instead of producing 137°', () => {
    expect(translatePath([p(0, 85)], 0, 20)[0]!.lat).toBe(90);
    expect(translatePath([p(0, -85)], 0, -20)[0]!.lat).toBe(-90);
  });

  it('wraps longitude across the antimeridian', () => {
    expect(wrapLon(181)).toBe(-179);
    expect(wrapLon(-181)).toBe(179);
    expect(wrapLon(360)).toBe(0);
    expect(translatePath([p(179, 0)], 3, 0)[0]!.lon).toBeCloseTo(-178, 9);
  });
});

describe('vertex editing', () => {
  const ring = [p(0, 0), p(1, 0), p(1, 1)];

  it('replaces a vertex without touching the others', () => {
    expect(replaceVertex(ring, 1, p(5, 5))).toEqual([p(0, 0), p(5, 5), p(1, 1)]);
  });

  it('ignores a drag that outlived the shape it started on', () => {
    // Same array back, by identity — the caller skips a rebuild on that.
    expect(replaceVertex(ring, 9, p(5, 5))).toBe(ring);
    expect(replaceVertex(ring, -1, p(5, 5))).toBe(ring);
    expect(replaceVertex(ring, 0, { lon: Number.NaN, lat: 0 })).toBe(ring);
  });

  it('refuses to shrink a shape below the minimum its type needs', () => {
    // A triangle losing a vertex is not a smaller polygon; it is an item that
    // fails GeoPath.min(3) on the next save.
    expect(removeVertex(ring, 0, 3)).toBe(ring);
    expect(removeVertex([...ring, p(0, 1)], 0, 3)).toEqual([p(1, 0), p(1, 1), p(0, 1)]);
  });
});
