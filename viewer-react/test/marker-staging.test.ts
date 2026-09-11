/**
 * The Finish button, and why it did nothing.
 *
 * Placing a marker committed on the click: `controller.ts` called `commit()`
 * the moment the globe was hit and returned. The draft was reset in the same
 * tick, so `vertexCount` went 0 → 1 → 0 without a render in between, and
 * `canFinish` — which is `vertices.length >= MIN_VERTICES` — was never once
 * observed true. The button was therefore permanently disabled: not broken in
 * the sense of throwing, just incapable of ever being pressed.
 *
 * A marker now stages instead. That is what gives Finish something to do, and
 * it is also the only way the pin can be looked at before it is kept — read its
 * coordinates, wait for the address, move it, then commit.
 */
import { describe, expect, it } from 'vitest';
import {
  addVertex, canFinish, createDraft, setMode, snapshot, undoVertex,
  COMMIT_ON_CLICK_MODES, SINGLE_VERTEX_MODES,
} from '../src/authoring/draft.js';
import { formatLatLon } from '../src/authoring/Toolbar.js';

const REYKJAVIK = { lat: 64.1466, lon: -21.9426 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };

const marker = () => setMode(createDraft(), 'marker');

describe('a staged marker can be finished', () => {
  it('is finishable with one point — the state the old flow never let you see', () => {
    const d = addVertex(marker(), REYKJAVIK);
    expect(d.vertices).toHaveLength(1);
    expect(canFinish(d)).toBe(true);
    expect(snapshot(d).canFinish).toBe(true);
  });

  it('is not finishable before the first click', () => {
    expect(canFinish(marker())).toBe(false);
    expect(snapshot(marker()).canFinish).toBe(false);
  });

  it('does not commit on the click any more', () => {
    // The controller consults this list, so the list is the behaviour.
    expect(COMMIT_ON_CLICK_MODES).not.toContain('marker');
  });

  it('still commits a note on the click, which has nothing left to confirm', () => {
    // A note's text is typed before the click; there is no second step to add.
    expect(COMMIT_ON_CLICK_MODES).toContain('note');
  });
});

describe('one pin at a time', () => {
  it('moves the pin rather than adding a second', () => {
    const d = addVertex(addVertex(marker(), REYKJAVIK), SYDNEY);
    expect(d.vertices).toHaveLength(1);
    expect(d.vertices[0]).toMatchObject(SYDNEY);
  });

  it('is the same rule for a note, and not for a path', () => {
    expect(SINGLE_VERTEX_MODES).toEqual(expect.arrayContaining(['marker', 'note']));
    expect(SINGLE_VERTEX_MODES).not.toContain('line');
    expect(SINGLE_VERTEX_MODES).not.toContain('polygon');
    const line = addVertex(addVertex(setMode(createDraft(), 'line'), REYKJAVIK), SYDNEY);
    expect(line.vertices).toHaveLength(2);
  });

  it('takes the pin back to nothing, so the tool stays armed and empty', () => {
    const d = undoVertex(addVertex(marker(), REYKJAVIK));
    expect(d.vertices).toHaveLength(0);
    expect(canFinish(d)).toBe(false);
  });
});

describe('the panel can say where the pin is', () => {
  it('carries the staged coordinate on the snapshot', () => {
    expect(snapshot(addVertex(marker(), REYKJAVIK)).point).toMatchObject(REYKJAVIK);
  });

  it('carries none before a click, and none for a path', () => {
    expect(snapshot(marker()).point).toBeNull();
    const line = addVertex(setMode(createDraft(), 'line'), REYKJAVIK);
    // A line has many points and no single "the pin is here" to report.
    expect(snapshot(line).point).toBeNull();
  });
});

describe('coordinates as a person reads them', () => {
  it('uses hemisphere letters rather than signs', () => {
    expect(formatLatLon(64.1466, -21.9426)).toBe('64.1466°N 21.9426°W');
    expect(formatLatLon(-33.8688, 151.2093)).toBe('33.8688°S 151.2093°E');
  });

  it('does not print a coordinate it does not have', () => {
    expect(formatLatLon(NaN, 0)).toBe('—');
    expect(formatLatLon(0, Infinity)).toBe('—');
  });
});
