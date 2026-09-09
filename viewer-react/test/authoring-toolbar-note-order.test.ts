/**
 * The panel's half of two fixes:
 *
 *   - A note used to be a two-step process. The text field lived below "Click
 *     the globe to start", so a first-time user read the instruction, clicked,
 *     got refused ("A note needs some text."), and only THEN found the field
 *     they needed to have filled in first. The field now renders above that
 *     instruction, and the instruction itself says what to do next depending
 *     on whether text is already there.
 *   - "Click points" measuring needs a visible way to choose it before the
 *     first click, exactly like a marker's address box sits above its
 *     coordinates rather than below — a control discovered only after a click
 *     already went the wrong way is too late to help.
 *
 * Rendered with `react-dom/server`, same as `authoring-toolbar-measure-undo`:
 * no DOM in this workspace, and static markup answers every question here
 * (which control exists, in what order, and what it currently says).
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AuthoringToolbar,
  type AuthoringToolbarProps,
} from '../src/authoring/Toolbar.js';
import { createDraft, snapshot } from '../src/authoring/draft.js';
import { DEFAULT_STYLE } from '../src/authoring/style.js';

const noop = () => {};

const render = (props: Partial<AuthoringToolbarProps> = {}): string =>
  renderToStaticMarkup(
    createElement(AuthoringToolbar, {
      mode: 'idle',
      onMode: noop,
      draft: snapshot(createDraft('idle')),
      onFinish: noop,
      onCancel: noop,
      onUndoVertex: noop,
      style: DEFAULT_STYLE,
      onStyle: noop,
      noteText: '',
      onNoteText: noop,
      selection: null,
      onDelete: noop,
      onCaptureCamera: noop,
      ...props,
    }),
  );

describe('a note\'s text field is typed before the click that needs it, not after', () => {
  it('renders the note text field ahead of "Click the globe to start"', () => {
    const html = render({ mode: 'note' });
    const fieldIndex = html.indexOf('Note text');
    const instructionIndex = html.indexOf('the globe');
    expect(fieldIndex).toBeGreaterThan(-1);
    expect(instructionIndex).toBeGreaterThan(-1);
    expect(fieldIndex).toBeLessThan(instructionIndex);
  });

  it('tells the author to type first when the field is still empty', () => {
    const html = render({ mode: 'note', noteText: '' });
    expect(html).toContain('Type the note above, then click the globe to place it.');
    expect(html).not.toContain('Click the globe to place the note.');
  });

  it('says the click will now work, once there is text to place', () => {
    const html = render({ mode: 'note', noteText: 'Found the trailhead marker here.' });
    expect(html).toContain('Click the globe to place the note.');
    expect(html).not.toContain('Type the note above');
  });

  it('carries the typed text into the field\'s value, so it is not lost on re-render', () => {
    const html = render({ mode: 'note', noteText: 'Old bridge, now closed.' });
    expect(html).toContain('value="Old bridge, now closed."');
  });

  it('does not show the inline field for any other tool', () => {
    for (const mode of ['marker', 'line', 'polygon', 'idle'] as const) {
      const html = render({ mode });
      expect(html).not.toContain('Note text');
      expect(html).not.toContain('What happened here?');
    }
  });

  it('keeps the separate "editing a placed note" field working, gated on selection alone', () => {
    // That field is a different control from the inline one above — it edits
    // an already-committed note, reachable with no draw tool armed at all.
    const html = render({
      mode: 'idle',
      selection: {
        kind: 'item',
        id: 'n1',
        item: { id: 'n1', type: 'note', text: 'Existing note', position: { lon: 0, lat: 0 } } as never,
      },
      noteText: 'Existing note',
    });
    expect(html).toContain('Existing note');
  });
});

describe('"click points" measuring is chosen before the first click, not after', () => {
  it('offers a Free draw / Click points toggle while measuring', () => {
    const html = render({ mode: 'measure' });
    expect(html).toContain('Free draw');
    expect(html).toContain('Click points');
    expect(html).toContain('How to pick points');
  });

  it('marks whichever mode is active', () => {
    const free = render({ mode: 'measure', measureMode: 'free' });
    expect(free).toMatch(/draw-measure-mode-btn active"[^>]*aria-pressed="true"[^>]*>\s*Free draw/);

    const points = render({ mode: 'measure', measureMode: 'points' });
    expect(points).toMatch(/draw-measure-mode-btn active"[^>]*aria-pressed="true"[^>]*>\s*Click points/);
  });

  it('describes what a click does, specific to the active mode', () => {
    const draft = { ...snapshot(createDraft('measure')), vertexCount: 0 };
    expect(render({ mode: 'measure', draft, measureMode: 'free' }))
      .toContain('Click two or more points to measure.');
    expect(render({ mode: 'measure', draft, measureMode: 'points' }))
      .toContain('Click two or more pins to measure between them.');
  });

  it('does not offer the toggle for any tool other than measure', () => {
    expect(render({ mode: 'line' })).not.toContain('How to pick points');
    expect(render({ mode: 'idle' })).not.toContain('How to pick points');
  });
});
