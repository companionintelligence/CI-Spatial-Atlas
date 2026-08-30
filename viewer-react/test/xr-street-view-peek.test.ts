import { describe, expect, it } from 'vitest';
import {
  choosePeek,
  peekCredit,
  peekHand,
  PEEK_MIN_GAZE,
  PEEK_SWITCH_MARGIN,
} from '../src/renderers/xr/streetViewPeek.js';
import { curvedPlateGeometry } from '../src/renderers/xr/curvedPlate.js';

/**
 * The peek plate's decisions, without a headset.
 *
 * Everything the plate does that can be got wrong quietly lives here: what it
 * points at, which hand it rides, and what it says about whose picture it is.
 * The three.js half — texture upload, grip poses — is exercised in the emulator
 * instead; there is nothing to assert about it that a unit test could see.
 */

const at = (id: string, towards: number) => ({ id, towards });

describe('choosePeek', () => {
  it('shows the memory the viewer picked, whatever they are looking at', () => {
    // Focus is a statement of intent, and it has to survive turning your head —
    // otherwise picking a pin and then looking down at the plate loses it.
    expect(choosePeek({ focusedId: 'chosen', current: null, candidates: [at('ahead', 0.99)] })).toBe('chosen');
  });

  it('follows the gaze when nothing is focused', () => {
    const picked = choosePeek({
      focusedId: null,
      current: null,
      candidates: [at('edge', 0.62), at('centre', 0.95), at('off', 0.7)],
    });
    expect(picked).toBe('centre');
  });

  it('ignores memories outside the gaze cone', () => {
    expect(
      choosePeek({ focusedId: null, current: null, candidates: [at('behind', PEEK_MIN_GAZE - 0.01)] }),
    ).toBeNull();
  });

  it('shows nothing when nothing is in view', () => {
    expect(choosePeek({ focusedId: null, current: null, candidates: [] })).toBeNull();
  });

  it('holds its target through a near tie rather than flickering', () => {
    // Two venues a degree apart, the head drifting between them. Each switch
    // costs a metadata round trip and a new texture, and looks like a fault.
    const held = choosePeek({
      focusedId: null,
      current: 'held',
      candidates: [at('held', 0.90), at('rival', 0.90 + PEEK_SWITCH_MARGIN - 0.01)],
    });
    expect(held).toBe('held');
  });

  it('does switch once a rival is clearly better', () => {
    const switched = choosePeek({
      focusedId: null,
      current: 'held',
      candidates: [at('held', 0.80), at('rival', 0.80 + PEEK_SWITCH_MARGIN + 0.01)],
    });
    expect(switched).toBe('rival');
  });

  it('lets go of a target that has left the view', () => {
    // Hysteresis must not become stickiness: the held memory is no longer a
    // candidate at all, so it cannot be what the plate keeps showing.
    expect(choosePeek({ focusedId: null, current: 'gone', candidates: [at('here', 0.8)] })).toBe('here');
  });
});

describe('peekHand', () => {
  it('takes the off hand, leaving the other free to point and grab', () => {
    expect(peekHand(['left', 'right'], 'left')).toBe('left');
    expect(peekHand(['left', 'right'], 'right')).toBe('right');
  });

  it('falls back to the only tracked controller', () => {
    // A plate on a hand that is not being tracked is no plate at all.
    expect(peekHand(['right'], 'left')).toBe('right');
  });

  it('prefers a handed controller over an unhanded one', () => {
    expect(peekHand(['none', 'right'], 'left')).toBe('right');
  });

  it('has nowhere to go with no input sources', () => {
    expect(peekHand([], 'left')).toBeNull();
  });
});

describe('peekCredit', () => {
  it('names the source and the capture date', () => {
    // The date is Google's, not the memory's — usually years apart, which is
    // exactly why it is shown.
    expect(peekCredit('2018-04')).toBe('Street View · 2018-04');
  });

  it('still names the source when the date is missing', () => {
    expect(peekCredit(undefined)).toBe('Street View');
  });
});

describe('curvedPlateGeometry', () => {
  const width = 0.28;
  const height = 0.2;
  const curvature = 0.08;
  const segments = 8;

  const read = () => {
    const geometry = curvedPlateGeometry({ width, height, curvature, segments });
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    return { geometry, position, uv };
  };

  it('builds one quad strip across the bow', () => {
    const { geometry, position } = read();
    expect(position.count).toBe((segments + 1) * 2);
    expect(geometry.getIndex()!.count).toBe(segments * 6);
    geometry.dispose();
  });

  it('keeps the chord width and the height exactly as asked', () => {
    // The plate is sized in player metres by its caller, which computes the
    // height from the texture's aspect. A geometry that quietly grew with the
    // curvature would stretch the picture.
    const { geometry, position } = read();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < position.count; i++) {
      minX = Math.min(minX, position.getX(i));
      maxX = Math.max(maxX, position.getX(i));
      minY = Math.min(minY, position.getY(i));
      maxY = Math.max(maxY, position.getY(i));
    }
    expect(maxX - minX).toBeCloseTo(width, 6);
    expect(maxY - minY).toBeCloseTo(height, 6);
    geometry.dispose();
  });

  it('bows the edges toward the viewer and leaves the middle flat', () => {
    const { geometry, position } = read();
    const zAt = (x: number) => {
      for (let i = 0; i < position.count; i++) {
        if (Math.abs(position.getX(i) - x) < 1e-6) return position.getZ(i);
      }
      return Number.NaN;
    };
    expect(zAt(0)).toBeCloseTo(0, 6);
    // Sagitta is the curvature times the width, at both edges alike.
    expect(zAt(width / 2)).toBeCloseTo(width * curvature, 6);
    expect(zAt(-width / 2)).toBeCloseTo(width * curvature, 6);
    geometry.dispose();
  });

  it('is flat when asked to be', () => {
    const geometry = curvedPlateGeometry({ width, height, curvature: 0, segments });
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) expect(position.getZ(i)).toBe(0);
    geometry.dispose();
  });

  it('spreads the texture evenly, corner to corner', () => {
    // Evenly, because the columns are evenly spaced in x: an arc would bunch
    // them at the edges and stretch the picture there.
    const { geometry, uv } = read();
    const us = new Set<number>();
    for (let i = 0; i < uv.count; i++) {
      us.add(Number(uv.getX(i).toFixed(6)));
      expect(uv.getY(i) === 0 || uv.getY(i) === 1).toBe(true);
    }
    expect([...us].sort((a, b) => a - b)).toEqual(
      Array.from({ length: segments + 1 }, (_, i) => Number((i / segments).toFixed(6))),
    );
    geometry.dispose();
  });

  it('faces the viewer, so the picture is not on the back', () => {
    const { geometry, position } = read();
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) expect(normal.getZ(i)).toBeGreaterThan(0);

    // And the winding agrees: the first triangle is counter-clockwise seen
    // from +Z, which is what makes that the front face.
    const index = geometry.getIndex()!;
    const [a, b, c] = [index.getX(0), index.getX(1), index.getX(2)];
    const cross =
      (position.getX(b) - position.getX(a)) * (position.getY(c) - position.getY(a)) -
      (position.getY(b) - position.getY(a)) * (position.getX(c) - position.getX(a));
    expect(cross).toBeGreaterThan(0);
    geometry.dispose();
  });
});
