/**
 * What `?view=` and `?t=` are up against.
 *
 * The share panel writes them, `restoredView` parses them, and `embedUrl.ts`
 * has tests for both halves — and none of that made the parameters do anything,
 * because `AtlasApp` has *two* other things that move the camera at boot:
 *
 *  1. The opening flight, which frames the first memory a beat after the viewer
 *     is ready. It ran unconditionally, so every shared link opened in
 *     Reykjavík no matter what it said.
 *  2. The playback fly-through, which fires on the next clock tick and flies to
 *     whichever memory the playhead has last passed. On any link that opens
 *     mid-story that is a memory somewhere else entirely, so even with (1)
 *     fixed the camera left the requested view about a second after reaching
 *     it — the kind of failure that reads as "the link is flaky" rather than as
 *     a bug.
 *
 * And `?t=` needs clamping. It is stale in a shared link (a story can be re-cut
 * shorter) and attacker-supplied in an embed, and an out-of-range value split
 * the display from the globe: `setCurrentMs` took it while Cesium's CLAMPED
 * clock quietly held the playhead at the end, so the scrubber read a date the
 * globe was not showing.
 *
 * The effect body is React and Cesium; its *decisions* are these functions.
 */
import { describe, expect, it } from 'vitest';
import { restoredView } from '../src/embed/index.js';

interface Mem { id: string; timeMs: number }

/** `AtlasApp.lastPassed`, verbatim. */
const lastPassed = (memories: Mem[], ms: number): Mem | null => {
  let best: Mem | null = null;
  for (const m of memories) {
    if (m.timeMs <= ms && (!best || m.timeMs > best.timeMs)) best = m;
  }
  return best;
};

/** The intro effect's decision, minus React and Cesium. */
const openingShot = (o: {
  opened: { camera: unknown | null; timeMs: number | null };
  openedDone: boolean;
  memories: Mem[];
  timeline: { startMs: number; stopMs: number };
  /** The Cesium clock, in ms, at the moment the effect runs. */
  clockMs: number;
}) => {
  if ((o.opened.camera || o.opened.timeMs != null) && !o.openedDone) {
    const scrubTo = o.opened.timeMs != null
      ? Math.min(Math.max(o.opened.timeMs, o.timeline.startMs), o.timeline.stopMs)
      : null;
    const atMs = scrubTo ?? o.clockMs;
    return {
      kind: 'restore' as const,
      scrubTo,
      paused: o.opened.timeMs != null,
      claims: lastPassed(o.memories, atMs)?.id ?? null,
    };
  }
  const first = o.memories[0];
  return first ? { kind: 'first-memory' as const, id: first.id } : { kind: 'nothing' as const };
};

const MEMORIES: Mem[] = [
  { id: 'reykjavik', timeMs: 1_000 },
  { id: 'singapore', timeMs: 9_000 },
];
const TIMELINE = { startMs: 1_000, stopMs: 9_000 };
const A_CAMERA = { lat: -33.86, lon: 151.21, height: 60_000 };

describe('a restored view wins the opening shot', () => {
  it('does not fly to the first memory when the URL named a camera', () => {
    const shot = openingShot({
      opened: { camera: A_CAMERA, timeMs: null }, openedDone: false,
      memories: MEMORIES, timeline: TIMELINE, clockMs: 1_000,
    });
    expect(shot.kind).toBe('restore');
  });

  it('still flies to the first memory when there is no camera in the URL', () => {
    const shot = openingShot({
      opened: { camera: null, timeMs: null }, openedDone: false,
      memories: MEMORIES, timeline: TIMELINE, clockMs: 1_000,
    });
    expect(shot).toEqual({ kind: 'first-memory', id: 'reykjavik' });
  });

  it('yields to a journey once the URL has had its turn', () => {
    // `introDone` is reset every time a journey is played so the new story gets
    // its own opening flight. `openedDone` is what keeps the page-load view
    // from re-applying itself on top of every journey after that.
    const shot = openingShot({
      opened: { camera: A_CAMERA, timeMs: null }, openedDone: true,
      memories: MEMORIES, timeline: TIMELINE, clockMs: 1_000,
    });
    expect(shot).toEqual({ kind: 'first-memory', id: 'reykjavik' });
  });
});

describe('the playback fly-through does not steal the restored view', () => {
  it('claims the memory the playhead is already standing on', () => {
    // Without the claim, the route effect flies to `singapore` on the next tick
    // and the requested camera is gone.
    const shot = openingShot({
      opened: { camera: A_CAMERA, timeMs: 9_000 }, openedDone: false,
      memories: MEMORIES, timeline: TIMELINE, clockMs: 1_000,
    });
    expect(shot).toMatchObject({ kind: 'restore', claims: 'singapore' });
  });

  it('claims from the live clock when the URL named no time', () => {
    const shot = openingShot({
      opened: { camera: A_CAMERA, timeMs: null }, openedDone: false,
      memories: MEMORIES, timeline: TIMELINE, clockMs: 5_000,
    });
    expect(shot).toMatchObject({ claims: 'reykjavik', paused: false });
  });

  it('claims nothing when the playhead is before every memory', () => {
    const shot = openingShot({
      opened: { camera: A_CAMERA, timeMs: null }, openedDone: false,
      memories: MEMORIES, timeline: { startMs: 0, stopMs: 9_000 }, clockMs: 0,
    });
    expect(shot).toMatchObject({ claims: null });
  });
});

describe('a requested time is clamped into the story it is asking about', () => {
  it('pulls a time past the end back to the end', () => {
    const shot = openingShot({
      opened: { camera: A_CAMERA, timeMs: 9_999_999 }, openedDone: false,
      memories: MEMORIES, timeline: TIMELINE, clockMs: 1_000,
    });
    expect(shot).toMatchObject({ scrubTo: 9_000 });
  });

  it('pulls a time before the start forward to the start', () => {
    const shot = openingShot({
      opened: { camera: A_CAMERA, timeMs: -5 }, openedDone: false,
      memories: MEMORIES, timeline: TIMELINE, clockMs: 1_000,
    });
    expect(shot).toMatchObject({ scrubTo: 1_000 });
  });

  it('leaves a time inside the window alone, and pauses on it', () => {
    const shot = openingShot({
      opened: { camera: A_CAMERA, timeMs: 4_000 }, openedDone: false,
      memories: MEMORIES, timeline: TIMELINE, clockMs: 1_000,
    });
    expect(shot).toMatchObject({ scrubTo: 4_000, paused: true });
  });

  it('does not pause a link that named a view but no time', () => {
    // A shared story link should still play; it just must not play away from
    // the view it was a link to.
    const shot = openingShot({
      opened: { camera: A_CAMERA, timeMs: null }, openedDone: false,
      memories: MEMORIES, timeline: TIMELINE, clockMs: 1_000,
    });
    expect(shot).toMatchObject({ scrubTo: null, paused: false });
  });
});

describe('the parameters the app actually reads', () => {
  it('round-trips what the share panel writes', () => {
    const opened = restoredView('?view=-33.8600,151.2100,60000,45,-35&t=1774008000000');
    expect(opened.camera).toMatchObject({ lat: -33.86, lon: 151.21, height: 60000 });
    expect(opened.timeMs).toBe(1774008000000);
  });

  it('is inert for a URL with neither', () => {
    expect(restoredView('?embed=1')).toEqual({ camera: null, timeMs: null });
  });
});

/**
 * A link that names a moment but no camera.
 *
 * The restore block was gated on `opened.camera`, so `?t=` alone was decoded
 * and then discarded — the app opened at the first memory with the requested
 * moment thrown away. Not a hypothetical URL: the share panel takes its camera
 * from `draw.captureCamera()`, which returns null until the authoring
 * controller mounts, while the time is essentially always set. Atlas could hand
 * out a link its own reader ignored.
 */
describe('a link that carries only a moment', () => {
  const entered = (o: { camera: unknown | null; timeMs: number | null }) =>
    openingShot({ opened: o, openedDone: false, memories: MEMORIES, timeline: TIMELINE, clockMs: 1_000 });

  it('is honoured rather than discarded', () => {
    expect(entered({ camera: null, timeMs: 5_000 })).toMatchObject({ kind: 'restore', scrubTo: 5_000, paused: true });
  });

  it('is clamped like any other requested time', () => {
    expect(entered({ camera: null, timeMs: 9_999_999 })).toMatchObject({ scrubTo: 9_000 });
  });

  it('still claims the memory under the playhead', () => {
    expect(entered({ camera: null, timeMs: 9_000 })).toMatchObject({ claims: 'singapore' });
  });

  it('leaves a URL with neither parameter on the ordinary opening flight', () => {
    expect(entered({ camera: null, timeMs: null })).toEqual({ kind: 'first-memory', id: 'reykjavik' });
  });
});
