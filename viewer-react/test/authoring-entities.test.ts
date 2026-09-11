import { describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import type { Item } from '@companion-atlas/story';
import {
  addDraftEntities,
  addItemEntities,
  addSelectionHandles,
  createAuthoringDataSource,
  cropNoteLabel,
  NOTE_LABEL_MAX_CHARS,
  removeByPrefix,
  updateDraftEntities,
} from '../src/authoring/entities.js';
import { addVertex, createDraft, setHover, type DraftState } from '../src/authoring/draft.js';
import { MOVE_HANDLE_ID, itemEntityId, outlineEntityId, vertexEntityId } from '../src/authoring/ids.js';

/**
 * `Item` → Cesium entities.
 *
 * Nothing renders here — entities are built and inspected, the same way
 * `layers-cesium.test.ts` and `basemaps.test.ts` build providers. That is
 * enough, because every defect this file guards against is a *property set
 * wrong*, not a pixel: a polygon outline that silently renders as a hairline,
 * a shape draped when it should honour its heights (or the reverse, which
 * buries it inside a hill), and an entity that survives the deselect that was
 * supposed to remove it.
 */

const time = Cesium.JulianDate.now();
const at = <T>(p: { getValue(t: Cesium.JulianDate): T } | undefined): T | undefined => p?.getValue(time);

const p = (lon: number, lat: number, height?: number) =>
  height == null ? { lon, lat } : { lon, lat, height };

const square = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];

const polygon = (over: Partial<Extract<Item, { type: 'polygon' }>> = {}): Item =>
  ({ id: 'g1', type: 'polygon', positions: square, ...over }) as Item;

const line = (over: Partial<Extract<Item, { type: 'line' }>> = {}): Item =>
  ({ id: 'l1', type: 'line', positions: [p(0, 0), p(1, 1)], ...over }) as Item;

describe('polygons are drawn as a fill PLUS a polyline outline', () => {
  it('emits both entities, and turns Cesium’s own outline off', () => {
    // `polygon.outlineWidth` is handed straight to WebGL's `lineWidth`, and the
    // spec lets an implementation support only width 1 — which ANGLE (every
    // Windows browser) and most mobile drivers do. A 4 px outline silently
    // renders as a hairline. Drawing the ring again as a polyline is the only
    // portable way to get a thick edge.
    const ds = createAuthoringDataSource();
    addItemEntities(ds, polygon({ outlineWidth: 4 }), false);
    const fill = ds.entities.getById(itemEntityId('g1'));
    const outline = ds.entities.getById(outlineEntityId('g1'));
    expect(fill?.polygon).toBeDefined();
    expect(at(fill!.polygon!.outline)).toBe(false);
    expect(at(outline!.polyline!.width)).toBe(4);
  });

  it('closes the ring for DRAWING while storage stays unclosed', () => {
    const ds = createAuthoringDataSource();
    const item = polygon();
    addItemEntities(ds, item, false);
    const outline = ds.entities.getById(outlineEntityId('g1'))!;
    const positions = at(outline.polyline!.positions) as Cesium.Cartesian3[];
    expect(positions).toHaveLength(square.length + 1);
    expect(Cesium.Cartesian3.equals(positions[0]!, positions[4]!)).toBe(true);
    if (item.type !== 'polygon') throw new Error('narrowing');
    expect(item.positions).toHaveLength(4); // the item was not touched
  });

  it('skips the outline entity entirely at width 0', () => {
    const ds = createAuthoringDataSource();
    addItemEntities(ds, polygon({ outlineWidth: 0 }), false);
    expect(ds.entities.getById(outlineEntityId('g1'))).toBeUndefined();
  });

  it('carries holes into the polygon hierarchy', () => {
    const ds = createAuthoringDataSource();
    addItemEntities(ds, polygon({ holes: [[p(0.2, 0.2), p(0.4, 0.2), p(0.4, 0.4)]] }), false);
    const hierarchy = at(ds.entities.getById(itemEntityId('g1'))!.polygon!.hierarchy) as Cesium.PolygonHierarchy;
    expect(hierarchy.holes).toHaveLength(1);
    expect(hierarchy.holes[0]!.positions).toHaveLength(3);
  });
});

describe('draping vs per-vertex heights', () => {
  it('drapes a 2D shape, because at h=0 it would sink under any real terrain', () => {
    const ds = createAuthoringDataSource();
    addItemEntities(ds, polygon(), false);
    // Cesium only drapes a polygon when it is NOT told to honour per-vertex
    // heights — leaving `perPositionHeight` true pins every vertex to 0.
    expect(at(ds.entities.getById(itemEntityId('g1'))!.polygon!.perPositionHeight)).toBe(false);
  });

  it('honours real elevations when the shape carries them and says nothing', () => {
    const ds = createAuthoringDataSource();
    addItemEntities(ds, polygon({ positions: [p(0, 0, 100), p(1, 0, 120), p(1, 1, 140)] }), false);
    expect(at(ds.entities.getById(itemEntityId('g1'))!.polygon!.perPositionHeight)).toBe(true);
  });

  it('lets an explicit clampToGround beat the heights that are stored', () => {
    // This is the drawn-shape default: picks always carry a terrain height, so
    // without an explicit clamp the shape floats or sinks the moment finer
    // terrain streams in.
    const ds = createAuthoringDataSource();
    addItemEntities(ds, polygon({ positions: [p(0, 0, 100), p(1, 0, 120), p(1, 1, 140)], clampToGround: true }), false);
    expect(at(ds.entities.getById(itemEntityId('g1'))!.polygon!.perPositionHeight)).toBe(false);
  });

  it('clamps a line on a GEODESIC arc, since RHUMB silently drops the draping', () => {
    const ds = createAuthoringDataSource();
    addItemEntities(ds, line({ clampToGround: true }), false);
    const polyline = ds.entities.getById(itemEntityId('l1'))!.polyline!;
    expect(at(polyline.clampToGround)).toBe(true);
    expect(at(polyline.arcType)).toBe(Cesium.ArcType.GEODESIC);
  });
});

describe('markers and notes', () => {
  it('uses a billboard for a gallery icon', () => {
    const ds = createAuthoringDataSource();
    addItemEntities(ds, { id: 'm1', type: 'marker', position: p(0, 0), icon: 'maki:cafe' }, false);
    // `maki:cafe` is not in the shipped gallery, so this one falls back…
    expect(ds.entities.getById(itemEntityId('m1'))!.point).toBeDefined();

    const ds2 = createAuthoringDataSource();
    addItemEntities(ds2, { id: 'm2', type: 'marker', position: p(0, 0), icon: 'maki:star', color: '#ff8d6e' }, false);
    const billboard = ds2.entities.getById(itemEntityId('m2'))!.billboard!;
    expect(String(at(billboard.image))).toContain('data:image/svg+xml');
  });

  it('falls back to a point for an icon Cesium could not fetch', () => {
    // Mirrors `czml.ts`: handing `fetchImage` an unknown scheme logs a
    // rejection for every marker on screen and draws nothing.
    const ds = createAuthoringDataSource();
    addItemEntities(ds, { id: 'm3', type: 'marker', position: p(0, 0), icon: 'ci-memory://pin' }, false);
    const entity = ds.entities.getById(itemEntityId('m3'))!;
    expect(entity.billboard).toBeUndefined();
    expect(entity.point).toBeDefined();
  });

  it('survives a colour string it cannot parse rather than blanking the layer', () => {
    const ds = createAuthoringDataSource();
    addItemEntities(ds, { id: 'm4', type: 'marker', position: p(0, 0), color: 'not-a-colour' }, false);
    expect(ds.entities.getById(itemEntityId('m4'))).toBeDefined();
  });

  it('labels a note with its own text', () => {
    const ds = createAuthoringDataSource();
    addItemEntities(ds, { id: 'n1', type: 'note', position: p(0, 0), text: 'we sat here' }, false);
    expect(at(ds.entities.getById(itemEntityId('n1'))!.label!.text)).toBe('we sat here');
  });

  it('crops a note label past 20 characters, with an ellipsis', () => {
    const ds = createAuthoringDataSource();
    addItemEntities(
      ds,
      { id: 'n2', type: 'note', position: p(0, 0), text: 'This sentence is much longer than twenty characters' },
      false,
    );
    const shown = at(ds.entities.getById(itemEntityId('n2'))!.label!.text) as string;
    expect(shown).toBe('This sentence is muc…');
    expect([...shown].length - 1).toBe(NOTE_LABEL_MAX_CHARS); // the ellipsis is one extra character, not one of the 20
  });

  it('crops exactly at the boundary, and leaves anything at or under it alone', () => {
    const exact = 'x'.repeat(NOTE_LABEL_MAX_CHARS);
    expect(cropNoteLabel(exact)).toBe(exact);
    expect(cropNoteLabel(`${exact}y`)).toBe(`${exact}…`);
    expect(cropNoteLabel('short')).toBe('short');
  });

  it('leaves the story’s own entity types to the CZML layer', () => {
    // Drawing a photo here too would put every located memory on the globe
    // twice — the exact duplication `CesiumStoryViewer` filters CZML to avoid.
    const ds = createAuthoringDataSource();
    addItemEntities(ds, { id: 'ph', type: 'photo', position: p(0, 0), media: { url: 'https://x/1.jpg' } }, false);
    expect(ds.entities.values).toHaveLength(0);
  });

  it('thickens a selected shape instead of recolouring it into invisibility', () => {
    const ds = createAuthoringDataSource();
    addItemEntities(ds, line({ width: 3 }), true);
    expect(at(ds.entities.getById(itemEntityId('l1'))!.polyline!.width)).toBe(5);
  });
});

describe('selection handles', () => {
  it('gives every vertex a handle, plus one move handle at the anchor', () => {
    const ds = createAuthoringDataSource();
    addSelectionHandles(ds, polygon());
    for (let i = 0; i < 4; i++) expect(ds.entities.getById(vertexEntityId(i))).toBeDefined();
    expect(ds.entities.getById(MOVE_HANDLE_ID)).toBeDefined();
  });

  it('does not stack a move handle on top of a single-point item', () => {
    // Two overlapping pick targets, and whichever won would feel arbitrary.
    const ds = createAuthoringDataSource();
    addSelectionHandles(ds, { id: 'm', type: 'marker', position: p(0, 0) });
    expect(ds.entities.getById(vertexEntityId(0))).toBeDefined();
    expect(ds.entities.getById(MOVE_HANDLE_ID)).toBeUndefined();
  });

  it('puts handles on top of the terrain they sit on', () => {
    // A vertex handle buried in a hillside is a shape that cannot be edited.
    const ds = createAuthoringDataSource();
    addSelectionHandles(ds, polygon());
    expect(at(ds.entities.getById(vertexEntityId(0))!.point!.disableDepthTestDistance))
      .toBe(Number.POSITIVE_INFINITY);
  });
});

describe('removeByPrefix', () => {
  it('removes EVERY match, not every other one', () => {
    // `EntityCollection.remove` mutates the values array, so removing while
    // enumerating it skips alternate entries — which showed up as vertex
    // handles that survived a deselect.
    const ds = createAuthoringDataSource();
    for (let i = 0; i < 6; i++) ds.entities.add({ id: vertexEntityId(i) });
    ds.entities.add({ id: itemEntityId('keep') });
    removeByPrefix(ds, 'authoring-vertex:');
    expect(ds.entities.values.map((e) => e.id)).toEqual([itemEntityId('keep')]);
  });
});

describe('the draft preview', () => {
  const draw = (mode: 'line' | 'polygon', ...pts: { lon: number; lat: number }[]): DraftState =>
    pts.reduce(addVertex, createDraft(mode));

  it('draws the rubber band through the cursor without making it a vertex', () => {
    const ds = createAuthoringDataSource();
    const entities = addDraftEntities(ds, '#72ddd4', 0.35);
    const draft = setHover(draw('line', p(0, 0), p(1, 1)), p(2, 2));
    updateDraftEntities(ds, entities, draft);
    expect(at(entities.line.polyline!.positions)).toHaveLength(3);
    // Two placed vertices → two dots.
    expect(ds.entities.values.filter((e) => e.id.startsWith('authoring-draft-vertex:'))).toHaveLength(2);
  });

  it('is NOT clamped to the ground — a rubber band re-batches every mouse move', () => {
    const ds = createAuthoringDataSource();
    const entities = addDraftEntities(ds, '#72ddd4', 0.35);
    expect(at(entities.line.polyline!.clampToGround)).toBe(false);
  });

  it('shows a provisional fill only for a polygon with three points', () => {
    const ds = createAuthoringDataSource();
    const entities = addDraftEntities(ds, '#72ddd4', 0.35);

    updateDraftEntities(ds, entities, setHover(draw('polygon', p(0, 0)), p(1, 1)));
    expect(at(entities.fill.polygon!.show)).toBe(false);

    updateDraftEntities(ds, entities, setHover(draw('polygon', p(0, 0), p(1, 0)), p(1, 1)));
    expect(at(entities.fill.polygon!.show)).toBe(true);

    updateDraftEntities(ds, entities, setHover(draw('line', p(0, 0), p(1, 0)), p(1, 1)));
    expect(at(entities.fill.polygon!.show)).toBe(false);
  });

  it('leaves no stale dot behind after an undo', () => {
    const ds = createAuthoringDataSource();
    const entities = addDraftEntities(ds, '#72ddd4', 0.35);
    updateDraftEntities(ds, entities, draw('polygon', p(0, 0), p(1, 0), p(1, 1)));
    updateDraftEntities(ds, entities, draw('polygon', p(0, 0)));
    expect(ds.entities.values.filter((e) => e.id.startsWith('authoring-draft-vertex:'))).toHaveLength(1);
  });

  it('draws nothing for a one-point polyline', () => {
    const ds = createAuthoringDataSource();
    const entities = addDraftEntities(ds, '#72ddd4', 0.35);
    updateDraftEntities(ds, entities, draw('line', p(0, 0)));
    expect(at(entities.line.polyline!.positions)).toHaveLength(0);
  });
});
