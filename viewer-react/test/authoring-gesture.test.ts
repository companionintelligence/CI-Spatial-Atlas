import { describe, expect, it } from 'vitest';
import {
  DOUBLE_CLICK_PIXELS,
  typingInFormField,
  withinDoubleClick,
} from '../src/authoring/gesture.js';
import { addVertex, createDraft } from '../src/authoring/draft.js';

/**
 * The two input rules, which between them decide whether a click becomes a
 * vertex.
 *
 * Both look trivial and both have a failure mode nobody would find by reading
 * the code: without the pixel guard a polygon gains a phantom 1 m segment every
 * time it is closed, and without the form-field guard the note-text input in
 * the toolbar cannot be edited because Backspace is being eaten by a shape
 * somewhere else on the globe.
 */

describe('the double-click guard', () => {
  it('treats the second click of a double-click as the same gesture', () => {
    expect(withinDoubleClick({ x: 400, y: 300 }, { x: 402, y: 301 })).toBe(true);
    expect(withinDoubleClick({ x: 400, y: 300 }, { x: 400, y: 300 })).toBe(true);
  });

  it('lets a deliberate nearby vertex through', () => {
    expect(withinDoubleClick({ x: 400, y: 300 }, { x: 400 + DOUBLE_CLICK_PIXELS + 1, y: 300 })).toBe(false);
    expect(withinDoubleClick({ x: 400, y: 300 }, { x: 440, y: 340 })).toBe(false);
  });

  it('is never true before the first vertex is placed', () => {
    expect(withinDoubleClick(null, { x: 0, y: 0 })).toBe(false);
    expect(withinDoubleClick(undefined, { x: 0, y: 0 })).toBe(false);
  });

  it('rejects a non-finite position rather than swallowing every click', () => {
    expect(withinDoubleClick({ x: 400, y: 300 }, { x: Number.NaN, y: 300 })).toBe(false);
  });

  it('is the screen-space half of a two-part defence', () => {
    // The geometric half (exact duplicates) is in `addVertex`, and on its own
    // it cannot catch a double-click whose two events landed two pixels apart:
    // at street zoom that is two genuinely different GeoPoints.
    const twoPixelsApart = addVertex(
      addVertex(createDraft('polygon'), { lon: 0, lat: 0 }),
      { lon: 0.000_01, lat: 0 },
    );
    expect(twoPixelsApart.vertices).toHaveLength(2);
    // …which is exactly why the controller measures the gesture in pixels
    // before it ever reaches the geometry.
    expect(withinDoubleClick({ x: 400, y: 300 }, { x: 402, y: 300 })).toBe(true);
  });
});

describe('the form-field guard', () => {
  it('yields to text entry', () => {
    expect(typingInFormField({ tagName: 'INPUT' })).toBe(true);
    expect(typingInFormField({ tagName: 'textarea' })).toBe(true);
    expect(typingInFormField({ tagName: 'SELECT' })).toBe(true);
    expect(typingInFormField({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('claims the keystroke everywhere else', () => {
    // A Cesium canvas is not focusable, so the shortcuts have to live on
    // `window` — which is why this predicate exists at all.
    expect(typingInFormField({ tagName: 'CANVAS' })).toBe(false);
    expect(typingInFormField({ tagName: 'BODY' })).toBe(false);
    expect(typingInFormField({ tagName: 'DIV', isContentEditable: false })).toBe(false);
  });

  it('survives a target that is not an element at all', () => {
    expect(typingInFormField(null)).toBe(false);
    expect(typingInFormField(undefined)).toBe(false);
    expect(typingInFormField('window')).toBe(false);
    expect(typingInFormField({})).toBe(false);
  });
});
