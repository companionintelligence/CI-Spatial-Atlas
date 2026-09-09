/**
 * Collecting a journey stop that is not really a memory.
 *
 * A journey stop built from a scene checked into the journey (see
 * `journeySceneMemories` in AtlasApp.tsx) carries that scene's OWN id — which
 * the base story need not contain at all; the scene can live purely in the
 * editable deck (`sceneControl.scenes`), never saved anywhere. Collecting one
 * with the ordinary "Collect" button used to write that id straight into
 * `sb.draft.memoryIds`, the persisted scrapbook draft — and since `sbEntries`
 * resolves ids only against `baseModel.memories`, an id that never appears
 * there stays in local storage forever with nothing on screen to explain it:
 * not a crash, just a silent, growing pile of dead entries.
 *
 * `AtlasApp`'s guard, verbatim (same pattern as `empty-import-guard.test.ts`):
 * an id can only ever be newly collected if it resolves to something real.
 */
import { describe, expect, it } from 'vitest';

interface Memory { id: string }

/** `canCollect`, verbatim. */
const canCollect = (baseMemories: Memory[], id: string): boolean =>
  baseMemories.some((bm) => bm.id === id);

/** `toggleCollect`'s decision, verbatim: an id already collected can always be
 *  removed; a new one is added only when it resolves. */
const toggleOutcome = (o: { has: boolean; baseMemories: Memory[]; id: string }): 'remove' | 'add' | 'noop' => {
  if (o.has) return 'remove';
  if (!canCollect(o.baseMemories, o.id)) return 'noop';
  return 'add';
};

const REAL_MEMORY: Memory = { id: 'mem-1' };

describe('a real memory', () => {
  it('can be newly collected', () => {
    expect(canCollect([REAL_MEMORY], 'mem-1')).toBe(true);
    expect(toggleOutcome({ has: false, baseMemories: [REAL_MEMORY], id: 'mem-1' })).toBe('add');
  });

  it('can always be un-collected once it is', () => {
    expect(toggleOutcome({ has: true, baseMemories: [], id: 'mem-1' })).toBe('remove');
  });
});

describe('a scene-derived journey stop with no base memory to resolve to', () => {
  it('refuses to be newly collected', () => {
    expect(canCollect([REAL_MEMORY], 'atlas-scene-early')).toBe(false);
    expect(toggleOutcome({ has: false, baseMemories: [REAL_MEMORY], id: 'atlas-scene-early' })).toBe('noop');
  });

  it('can still be removed if it was somehow already collected', () => {
    // Cleanup must not be blocked by the same guard that stops new pollution.
    expect(toggleOutcome({ has: true, baseMemories: [REAL_MEMORY], id: 'atlas-scene-early' })).toBe('remove');
  });
});

describe('what the Collect button is offered for', () => {
  // Mirrors AtlasApp's onCollect condition: `collected(focused) || canCollect(focused)`.
  const offered = (already: boolean, resolvable: boolean) => already || resolvable;

  it('is offered for anything already collected, resolvable or not', () => {
    expect(offered(true, false)).toBe(true);
  });

  it('is offered for a resolvable memory not yet collected', () => {
    expect(offered(false, true)).toBe(true);
  });

  it('is withheld rather than left silently inert', () => {
    // The button must not exist to be clicked and do nothing — see the
    // codebase's own rule: "a control that appears to work and goes nowhere
    // is worse than no control."
    expect(offered(false, false)).toBe(false);
  });
});
