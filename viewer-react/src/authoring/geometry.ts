import type { GeoPath, GeoPoint } from '@companion-atlas/story';

/**
 * Plane geometry for drawn shapes — no Cesium, no DOM, no React.
 *
 * Everything here works on `GeoPoint[]` in **degrees**, which is the canonical
 * schema's own representation (`GeoPath`). That is deliberate: the alternative
 * is to convert to `Cartesian3` the moment a vertex is picked and convert back
 * when the shape is committed, and every round trip through ECEF loses the
 * exact lon/lat the user clicked. Keeping degrees end-to-end means the vertex
 * that lands in the `Item` is bit-identical to the one that was previewed.
 *
 * ## The antimeridian
 *
 * Intersection, area and centroid below all treat lon/lat as a flat plane. That
 * is correct for the shapes a person draws by hand (a parcel, a route, a
 * building footprint — kilometres, not hemispheres) and wrong for a ring that
 * crosses ±180° or contains a pole. Cesium has the same limitation in its own
 * `PolygonGeometry` (`arcType: GEODESIC` interpolates, but the winding is still
 * computed in a projected frame), so a shape this module mis-measures is a
 * shape Cesium would also draw wrong — the failure is visible rather than
 * silent. Anything that needs true spherical topology (an import of a country
 * polygon, say) does not come through the drawing tools.
 *
 * The one place this is NOT approximated is `pathLengthMeters`, which is a real
 * haversine: the toolbar's length readout is a number a user will compare
 * against a map, and a planar degree-distance would be wrong by the cosine of
 * the latitude — 30% at Reykjavik.
 */

/** Mean Earth radius (IUGG), metres. Matches Cesium's `Ellipsoid.WGS84`
 *  mean radius closely enough for a readout; this is not a survey. */
export const EARTH_RADIUS_M = 6_371_008.8;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Are two vertices the same point?
 *
 * The default tolerance is ~1e-9° ≈ 0.1 mm, i.e. "these came from the same
 * pick", not "these are close together". It exists to catch *exact* duplicates
 * — a re-picked ray, a ring that arrived closed from an importer — and must not
 * swallow two genuinely adjacent vertices at street zoom, where 1 px is around
 * 5e-6°. Screen-space de-duplication (a click within N pixels of the last one)
 * is a different problem and lives in the controller, where pixels exist.
 */
export function samePoint(a: GeoPoint, b: GeoPoint, epsDeg = 1e-9): boolean {
  return Math.abs(a.lon - b.lon) <= epsDeg && Math.abs(a.lat - b.lat) <= epsDeg;
}

/** Is every coordinate a real number? A pick that missed the globe, an import
 *  with a null in it, and `parseFloat('')` all arrive here as NaN. */
export function isFinitePoint(p: GeoPoint | null | undefined): p is GeoPoint {
  return (
    !!p &&
    Number.isFinite(p.lon) &&
    Number.isFinite(p.lat) &&
    (p.height == null || Number.isFinite(p.height))
  );
}

/**
 * Drop consecutive duplicates (and a repeated first/last vertex on a ring).
 *
 * Zero-length segments are the reason this exists: they make every
 * intersection test ambiguous (a degenerate segment is collinear with
 * everything), and Cesium renders a polygon outline with one as a visible
 * pinch. Importers, double-clicks and a jittery trackpad all produce them.
 */
export function dedupePath(path: GeoPath, { ring = false }: { ring?: boolean } = {}): GeoPath {
  const out: GeoPoint[] = [];
  for (const p of path) {
    if (!isFinitePoint(p)) continue;
    const last = out[out.length - 1];
    if (last && samePoint(last, p)) continue;
    out.push(p);
  }
  // A ring's wrap-around segment can be degenerate too — that is exactly the
  // shape a closed GeoJSON/KML ring arrives in.
  while (ring && out.length > 1 && samePoint(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

/**
 * Canonical (unclosed) ring → the closed ring that wire formats and hit-testing
 * want. See `GeoPath` in the schema: storage never repeats the first vertex.
 */
export function closeRing(ring: GeoPath): GeoPath {
  if (ring.length === 0) return [];
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return samePoint(first, last) ? [...ring] : [...ring, first];
}

/** The inverse: anything → the canonical unclosed ring. */
export function openRing(ring: GeoPath): GeoPath {
  return dedupePath(ring, { ring: true });
}

/** Orientation of the triple (a, b, c): >0 counter-clockwise, <0 clockwise,
 *  0 collinear. Sign only — the magnitude is twice the triangle area. */
function cross(a: GeoPoint, b: GeoPoint, c: GeoPoint): number {
  return (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
}

/** Is `p` inside the bounding box of segment ab (used only when p is known to
 *  be collinear with ab)? */
function onSegment(a: GeoPoint, b: GeoPoint, p: GeoPoint): boolean {
  return (
    Math.min(a.lon, b.lon) <= p.lon && p.lon <= Math.max(a.lon, b.lon) &&
    Math.min(a.lat, b.lat) <= p.lat && p.lat <= Math.max(a.lat, b.lat)
  );
}

/**
 * Do segments p1→p2 and p3→p4 cross?
 *
 * The standard orientation test, including the collinear-overlap cases. Those
 * cases matter here rather than being a textbook footnote: a user tracing a
 * street back over itself, or an importer that repeats a vertex, produces
 * exactly a collinear overlap, and a ring containing one is just as invalid in
 * CZML as a proper X-crossing. Touching at a shared endpoint is NOT a crossing
 * — that is what adjacent segments of any path do — so callers skip adjacent
 * pairs rather than this function pretending they never touch.
 */
export function segmentsIntersect(p1: GeoPoint, p2: GeoPoint, p3: GeoPoint, p4: GeoPoint): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);

  // Proper crossing: each segment straddles the other's line.
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;

  // Collinear / touching cases.
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

/**
 * Does an OPEN path cross itself?
 *
 * Used for `line`, where self-intersection is legal (a figure-of-eight route is
 * a real thing someone draws) — the caller warns rather than refuses. Adjacent
 * segments share an endpoint by construction and are skipped.
 */
export function pathSelfIntersects(path: GeoPath): boolean {
  const p = dedupePath(path);
  for (let i = 0; i + 1 < p.length; i++) {
    for (let j = i + 2; j + 1 < p.length; j++) {
      if (segmentsIntersect(p[i]!, p[i + 1]!, p[j]!, p[j + 1]!)) return true;
    }
  }
  return false;
}

/**
 * Does a CLOSED ring cross itself?
 *
 * Takes the ring in canonical unclosed form and tests the wrap-around segment
 * too, which is the one people forget: a ring whose *drawn* segments are all
 * fine can still be invalid the instant it is closed, and that is precisely the
 * moment the polygon tool commits it.
 *
 * A self-intersecting ring is not a cosmetic problem. Cesium triangulates a
 * polygon hierarchy with an ear-clipping pass that assumes a simple ring; given
 * a bow-tie it emits overlapping triangles with inverted winding, so the fill
 * z-fights against itself and the outline doubles back. It renders as garbage
 * and logs nothing.
 */
export function ringSelfIntersects(ring: GeoPath): boolean {
  const r = openRing(ring);
  const n = r.length;
  if (n < 4) return false; // a triangle cannot self-intersect
  for (let i = 0; i < n; i++) {
    const a1 = r[i]!;
    const a2 = r[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // Adjacent segments share a vertex; so do the first and last.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const b1 = r[j]!;
      const b2 = r[(j + 1) % n]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Great-circle distance between two vertices, metres. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Total length of an open path, metres. Zero for fewer than two vertices. */
export function pathLengthMeters(path: GeoPath): number {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i++) total += distanceMeters(path[i]!, path[i + 1]!);
  return total;
}

/**
 * Spherical area of a ring, square metres, always positive.
 *
 * The standard spherical-excess sum (the same one `@turf/area` and
 * `geojson-area` use). A planar `shoelace × 111km²` is wrong by cos(lat) and
 * would report a Reykjavik parcel 30% too large; this is the cheap formula that
 * is actually right for hand-drawn shapes.
 */
export function ringAreaMeters(ring: GeoPath): number {
  const r = openRing(ring);
  if (r.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    total += (rad(b.lon) - rad(a.lon)) * (2 + Math.sin(rad(a.lat)) + Math.sin(rad(b.lat)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/**
 * The point a "move the whole shape" handle sits on.
 *
 * The arithmetic mean of the vertices, not the polygon's area centroid. For a
 * concave shape the area centroid can fall outside the shape entirely, which
 * puts the drag handle somewhere the user cannot associate with the thing it
 * moves; the vertex mean always sits inside the convex hull. It is a handle
 * anchor, never a reported location.
 */
export function centroid(path: GeoPath): GeoPoint | null {
  const p = dedupePath(path);
  if (p.length === 0) return null;
  let lon = 0;
  let lat = 0;
  let height = 0;
  let heights = 0;
  for (const v of p) {
    lon += v.lon;
    lat += v.lat;
    if (v.height != null) { height += v.height; heights++; }
  }
  const out: GeoPoint = { lon: lon / p.length, lat: lat / p.length };
  if (heights > 0) out.height = height / heights;
  return out;
}

/** Shift every vertex by a delta in degrees, preserving per-vertex heights.
 *  Latitude is clamped to the poles so a drag off the top of the globe cannot
 *  produce a lat of 137° — which Cesium accepts and renders as a shape folded
 *  inside out. */
export function translatePath(path: GeoPath, dLon: number, dLat: number): GeoPath {
  return path.map((p) => ({
    ...p,
    lon: wrapLon(p.lon + dLon),
    lat: Math.max(-90, Math.min(90, p.lat + dLat)),
  }));
}

/** Fold a longitude back into [-180, 180). Dragging east past the antimeridian
 *  is a normal thing to do and must not produce 181°. */
export function wrapLon(lon: number): number {
  if (!Number.isFinite(lon)) return lon;
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  // `-180` and `180` are the same meridian; normalise to -180 so equality tests
  // on two vertices at the seam agree.
  if (Object.is(l, -0)) l = 0;
  return l;
}

/** Replace one vertex, leaving the rest of the path untouched. Out-of-range
 *  indices are a no-op rather than an append — a stale drag from a shape that
 *  has since lost vertices must not grow it again. */
export function replaceVertex(path: GeoPath, index: number, point: GeoPoint): GeoPath {
  if (index < 0 || index >= path.length || !isFinitePoint(point)) return path;
  const out = [...path];
  out[index] = point;
  return out;
}

/** Remove one vertex. Refuses to go below the minimum a shape needs to exist —
 *  the caller deletes the whole item instead of leaving a one-vertex polygon
 *  that fails schema validation on the next save. */
export function removeVertex(path: GeoPath, index: number, min: number): GeoPath {
  if (index < 0 || index >= path.length || path.length <= min) return path;
  return path.filter((_, i) => i !== index);
}
