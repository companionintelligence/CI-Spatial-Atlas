import * as Cesium from 'cesium';
import type { GeoPath, Item } from '@companion-atlas/story';
import { editableVertices, itemAnchor, previewPath, type DraftState } from './draft.js';
import { closeRing } from './geometry.js';
import {
  DRAFT_FILL_ID,
  DRAFT_LINE_ID,
  draftVertexEntityId,
  itemEntityId,
  MOVE_HANDLE_ID,
  outlineEntityId,
  vertexEntityId,
} from './ids.js';
import { resolveIconUrl } from './icons.js';
import { toCartesian, toCartesians } from './pick.js';

/**
 * `Item` → Cesium entities, for the drawing layer.
 *
 * Everything the drawing tools put on the globe lives in ONE
 * `CustomDataSource`, so `destroy()` is a single `dataSources.remove(ds, true)`
 * and cannot leave a stray polyline behind. Nothing here touches the CZML data
 * source the story renders through.
 *
 * ## Palette
 *
 * The literals mirror `theme/atlas.css` — `--atlas-teal`, `--atlas-mint`,
 * `--atlas-ink`. Cesium draws into WebGL and cannot read a CSS custom property,
 * so the chrome tokens have to be restated here; `CesiumStoryViewer` does
 * exactly the same for `PIN_TEAL`/`PIN_MINT`. Everything that *can* read a
 * variable (the toolbar) does, in `theme/authoring.css`.
 */

const INK = Cesium.Color.fromCssColorString('#041620');
const MINT = Cesium.Color.fromCssColorString('#58ebbf');
const AQUA_LIGHT = Cesium.Color.fromCssColorString('#72ddd4');
const FG = Cesium.Color.fromCssColorString('#d7e6e6');

/** Handles must never be hidden by the terrain they sit on — an unreachable
 *  vertex handle is a shape that cannot be edited. */
const ON_TOP = Number.POSITIVE_INFINITY;

const VERTEX_PIXEL_SIZE = 10;
const MOVE_PIXEL_SIZE = 13;

/**
 * How far above the surface the *preview* geometry is drawn, in metres.
 *
 * The rubber band is deliberately NOT `clampToGround`. A clamped polyline is a
 * ground primitive, and Cesium re-batches the whole primitive every time its
 * positions change — which, for a rubber band, is every mouse move. On a
 * terrain-heavy scene that is a visible stutter while drawing, and drawing is
 * the one moment the app has to feel immediate.
 *
 * So the preview is an ordinary depth-tested polyline drawn at the terrain
 * heights the picks already returned, lifted a couple of metres so it is not
 * z-fought into the ground it is tracing. It can dip behind a ridge between two
 * vertices; the committed shape, which is clamped, will not. Two metres is
 * below the resolution of anything a user is looking at from a drawing zoom and
 * comfortably above terrain's own depth precision.
 */
const PREVIEW_LIFT_M = 2;

export function createAuthoringDataSource(): Cesium.CustomDataSource {
  return new Cesium.CustomDataSource('atlas-authoring');
}

const css = (hex: string | undefined, fallback: Cesium.Color): Cesium.Color => {
  if (!hex) return fallback;
  try {
    return Cesium.Color.fromCssColorString(hex) ?? fallback;
  } catch {
    // A colour is a permissive string in the schema (`#rgb`, `#rrggbbaa`, and
    // whatever an importer produced). One bad value must not blank the layer.
    return fallback;
  }
};

/**
 * Draw one committed item.
 *
 * A polygon becomes TWO entities, and this is the single most surprising thing
 * in the file. Cesium's `polygon.outlineWidth` is passed straight to WebGL's
 * `lineWidth`, and the WebGL spec permits an implementation to support only
 * width 1 — which ANGLE (i.e. every Windows browser) and most mobile drivers
 * do. So `outlineWidth: 4` silently renders as a hairline on the majority of
 * machines, including in the CZML the schema already emits. The only portable
 * way to get a thick polygon edge is to draw the ring again as a polyline,
 * which is what `outlineEntityId` is for. It also makes an outline-only polygon
 * (`fillOpacity: 0`, how KML's `<fill>0</fill>` arrives) clickable, since a
 * fully transparent fill is not pickable.
 */
export function addItemEntities(ds: Cesium.CustomDataSource, item: Item, selected: boolean): void {
  switch (item.type) {
    case 'marker': {
      const color = css(item.color, AQUA_LIGHT);
      const image = resolveIconUrl(item.icon, item.color ?? '#72ddd4');
      ds.entities.add({
        id: itemEntityId(item.id),
        name: item.title ?? item.id,
        position: toCartesian(item.position),
        // Mirrors `czml.ts`: a billboard needs a loadable image, so an icon
        // that did not resolve falls back to a point rather than making
        // Cesium's `fetchImage` log a rejection for every marker on screen.
        ...(image
          ? {
              billboard: {
                image,
                width: selected ? 34 : 28,
                height: selected ? 34 : 28,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: ON_TOP,
              },
            }
          : {
              point: {
                pixelSize: selected ? 15 : 11,
                color,
                outlineColor: selected ? MINT : INK,
                outlineWidth: 2,
                disableDepthTestDistance: ON_TOP,
              },
            }),
      });
      break;
    }
    case 'note': {
      ds.entities.add({
        id: itemEntityId(item.id),
        name: item.title ?? item.id,
        position: toCartesian(item.position),
        point: {
          pixelSize: selected ? 10 : 7,
          color: selected ? MINT : AQUA_LIGHT,
          outlineColor: INK,
          outlineWidth: 2,
          disableDepthTestDistance: ON_TOP,
        },
        label: {
          text: item.text,
          font: '600 13px Manrope, sans-serif',
          fillColor: FG,
          showBackground: true,
          backgroundColor: INK.withAlpha(0.72),
          backgroundPadding: new Cesium.Cartesian2(8, 5),
          pixelOffset: new Cesium.Cartesian2(0, -16),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: ON_TOP,
        },
      });
      break;
    }
    case 'line': {
      const clamp = item.clampToGround ?? !hasHeights(item.positions);
      ds.entities.add({
        id: itemEntityId(item.id),
        name: item.title ?? item.id,
        polyline: {
          positions: toCartesians(item.positions),
          width: (item.width ?? 3) + (selected ? 2 : 0),
          material: selected ? MINT : css(item.color, AQUA_LIGHT),
          clampToGround: clamp,
          // `clampToGround` needs a ground-primitive path, and that path only
          // exists for GEODESIC arcs — RHUMB silently drops the draping. Same
          // note as `czml.ts`, same reason.
          arcType: Cesium.ArcType.GEODESIC,
        },
      });
      break;
    }
    case 'polygon': {
      const clamp = item.clampToGround ?? !hasHeights(item.positions);
      const fillOpacity = item.fillOpacity ?? 0.35;
      const outlineWidth = item.outlineWidth ?? 2;
      const hierarchy = new Cesium.PolygonHierarchy(
        toCartesians(item.positions),
        (item.holes ?? []).map((h) => new Cesium.PolygonHierarchy(toCartesians(h))),
      );
      ds.entities.add({
        id: itemEntityId(item.id),
        name: item.title ?? item.id,
        polygon: {
          hierarchy,
          fill: fillOpacity > 0,
          material: css(item.fillColor, AQUA_LIGHT).withAlpha(fillOpacity),
          // Cesium only drapes a polygon when it is NOT told to honour
          // per-vertex heights; leaving this true on a clamped shape pins every
          // vertex to its stored elevation and the fill vanishes inside a hill.
          perPositionHeight: !clamp,
          outline: false, // see the note above — drawn as a polyline instead
          arcType: Cesium.ArcType.GEODESIC,
        },
      });
      if (outlineWidth > 0) {
        ds.entities.add({
          id: outlineEntityId(item.id),
          polyline: {
            // Closed for drawing only. Storage stays unclosed — `GeoPath`.
            positions: toCartesians(closeRing(item.positions)),
            width: outlineWidth + (selected ? 2 : 0),
            material: selected ? MINT : css(item.outlineColor ?? item.fillColor, MINT),
            clampToGround: clamp,
            arcType: Cesium.ArcType.GEODESIC,
          },
        });
      }
      break;
    }
    default:
      // Photos, tracks, models and tilesets belong to the story's CZML layer.
      // The drawing layer selects them but never re-draws them, or the globe
      // would show every photo twice.
      break;
  }
}

/** The draggable handles for the selected item: one point per vertex, plus a
 *  move handle at the anchor when there is more than one vertex. */
export function addSelectionHandles(ds: Cesium.CustomDataSource, item: Item): void {
  const vertices = editableVertices(item);
  vertices.forEach((v, index) => {
    ds.entities.add({
      id: vertexEntityId(index),
      position: toCartesian(v),
      point: {
        pixelSize: VERTEX_PIXEL_SIZE,
        color: MINT,
        outlineColor: INK,
        outlineWidth: 2,
        disableDepthTestDistance: ON_TOP,
      },
    });
  });

  // A single-vertex item IS its own move handle — a second dot on top of the
  // marker would be two overlapping pick targets, and whichever won would feel
  // arbitrary.
  if (vertices.length > 1) {
    const anchor = itemAnchor(item);
    if (anchor) {
      ds.entities.add({
        id: MOVE_HANDLE_ID,
        position: toCartesian(anchor),
        point: {
          pixelSize: MOVE_PIXEL_SIZE,
          color: AQUA_LIGHT.withAlpha(0.9),
          outlineColor: INK,
          outlineWidth: 3,
          disableDepthTestDistance: ON_TOP,
        },
      });
    }
  }
}

/**
 * Create (once) the preview entities for the shape being drawn.
 *
 * Returned so the controller can update their positions in place. Positions are
 * assigned as plain arrays — Cesium wraps them in a `ConstantProperty` and
 * fires `definitionChanged`, which is enough to repaint. Deliberately NOT a
 * `CallbackProperty`: one constructed with `isConstant = false` tells Cesium the
 * value changes every frame and holds the scene permanently dirty, which is the
 * exact defect `CesiumStoryViewer` documents at length after it cost 580 pins'
 * worth of per-frame closures and made `requestRenderMode` unusable. A rubber
 * band moves on pointer input, not on the clock.
 */
export interface DraftEntities {
  line: Cesium.Entity;
  fill: Cesium.Entity;
}

export function addDraftEntities(ds: Cesium.CustomDataSource, color: string, fillOpacity: number): DraftEntities {
  const stroke = css(color, MINT);
  const line = ds.entities.add({
    id: DRAFT_LINE_ID,
    polyline: {
      positions: [],
      width: 2.5,
      material: new Cesium.PolylineDashMaterialProperty({ color: stroke, dashLength: 12 }),
      clampToGround: false,
      arcType: Cesium.ArcType.GEODESIC,
    },
  });
  const fill = ds.entities.add({
    id: DRAFT_FILL_ID,
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy([]),
      material: stroke.withAlpha(Math.min(0.35, Math.max(0.08, fillOpacity))),
      perPositionHeight: true,
      outline: false,
      arcType: Cesium.ArcType.GEODESIC,
      show: false,
    },
  });
  return { line, fill };
}

/** Push the current draft into the preview entities. */
export function updateDraftEntities(
  ds: Cesium.CustomDataSource,
  entities: DraftEntities,
  draft: DraftState,
): void {
  const path = previewPath(draft);
  const positions = toCartesians(path, PREVIEW_LIFT_M);

  if (entities.line.polyline) {
    // A one-point polyline is not a polyline; Cesium logs nothing and draws
    // nothing, but an empty array is cheaper than a degenerate one.
    entities.line.polyline.positions = new Cesium.ConstantProperty(positions.length >= 2 ? positions : []);
  }
  if (entities.fill.polygon) {
    const showFill = draft.mode === 'polygon' && positions.length >= 3;
    entities.fill.polygon.show = new Cesium.ConstantProperty(showFill);
    entities.fill.polygon.hierarchy = new Cesium.ConstantProperty(
      new Cesium.PolygonHierarchy(showFill ? positions : []),
    );
  }

  // One dot per placed vertex, so it is obvious what Backspace will take back.
  // Rebuilt rather than diffed: a draft is a handful of points, and a rebuild
  // cannot leave a stale dot behind after an undo.
  removeByPrefix(ds, 'authoring-draft-vertex:');
  draft.vertices.forEach((v, index) => {
    ds.entities.add({
      id: draftVertexEntityId(index),
      position: toCartesian(v, PREVIEW_LIFT_M),
      point: {
        pixelSize: 8,
        color: MINT,
        outlineColor: INK,
        outlineWidth: 2,
        disableDepthTestDistance: ON_TOP,
      },
    });
  });
}

/** Remove every entity whose id starts with `prefix`. Iterates over a COPY of
 *  the values array: `EntityCollection.remove` mutates it, so removing while
 *  enumerating skips every other entity — which showed up as vertex handles
 *  that survived a deselect. */
export function removeByPrefix(ds: Cesium.CustomDataSource, prefix: string): void {
  for (const entity of [...ds.entities.values]) {
    if (entity.id.startsWith(prefix)) ds.entities.remove(entity);
  }
}

/** Did the author actually supply elevations? Drives the clamp default, exactly
 *  as `czml.ts` does — restated rather than imported because that copy is not
 *  exported and the two must not silently diverge on a schema change. */
function hasHeights(path: GeoPath): boolean {
  return path.some((p) => p.height != null && p.height !== 0);
}
