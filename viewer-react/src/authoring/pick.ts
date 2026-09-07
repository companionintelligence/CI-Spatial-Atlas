import * as Cesium from 'cesium';
import type { GeoPoint } from '@companion-atlas/story';

/**
 * Turning a pixel into a place on the planet.
 *
 * This is the single most consequential 30 lines in the drawing tools, because
 * all three of the obvious answers are wrong in a way that only shows up on
 * real data:
 *
 * **`camera.pickEllipsoid`** intersects the *smooth WGS84 ellipsoid*, ignoring
 * terrain entirely. On flat ground it is indistinguishable from the right
 * answer, which is exactly why it survives review. On a mountainside it is not:
 * looking obliquely at a 2,000 m ridge, the ellipsoid intersection is the point
 * *behind* the mountain that the ray would have reached had the mountain not
 * been there — kilometres away, and underground. Every vertex placed on
 * anything with relief lands in the rock.
 *
 * **`scene.pickPosition`** reads the depth buffer, so it returns whatever was
 * actually drawn — terrain, 3D Tiles, buildings, *and our own preview
 * geometry*. It is the only thing that can pick a Google Photorealistic
 * building roof, and it is also the thing that will happily snap a new vertex
 * onto the rubber-band line already under the cursor. It also needs a depth
 * texture (`scene.pickPositionSupported`), which is not guaranteed.
 *
 * **`globe.pick(ray)`** ray-casts against the *rendered terrain tiles*. It is
 * the right answer, with two caveats worth knowing: it only sees tiles that are
 * currently rendered, so it returns nothing when the globe is hidden (which is
 * exactly what the buildings layer does — `CesiumStoryViewer` sets
 * `globe.show = false` under Google's tiles), and it is accurate to the loaded
 * LOD rather than to the underlying terrain.
 *
 * So: globe first, depth buffer second (for the buildings case), ellipsoid
 * last, and `null` rather than a guess when the ray leaves the planet entirely.
 */

/** A pick that hit something. */
export interface PickedPoint {
  /** Degrees, with the terrain/surface elevation in `height`. */
  point: GeoPoint;
  /** Which strategy answered — surfaced so a caller can tell "on the terrain"
   *  from "on the smooth ellipsoid, because there is no terrain here". */
  via: 'globe' | 'depth' | 'ellipsoid';
}

/** Reused across calls: `getPickRay` and `Cartographic.fromCartesian` both
 *  allocate otherwise, and this runs on every mouse move while drawing. */
const scratchRay = new Cesium.Ray();
const scratchCartesian = new Cesium.Cartesian3();
const scratchCarto = new Cesium.Cartographic();

/**
 * Pixel → `GeoPoint`, or `null` when the ray misses the globe.
 *
 * Returning `null` for a miss is load-bearing. Clicking the black sky is a
 * completely ordinary thing to do — the globe occupies maybe half the viewport
 * at story-opening zoom — and the alternative behaviours are both bad: an
 * ellipsoid pick with no intersection yields `undefined`, which becomes `NaN`
 * the moment it is read as a number, and a vertex at `{lon: NaN, lat: NaN}`
 * passes the schema's `z.number()` check (NaN *is* a number) and renders as a
 * shape that vanishes with no error anywhere.
 */
export function pickGlobePoint(
  viewer: Cesium.Viewer,
  windowPosition: Cesium.Cartesian2,
): PickedPoint | null {
  if (!viewer || viewer.isDestroyed()) return null;
  const scene = viewer.scene;

  // 1. Terrain, via the rendered tiles.
  if (scene.globe && scene.globe.show) {
    const ray = viewer.camera.getPickRay(windowPosition, scratchRay);
    if (ray) {
      const hit = scene.globe.pick(ray, scene, scratchCartesian);
      const p = toGeoPoint(hit);
      if (p) return { point: p, via: 'globe' };
    }
  }

  // 2. Whatever was actually rendered — 3D Tiles, buildings, a hidden globe's
  //    replacement surface. Only reachable when the depth texture exists.
  if (scene.pickPositionSupported) {
    const hit = scene.pickPosition(windowPosition, scratchCartesian);
    const p = toGeoPoint(hit);
    // `pickPosition` returns the far plane for an empty pixel, which decodes to
    // a point millions of kilometres up. Anything above the Kármán line by
    // three orders of magnitude did not come from a surface.
    if (p && p.height != null && p.height < 1_000_000) return { point: p, via: 'depth' };
  }

  // 3. The smooth ellipsoid. Wrong on relief, but it is the difference between
  //    "the tool works over the ocean and before terrain loads" and "the tool
  //    does nothing and says nothing".
  const hit = viewer.camera.pickEllipsoid(windowPosition, scene.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84, scratchCartesian);
  const p = toGeoPoint(hit);
  return p ? { point: p, via: 'ellipsoid' } : null;
}

/** Cartesian3 → degrees, rejecting anything non-finite. */
function toGeoPoint(cartesian: Cesium.Cartesian3 | undefined): GeoPoint | null {
  if (!cartesian) return null;
  // Cesium returns the zero vector for some degenerate picks rather than
  // `undefined`, and `Cartographic.fromCartesian` returns undefined for it.
  const carto = Cesium.Cartographic.fromCartesian(cartesian, undefined, scratchCarto);
  if (!carto) return null;
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const height = carto.height;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(height)) return null;
  // A fresh object every time: the scratch Cartographic is reused, and handing
  // out a view onto it would give every vertex in the path the same position.
  return { lon, lat, height };
}

/** `GeoPoint` → `Cartesian3`, with an optional lift so a preview line is not
 *  swallowed by the terrain it is being drawn on. */
export function toCartesian(p: GeoPoint, liftMeters = 0): Cesium.Cartesian3 {
  return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, (p.height ?? 0) + liftMeters);
}

/** A whole path → the `Cartesian3[]` Cesium graphics want. */
export function toCartesians(path: readonly GeoPoint[], liftMeters = 0): Cesium.Cartesian3[] {
  return path.map((p) => toCartesian(p, liftMeters));
}

/**
 * The entity under the cursor, as the id string the layers agree on.
 *
 * Every interactive layer on this globe prefixes its entity ids (`mem:`,
 * `place:`, and now `authoring:`), so one `scene.pick` and one string test tell
 * you which layer owns the hit. Returns `null` for a pick that hit geometry
 * with no id — CZML packets, imagery, a tileset feature.
 */
export function pickEntityId(viewer: Cesium.Viewer, windowPosition: Cesium.Cartesian2): string | null {
  if (!viewer || viewer.isDestroyed()) return null;
  const picked = viewer.scene.pick(windowPosition) as { id?: { id?: unknown } } | undefined;
  const id = picked?.id?.id;
  return typeof id === 'string' ? id : null;
}
