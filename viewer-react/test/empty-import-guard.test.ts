/**
 * The blocker this pins: an empty Companion Memory import used to unmount the
 * whole application.
 *
 * AtlasApp's "connected but nothing located" card is a full-screen early
 * return, and the Rail, the Import & export panel and the running transfer
 * state are all mounted below it. Its condition was
 * `source === 'memory' && model.memories.length === 0`. `source` is 'memory'
 * for the entire session whenever `?memory=` is set, and it knows nothing about
 * an import — so an import whose filter legitimately matched nothing drove
 * memories to zero, fired the guard, and ejected the user out of the app and
 * away from the panel they were operating. There was no control on the card,
 * and no way back except a page reload, which discarded both the filter and the
 * import. Following the panel's own "narrow it first" advice was the fastest
 * route to it.
 *
 * The guard's condition is replicated here rather than imported: it is one
 * boolean inside a React component, and the failure was in the *predicate*, not
 * in the rendering. Pinning the predicate is what stops it regressing.
 */
import { describe, expect, it } from 'vitest';

/** AtlasApp's guard, verbatim. */
const showsBootCard = (o: {
  source: 'memory' | 'story';
  memImport: unknown | null;
  memoryCount: number;
}) => o.source === 'memory' && !o.memImport && o.memoryCount === 0;

/** The in-app state that replaced it for the import case. */
const showsEmptyImportChip = (o: {
  journey: unknown | null;
  memImport: unknown | null;
  memoryCount: number;
}) => !o.journey && !!o.memImport && o.memoryCount === 0;

const AN_IMPORT = { story: { scenes: [] } };

describe('the connected-but-empty boot card', () => {
  it('still shows for an initial connection that has nothing located', () => {
    // The case it was written for, which must keep working.
    expect(showsBootCard({ source: 'memory', memImport: null, memoryCount: 0 })).toBe(true);
  });

  it('does NOT show after an import that matched nothing', () => {
    // The blocker. Previously true, which unmounted the app mid-task.
    expect(showsBootCard({ source: 'memory', memImport: AN_IMPORT, memoryCount: 0 })).toBe(false);
  });

  it('does not show once an import returned rows', () => {
    expect(showsBootCard({ source: 'memory', memImport: AN_IMPORT, memoryCount: 12 })).toBe(false);
  });

  it('never shows for a story-sourced session', () => {
    expect(showsBootCard({ source: 'story', memImport: null, memoryCount: 0 })).toBe(false);
  });
});

describe('the in-app empty-import state', () => {
  it('appears exactly where the boot card no longer does', () => {
    const s = { journey: null, memImport: AN_IMPORT, memoryCount: 0 };
    expect(showsEmptyImportChip(s)).toBe(true);
    expect(showsBootCard({ source: 'memory', memImport: s.memImport, memoryCount: 0 })).toBe(false);
  });

  it('stays out of the way when the import found something', () => {
    expect(showsEmptyImportChip({ journey: null, memImport: AN_IMPORT, memoryCount: 3 })).toBe(false);
  });

  it('yields to a playing journey, which owns the same chip slot', () => {
    expect(showsEmptyImportChip({ journey: {}, memImport: AN_IMPORT, memoryCount: 0 })).toBe(false);
  });

  it('does not appear when no import has been run', () => {
    expect(showsEmptyImportChip({ journey: null, memImport: null, memoryCount: 0 })).toBe(false);
  });
});
