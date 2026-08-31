/**
 * The wrist panel's size budget.
 *
 * These numbers are the whole point of `wristPanel.ts`, and they are the kind
 * that drift silently: nothing crashes when a panel is twice as big as it
 * should be, it just stops being usable, and the only way anyone finds out is
 * by putting a headset on. What went wrong the first time was not one bad
 * constant but three that were never checked against each other — width, the
 * distance it is read from, and how much text a row carries.
 *
 * So the assertions here are the design, in the units a viewer experiences:
 * degrees of visual angle.
 */
import { describe, expect, it } from 'vitest';
import { infoCardHeight } from '../src/renderers/xr/labelCard.js';
import {
  fadeTowards,
  glanceVisible,
  panelHeight,
  panelLift,
  subtendDeg,
  GLANCE_DEG,
  HAND_CLEARANCE,
  PANEL_MAX_DEG,
  PANEL_PX,
  PANEL_WIDTH,
  READING_DISTANCE,
  ROW_DEG,
} from '../src/renderers/xr/wristPanel.js';
import { INFO_CARD_METRICS } from '../src/renderers/xr/labelCard.js';

/** A card of `rows` rows, as `drawInfoCard` would size it for the menu. */
const card = (rows: number) => ({
  rows,
  aspect: PANEL_PX / infoCardHeight(rows),
  height: panelHeight(PANEL_PX / infoCardHeight(rows)),
});

/** Angular height of one row of an `rows`-row panel, read from `distance`. */
const rowDeg = (rows: number, distance = READING_DISTANCE) => {
  const c = card(rows);
  return subtendDeg((INFO_CARD_METRICS.row / infoCardHeight(rows)) * c.height, distance);
};

/**
 * What the menu can actually produce: search + sort + kind + initial (+ clear)
 * + a page of six + both pagers is the ceiling; a hard filter down to one
 * result with no pagers is the floor.
 */
const ROW_COUNTS = [6, 8, 10, 11, 12, 13];

describe('wrist panel geometry', () => {
  it('is a held thing, not a wall — under 32° wide from the hand', () => {
    const wide = subtendDeg(PANEL_WIDTH, READING_DISTANCE);
    expect(wide).toBeLessThan(PANEL_MAX_DEG);
    // The bug this replaces: 0.477 m read from 0.307 m, which is 75.7°.
    expect(wide).toBeLessThan(subtendDeg(0.477, 0.307) / 2);
  });

  it('keeps every row legible at every row count the menu can produce', () => {
    for (const rows of ROW_COUNTS) {
      expect(rowDeg(rows)).toBeGreaterThanOrEqual(ROW_DEG.floor);
    }
  });

  it('stays a comfortable read even at arm’s length, where a raised hand puts it', () => {
    // Straightening the arm is the worst case for legibility: same panel, more
    // distance. 0.6 m is about as far as an off hand gets while still being a
    // thing you are holding.
    for (const rows of ROW_COUNTS) {
      expect(rowDeg(rows, 0.6)).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('grows downwards, not outwards, as rows come and go', () => {
    // The other half of the original bug: fixing the *height* and taking width
    // from the card's aspect made a panel with fewer rows come out wider — a
    // filter down to one result took it from 0.48 m to 0.76 m across.
    const few = card(6);
    const many = card(13);
    expect(few.height).toBeLessThan(many.height);
    // Width is not a function of row count at all any more.
    expect(PANEL_WIDTH).toBe(0.22);
    // And the tallest panel is still shorter than it is wide plus a bit.
    expect(subtendDeg(many.height, READING_DISTANCE)).toBeLessThan(PANEL_MAX_DEG);
  });

  it('hangs off the hand rather than over it, whatever it is holding', () => {
    for (const rows of ROW_COUNTS) {
      const { height } = card(rows);
      // Bottom edge = lift - height/2, and that is the clearance, exactly.
      expect(panelLift(height) - height / 2).toBeCloseTo(HAND_CLEARANCE, 10);
      // The constant this replaces put the panel's *centre* 0.2 m up the grip
      // axis whatever it was holding. Deriving the lift never raises it that
      // far, which is the difference between a card on a wrist and a slab in
      // front of the face.
      expect(panelLift(height)).toBeLessThan(0.2);
    }
  });
});

describe('glancing at it', () => {
  it('comes up when looked at and goes away when not', () => {
    expect(glanceVisible(false, 5)).toBe(true);
    expect(glanceVisible(true, 60)).toBe(false);
  });

  it('does not blink when a hand drifts across the threshold', () => {
    const between = (GLANCE_DEG.on + GLANCE_DEG.off) / 2;
    expect(glanceVisible(false, between)).toBe(false); // still away
    expect(glanceVisible(true, between)).toBe(true); // still up
  });

  it('leaves a resting hand out of the way, and a glance at it brings the list back', () => {
    // Measured in a live emulated session: a resting off hand is 0.462 m from
    // the eye and 0.368 m of that is straight ahead, which is 37° off the gaze.
    const resting = (Math.acos(0.368 / 0.462) * 180) / Math.PI;
    expect(resting).toBeGreaterThan(GLANCE_DEG.off);
    expect(glanceVisible(true, resting)).toBe(false);
    // And looking at that hand is well inside the other threshold — the band
    // between the two poses is what both numbers have to fit into.
    expect(GLANCE_DEG.on).toBeLessThan(resting - 10);
  });
});

describe('fading', () => {
  it('reaches the target and stops there', () => {
    expect(fadeTowards(0, 1, 1)).toBe(1);
    expect(fadeTowards(1, 0, 1)).toBe(0);
    expect(fadeTowards(1, 1, 0.016)).toBe(1);
  });

  it('takes a beat rather than snapping', () => {
    let v = 0;
    let frames = 0;
    while (v < 1 && frames < 100) {
      v = fadeTowards(v, 1, 1 / 72); // a Quest frame
      frames++;
    }
    expect(frames).toBeGreaterThan(4);
    expect(frames).toBeLessThan(20);
  });
});
