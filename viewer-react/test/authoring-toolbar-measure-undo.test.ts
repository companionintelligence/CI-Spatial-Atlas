/**
 * The panel's half of measure and undo/redo.
 *
 * Rendered with `react-dom/server` for the same reason as `scene-ui-editor`:
 * this workspace runs in node with no DOM, and static markup answers everything
 * that matters about which control is showing, how it is labelled, and whether
 * it is disabled.
 *
 * What is under test is the discipline this codebase has paid for twice: a
 * control that is **present and does nothing** is worse than an absent one. So
 * every assertion here is either "this control exists AND is enabled only when
 * it would do something" or "this control says what will actually happen".
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AuthoringToolbar,
  type AuthoringToolbarProps,
} from '../src/authoring/Toolbar.js';
import { createDraft, snapshot, TOOL_MODES } from '../src/authoring/draft.js';
import { DEFAULT_STYLE } from '../src/authoring/style.js';
import { measurementOf } from '../src/authoring/measure.js';

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

/** Isolate one `<button>` by a string it contains, so an assertion about
 *  `disabled` cannot accidentally read a different button's attribute. */
function buttonContaining(html: string, needle: string): string | null {
  for (const match of html.matchAll(/<button\b[\s\S]*?<\/button>/g)) {
    if (match[0].includes(needle)) return match[0];
  }
  return null;
}

const p = (lon: number, lat: number) => ({ lon, lat });

describe('the measure tool is reachable', () => {
  it('is offered in the tool row, beside the shape tools', () => {
    const html = render();
    expect(html).toContain('Measure');
    // Every tool the state machine knows is rendered — a mode with no button is
    // a mode that cannot be armed.
    for (const m of TOOL_MODES) expect(html).toContain(`draw-mode ${m}`);
  });

  it('says out loud that a measurement is not saved', () => {
    const html = render({ mode: 'measure' });
    // The single most likely misunderstanding, and the one that costs the most:
    // a story that silently lacks something the author believed was in it.
    expect(html).toMatch(/not saved with the story/i);
  });

  it('offers "Take reading" rather than "Finish", and only once two points are down', () => {
    const one = render({ mode: 'measure', draft: { ...snapshot(createDraft('measure')), vertexCount: 1 } });
    expect(buttonContaining(one, 'Take reading')).toContain('disabled');

    const two = render({ mode: 'measure', draft: { ...snapshot(createDraft('measure')), vertexCount: 2 } });
    expect(buttonContaining(two, 'Take reading')).not.toContain('disabled');
  });

  it('shows the reading, and a way to clear it, once one has been taken', () => {
    const measurement = measurementOf([p(0, 0), p(0, 1)]);
    const html = render({ mode: 'idle', measurement });
    expect(html).toContain('111.2 km');
    expect(html).toContain('Clear measurement');
  });

  it('keeps the reading visible after the tool is put away', () => {
    // Measuring a setback and then drawing the shape that respects it is the
    // whole use: a reading that vanished when another tool was armed would have
    // to be re-taken every time.
    const measurement = measurementOf([p(0, 0), p(0, 1)]);
    expect(render({ mode: 'polygon', measurement })).toContain('111.2 km');
  });

  it('shows nothing measurement-shaped when there is neither a tool nor a reading', () => {
    const html = render({ mode: 'idle', measurement: null });
    expect(html).not.toContain('Clear measurement');
    // No numbers on screen, so no units control — it would govern nothing.
    expect(html).not.toContain('draw-units');
  });

  it('keeps the units control reachable wherever a number is printed', () => {
    // A user who switched to feet while measuring, cleared the reading and
    // armed the area tool would otherwise be reading feet with no control
    // anywhere to switch back.
    expect(render({ mode: 'polygon', units: 'imperial' })).toContain('draw-units');
    expect(render({ mode: 'measure' })).toContain('draw-units');
    expect(render({ mode: 'idle', measurement: measurementOf([p(0, 0), p(0, 1)]) })).toContain('draw-units');
  });

  it('drives both readouts from one units setting', () => {
    const measurement = measurementOf([p(0, 0), p(0, 1)]);
    const metric = render({ mode: 'measure', measurement, units: 'metric' });
    expect(metric).toContain('111.2 km');
    expect(buttonContaining(metric, 'm / km')).toContain('aria-pressed="true"');

    const imperial = render({ mode: 'measure', measurement, units: 'imperial' });
    expect(imperial).toContain('69.1 mi');
    expect(imperial).not.toContain('111.2 km');
    expect(buttonContaining(imperial, 'ft / mi')).toContain('aria-pressed="true"');
  });

  it('reports the running distance while measuring, in the chosen units', () => {
    const draft = { ...snapshot(createDraft('measure')), vertexCount: 2, lengthMeters: 111_195 };
    expect(render({ mode: 'measure', draft })).toContain('111.2 km');
    expect(render({ mode: 'measure', draft, units: 'imperial' })).toContain('69.1 mi');
  });
});

describe('undo and redo are always present, and honest about being empty', () => {
  it('renders both buttons even with nothing to undo', () => {
    // Hidden-until-available reads as "this app has no undo" and cannot be
    // found by muscle memory.
    const html = render();
    expect(buttonContaining(html, '>Undo<')).not.toBeNull();
    expect(buttonContaining(html, '>Redo<')).not.toBeNull();
  });

  it('disables each until it would actually do something', () => {
    const empty = render();
    expect(buttonContaining(empty, '>Undo<')).toContain('disabled');
    expect(buttonContaining(empty, '>Redo<')).toContain('disabled');
    expect(buttonContaining(empty, '>Undo<')).toContain('Nothing to undo');

    const live = render({ canUndo: true, canRedo: true, undoLabel: 'delete area', redoLabel: 'add line' });
    expect(buttonContaining(live, '>Undo<')).not.toContain('disabled');
    expect(buttonContaining(live, '>Redo<')).not.toContain('disabled');
  });

  it('names the action a press would reverse, for the tooltip and the screen reader', () => {
    const html = render({ canUndo: true, undoLabel: 'delete area' });
    const undo = buttonContaining(html, '>Undo<')!;
    expect(undo).toContain('title="Undo delete area"');
    expect(undo).toContain('aria-label="Undo delete area"');
  });

  it('advertises its keyboard shortcut where a screen reader can find it', () => {
    const html = render({ canUndo: true });
    expect(buttonContaining(html, '>Undo<')).toContain('aria-keyshortcuts="Control+Z Meta+Z"');
    expect(buttonContaining(html, '>Redo<')).toContain('aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"');
  });

  it('keeps "Undo point" as a separate control from "Undo"', () => {
    // Two different gestures at two different altitudes: one takes back the
    // last vertex of the shape in progress, the other reaches into finished
    // work. Collapsing them would make Backspace-while-drawing occasionally
    // resurrect a deleted shape.
    const html = render({ mode: 'line', draft: { ...snapshot(createDraft('line')), vertexCount: 2 } });
    expect(buttonContaining(html, 'Undo point')).not.toBeNull();
    expect(buttonContaining(html, '>Undo<')).not.toBeNull();
  });
});

describe('the panel stays operable by keyboard and by label', () => {
  it('groups and labels the new controls the way the existing ones are', () => {
    const html = render({ mode: 'measure', measurement: measurementOf([p(0, 0), p(0, 1)]) });
    expect(html).toContain('aria-label="Undo and redo"');
    expect(html).toContain('Units');
    // Every button in the units group carries an accessible name; the visible
    // text is "m / km", which a screen reader would read as letters.
    expect(html).toContain('aria-label="Metric"');
    expect(html).toContain('aria-label="Imperial"');
  });

  it('renders nothing at all when closed', () => {
    expect(render({ open: false, measurement: measurementOf([p(0, 0), p(0, 1)]), canUndo: true })).toBe('');
  });
});
