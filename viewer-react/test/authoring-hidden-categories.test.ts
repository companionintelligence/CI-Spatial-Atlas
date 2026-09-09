/**
 * The top-nav visibility popover's "off" checkboxes, at the controller level.
 *
 * Same fakes as `authoring-enabled.test.ts`: no input is synthesised, only
 * `items`/entities are inspected. The property under test is the one the
 * popover promises: hiding a category takes it off the globe and nothing
 * else — the item stays in `items` (so the story is untouched, and unhiding
 * needs no reload), and every other category stays exactly as drawn.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import type { Item } from '@companion-atlas/story';
import { createAuthoringController, type AuthoringController } from '../src/authoring/controller.js';
import { itemEntityId, vertexEntityId } from '../src/authoring/ids.js';

interface FakeElement {
  listeners: Map<string, Set<(e: unknown) => void>>;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  removeEventListener(type: string, fn: (e: unknown) => void): void;
  classList: { add(): void; remove(): void; toggle(): void };
  style: Record<string, string>;
  setAttribute(): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

function fakeElement(): FakeElement {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
}

const g = globalThis as unknown as Record<string, unknown>;
g.document ??= { ...fakeElement(), createElement: () => fakeElement(), documentElement: { style: {} } };
g.window = fakeElement();
g.navigator ??= { userAgent: 'node', maxTouchPoints: 0 };

function fakeViewer() {
  const dataSources = new Cesium.DataSourceCollection();
  return {
    isDestroyed: () => false,
    dataSources,
    container: fakeElement(),
    screenSpaceEventHandler: {
      getInputAction: () => undefined,
      setInputAction: () => {},
      removeInputAction: () => {},
      isDestroyed: () => false,
    },
    scene: {
      canvas: fakeElement(),
      requestRender: () => {},
      screenSpaceCameraController: {
        enableRotate: true, enableTranslate: true, enableTilt: true, enableLook: true,
      },
    },
  } as unknown as Cesium.Viewer;
}

const p = (lon: number, lat: number) => ({ lon, lat });
const note: Item = { id: 'n1', type: 'note', position: p(0, 0), text: 'hi', source: { kind: 'manual' } } as Item;
const marker: Item = { id: 'm1', type: 'marker', position: p(1, 1), source: { kind: 'manual' } } as Item;

async function drawingLayer(viewer: Cesium.Viewer): Promise<Cesium.DataSource> {
  await Promise.resolve();
  await Promise.resolve();
  return viewer.dataSources.get(0);
}

const drawnIds = (ds: Cesium.DataSource): string[] =>
  ds.entities.values.map((e) => e.id).filter((id) => id.startsWith('authoring:'));

let viewer: Cesium.Viewer;
let controller: AuthoringController;

beforeEach(() => {
  viewer = fakeViewer();
  controller = createAuthoringController(viewer, {});
});

afterEach(() => {
  controller.destroy();
});

describe('hidden categories', () => {
  it('starts empty — nothing is hidden until the popover says so', () => {
    expect(controller.getHiddenCategories().size).toBe(0);
  });

  it('takes a category off the globe without touching the others', async () => {
    controller.setItems([note, marker]);
    const ds = await drawingLayer(viewer);
    expect(drawnIds(ds)).toContain(itemEntityId(note.id));
    expect(drawnIds(ds)).toContain(itemEntityId(marker.id));

    controller.setHiddenCategories(new Set(['note']));
    expect(drawnIds(ds)).not.toContain(itemEntityId(note.id));
    expect(drawnIds(ds)).toContain(itemEntityId(marker.id));
  });

  it('keeps the hidden item in `items` — unhiding needs no reload', async () => {
    controller.setItems([note]);
    controller.setHiddenCategories(new Set(['note']));
    expect(controller.getItems().map((i) => i.id)).toContain('n1');

    controller.setHiddenCategories(new Set());
    const ds = await drawingLayer(viewer);
    expect(drawnIds(ds)).toContain(itemEntityId(note.id));
  });

  it('is a no-op when set to the same set instance it already holds', () => {
    const same = new Set<Item['type']>(['note']);
    controller.setHiddenCategories(same);
    const first = controller.getHiddenCategories();
    controller.setHiddenCategories(same);
    expect(controller.getHiddenCategories()).toBe(first);
  });

  describe('a selected item whose category is hidden', () => {
    // The bug this guards against: `redrawItems` skips the item's own entity
    // for a hidden category, but its drag handles are drawn from `selection`
    // alone, with no hiddenCategories check of their own — so without this,
    // hiding a category left a selected item's handle floating on the globe,
    // still draggable, silently rewriting geometry the user could no longer
    // see to check.
    it('is deselected — its handle does not survive the hide', async () => {
      controller.setItems([note]);
      controller.select({ kind: 'item', id: note.id });
      const ds = await drawingLayer(viewer);
      expect(ds.entities.getById(vertexEntityId(0))).toBeTruthy();

      controller.setHiddenCategories(new Set(['note']));

      expect(controller.getSelection()).toBeNull();
      expect(ds.entities.getById(vertexEntityId(0))).toBeFalsy();
      // The item itself is untouched — only the selection and its handle.
      expect(controller.getItems().map((i) => i.id)).toContain('n1');
    });

    it('leaves an unrelated selection alone', async () => {
      controller.setItems([note, marker]);
      controller.select({ kind: 'item', id: marker.id });

      controller.setHiddenCategories(new Set(['note']));

      expect(controller.getSelection()).toMatchObject({ kind: 'item', id: marker.id });
    });

    it('leaves the selection alone when the hidden set does not include its type', async () => {
      controller.setItems([note, marker]);
      controller.select({ kind: 'item', id: note.id });

      controller.setHiddenCategories(new Set(['marker']));

      expect(controller.getSelection()).toMatchObject({ kind: 'item', id: note.id });
    });
  });
});

/**
 * Reselecting a note after its card was closed — the mechanism `NoteCard`'s
 * close button (via `AtlasApp`'s `closeNote`) depends on.
 *
 * `NoteCard` shows whatever the controller's `onSelect` last reported; if
 * closing the card only cleared React state and left the controller's
 * `selection` pointed at the same note, clicking that SAME note again would
 * be a no-op — `setSelection` only notifies when `kind`/`id` actually change,
 * and neither would have. The fix is `closeNote` also calling `draw.select(null)`.
 * This is the property that makes that fix work: deselecting, then selecting
 * the same item again, must notify BOTH times, not just the first.
 */
describe('selecting the same item again after deselecting', () => {
  it('notifies onSelect on the deselect, and again on the reselect', () => {
    const v = fakeViewer();
    const seen: Array<{ kind: string; id: string } | null> = [];
    const c = createAuthoringController(v, {
      onSelect: (sel) => seen.push(sel ? { kind: sel.kind, id: sel.id } : null),
    });
    c.setItems([note]);

    c.select({ kind: 'item', id: note.id });
    c.select(null); // what `closeNote` does
    c.select({ kind: 'item', id: note.id }); // clicking the same note again

    expect(seen).toEqual([
      { kind: 'item', id: note.id },
      null,
      { kind: 'item', id: note.id },
    ]);
    c.destroy();
  });

  it('is a genuine no-op re-selecting without deselecting first — the bug this replaces', () => {
    // Documents the defect precisely: without a deselect in between,
    // `setSelection` sees no kind/id change and stays silent.
    const v = fakeViewer();
    const seen: unknown[] = [];
    const c = createAuthoringController(v, { onSelect: (sel) => seen.push(sel) });
    c.setItems([note]);

    c.select({ kind: 'item', id: note.id });
    c.select({ kind: 'item', id: note.id });

    expect(seen).toHaveLength(1);
    c.destroy();
  });
});
