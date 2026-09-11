/**
 * The deck list.
 *
 * Rendered with `react-dom/server` rather than mounted, because this workspace
 * has no DOM in its test environment on purpose — the `xr-*`, `layers-*` and
 * `authoring-*` suites all run in node and stay fast for it. Static markup is
 * enough for what actually matters here and cannot be checked by looking at the
 * panel: that the reorder controls are *keyboard-operable buttons* rather than
 * a drag handle, that they are disabled exactly at the ends of the deck, that
 * every row carries its position in its accessible name (the position being the
 * only thing reordering changes), that the live region exists before it has
 * anything to say, and that an empty deck teaches instead of sitting blank.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Scene } from '@companion-atlas/story';
import { SceneList, reorderMessage, sceneRowLabel, sceneTitleFor, type SceneListProps } from '../src/scenes/SceneList.js';
import { buildDeck } from '../src/ui/sceneDeck.js';

const noop = () => {};

const render = (props: Partial<SceneListProps> & { scenes: readonly Scene[] }): string =>
  renderToStaticMarkup(
    createElement(SceneList, {
      selectedId: null,
      onSelect: noop,
      onCreate: noop,
      onRemove: noop,
      onMove: noop,
      ...props,
    }),
  );

const deck = (...titles: (string | undefined)[]): Scene[] =>
  titles.map((title, i) => ({ id: `s${i}`, ...(title === undefined ? {} : { title }) }));

describe('scene titles', () => {
  it('falls back to the position exactly as buildDeck does', () => {
    // If these two disagreed, a scene would be called one thing while being
    // authored and another while being presented, and the author would think
    // they had lost a title.
    const scenes = deck(undefined, '   ', 'Reykjavik');
    const story = {
      schema: 'companion.story/v1' as const,
      id: 'x', title: 'x', scenes,
      timeline: { start: '2024-01-01T00:00:00Z', stop: '2024-01-02T00:00:00Z' },
    };
    const slides = buildDeck(story as never);
    expect(scenes.map((s, i) => sceneTitleFor(s, i))).toEqual(slides.map((s) => s.title));
    expect(slides.map((s) => s.title)).toEqual(['Scene 1', 'Scene 2', 'Reykjavik']);
  });

  it('names a row by its position as well as its title', () => {
    expect(sceneRowLabel({ title: 'Reykjavik' }, 2, 7)).toBe('Scene 3 of 7 · Reykjavik');
    expect(sceneRowLabel({}, 0, 1)).toBe('Scene 1 of 1 · Scene 1');
  });
});

describe('the reorder announcement', () => {
  it('says where the scene landed, not which way it went', () => {
    // "moved down" would be a lie for a move the model clamped; an outcome is
    // true or the announcement never happens.
    expect(reorderMessage('Reykjavik', 2, 7)).toBe('Reykjavik moved to position 3 of 7.');
  });

  it('is mounted empty rather than appearing with its first message', () => {
    // A live region inserted at the moment it gains text is frequently not
    // announced at all — assistive tech watches regions that already exist.
    const html = render({ scenes: deck('a', 'b') });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/role="status"[^>]*><\/p>|<p class="sc-live" role="status" aria-live="polite"><\/p>/);
  });
});

describe('reordering is reachable from the keyboard', () => {
  const html = render({ scenes: deck('First', 'Middle', 'Last') });

  it('offers real buttons, not a drag handle', () => {
    // The whole point: `dnd-kit` is not a dependency and a pointer-only
    // reorder would make the story's order unauthorable without a mouse.
    expect(html).toContain('aria-label="Move First later"');
    expect(html).toContain('aria-label="Move Last earlier"');
    expect(html).not.toContain('role="button"'); // native <button>, focusable by construction
  });

  it('disables the moves that would fall off either end', () => {
    // `moveScene` clamps rather than wraps, so these two are genuine no-ops and
    // an enabled control would look broken.
    expect(html).toMatch(/aria-label="Move First earlier"[^>]*disabled/);
    expect(html).toMatch(/aria-label="Move Last later"[^>]*disabled/);
    expect(html).not.toMatch(/aria-label="Move Middle earlier"[^>]*disabled/);
    expect(html).not.toMatch(/aria-label="Move Middle later"[^>]*disabled/);
  });

  it('makes rows draggable only when the app can accept a drop', () => {
    expect(render({ scenes: deck('a', 'b'), onMoveTo: noop })).toContain('draggable="true"');
    expect(render({ scenes: deck('a', 'b') })).not.toContain('draggable="true"');
  });
});

describe('the current scene', () => {
  it('is marked with aria-current, not with colour alone', () => {
    const html = render({ scenes: deck('First', 'Second'), selectedId: 's1' });
    expect(html).toMatch(/aria-current="true"[^>]*aria-label="Scene 2 of 2 · Second"/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });
});

describe('scenes that cannot be exported', () => {
  it('are flagged in the list, in words as well as in colour', () => {
    // Otherwise the first time the author hears about it is a failed save,
    // after the writing is done.
    const html = render({
      scenes: deck('Good', 'Broken'),
      problems: [{ sceneId: 's1', field: 'camera', message: 'no usable position' }],
    });
    expect(html).toContain('Cannot be saved until it is fixed');
    expect(html.match(/sc-flag/g)).toHaveLength(1);
  });
});

describe('the empty deck', () => {
  const html = render({ scenes: [] });

  it('teaches the gesture rather than sitting blank', () => {
    expect(html).toContain('No scenes yet');
    expect(html).toContain('scene from this view');
  });

  it('hides the capture route when the app cannot offer a pose', () => {
    // A dead capture button on the one screen that has to teach is worse than
    // one fewer route in.
    expect(html).not.toContain('Scene from this view');
    expect(render({ scenes: [], onCaptureScene: noop })).toContain('Scene from this view');
  });

  it('still offers a way to start', () => {
    expect(html).toContain('Blank scene');
  });
});

describe('the row summary', () => {
  it('says where the scene goes and whether it says anything', () => {
    const scenes: Scene[] = [
      { id: 'a', title: 'A', camera: { lon: -21.94, lat: 64.14 }, narrative: 'two words' },
      { id: 'b', title: 'B' },
    ];
    const html = render({ scenes });
    expect(html).toContain('64.14, -21.94 · 2 words');
    expect(html).toContain('No view · No text');
  });

  it('counts the legacy caption too, so an adopted scene does not read as empty', () => {
    const html = render({ scenes: [{ id: 'a', title: 'A', caption: 'one two three' } as Scene] });
    expect(html).toContain('3 words');
  });
});
