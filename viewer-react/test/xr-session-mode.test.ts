import { describe, expect, it } from 'vitest';
import { clearAlphaFor, skyboxVisible } from '../src/renderers/xr/sessionMode.js';

describe('skyboxVisible', () => {
  it('hides the sky in AR so passthrough is not painted over', () => {
    expect(skyboxVisible('immersive-ar')).toBe(false);
  });

  it('shows the sky in VR, inline, and before any session exists', () => {
    expect(skyboxVisible('immersive-vr')).toBe(true);
    expect(skyboxVisible('inline')).toBe(true);
    expect(skyboxVisible(null)).toBe(true);
    expect(skyboxVisible(undefined)).toBe(true);
  });
});

describe('clearAlphaFor', () => {
  it('is transparent in AR and opaque everywhere else', () => {
    expect(clearAlphaFor('immersive-ar')).toBe(0);
    expect(clearAlphaFor('immersive-vr')).toBe(1);
    expect(clearAlphaFor(null)).toBe(1);
  });
});

// projectionFar is not exported (it is an implementation detail of Celestials),
// so this pins the identity it relies on: for a three.js perspective matrix,
// far == m14 / (m10 + 1).
describe('perspective far-plane recovery', () => {
  const farFrom = (n: number, f: number) => {
    const m10 = (f + n) / (n - f);
    const m14 = (2 * f * n) / (n - f);
    return m14 / (m10 + 1);
  };
  it('recovers far across the range this scene actually uses', () => {
    // Relative, not absolute: the globe scene spans seven orders of magnitude
    // of far plane, and at 1e6 an absolute tolerance fails on float noise that
    // is one part in a billion.
    for (const [n, f] of [[0.02, 13.7], [0.035, 400], [0.1, 1e6]] as const) {
      expect(Math.abs(farFrom(n, f) - f) / f).toBeLessThan(1e-9);
    }
  });
});
