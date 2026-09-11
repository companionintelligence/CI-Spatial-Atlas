/**
 * The scene editor.
 *
 * The rules under test are the ones that are silently wrong rather than
 * visibly wrong: a pose summary that reports "0 m" for a perfectly good orbit
 * camera, a datetime control that shifts an author's time by their UTC offset
 * every time they touch it, a body field that shows nothing for a scene whose
 * prose is under the legacy `caption`, and a capture that stores a NaN pose
 * which does not fail until `Story.parse` at save time. Every one of those
 * looks fine in a screenshot.
 *
 * Rendered with `react-dom/server` for the same reason as `scene-ui-list`:
 * this workspace's suites run in node with no DOM, and static markup answers
 * everything that matters about labelling and about which control is showing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Camera, Scene } from '@companion-atlas/story';
import {
  CAPTURE_UNSETTLED,
  LAYOUT_LABEL,
  SceneEditor,
  captureOutcome,
  compassPoint,
  describeScenePose,
  fromDateTimeLocal,
  isTimeSpan,
  narrativeText,
  toDateTimeLocal,
  type SceneEditorProps,
} from '../src/scenes/SceneEditor.js';
import { MEMORY_SCENE_PITCH_DEG, MEMORY_SCENE_RANGE_M, sceneFromMemory } from '../src/scenes/model.js';
import { SCENE_LAYOUTS, sceneLayout } from '../src/ui/sceneDeck.js';

const noop = () => {};

const render = (props: Partial<SceneEditorProps> & { scene: Scene | null }): string =>
  renderToStaticMarkup(
    createElement(SceneEditor, {
      index: 0,
      count: 1,
      onPatch: noop,
      onRemove: noop,
      onCaptureCamera: () => null,
      ...props,
    }),
  );

describe('the camera summary', () => {
  it('reports an orbit camera by its range, not as "0 m" up', () => {
    // `describeCamera` in `authoring/camera.ts` reads `height`, and a scene
    // built from a memory has `range` and no height at all — so reusing it
    // would describe a correct 90 km framing as a camera on the ground, which
    // reads as a broken capture.
    const scene = sceneFromMemory({ id: 'm', title: 'Reykjavik', lat: 64.1466, lon: -21.9426 });
    expect(scene.camera?.range).toBe(MEMORY_SCENE_RANGE_M);
    expect(scene.camera?.pitch).toBe(MEMORY_SCENE_PITCH_DEG);
    const text = describeScenePose(scene.camera)!;
    expect(text).toContain('90 km out');
    expect(text).not.toContain('0 m');
  });

  it('reports a free camera by its height, and puts the hemisphere in words', () => {
    expect(describeScenePose({ lon: -21.9426, lat: 64.1466, height: 800, heading: 95 }))
      .toBe('64.1466° N, 21.9426° W · 800 m up · facing E');
    expect(describeScenePose({ location: { lat: -33.87, lon: 151.21, height: 24_000 }, heading: 200 }))
      .toBe('33.8700° S, 151.2100° E · 24 km up · facing SSW');
  });

  it('is null for a pose that cannot be flown to, so the panel says so in prose', () => {
    // Same gate as `hasUsableLocation`: a NaN pose and `lat: 500` both present
    // as a black screen, and neither is something to print as a coordinate.
    expect(describeScenePose(null)).toBeNull();
    expect(describeScenePose(undefined)).toBeNull();
    expect(describeScenePose({ lon: Number.NaN, lat: 64 } as Camera)).toBeNull();
    expect(describeScenePose({ lon: 0, lat: 500 })).toBeNull();
  });

  it('names every compass point, wrapping past a full turn', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(360)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
    expect(compassPoint(719)).toBe('N');
    expect(new Set(Array.from({ length: 360 }, (_, d) => compassPoint(d))).size).toBe(16);
  });
});

describe('capturing a view', () => {
  it('refuses a pose the globe has not settled into, and names the remedy', () => {
    // Storing it would not fail until `Story.parse` at save time — long after
    // the author wrote a scene around it.
    expect(captureOutcome(null)).toEqual({ ok: false, message: CAPTURE_UNSETTLED });
    expect(captureOutcome({ lon: 0, lat: Number.NaN } as Camera).ok).toBe(false);
    expect(captureOutcome({ lon: 400, lat: 0 } as Camera).ok).toBe(false);
    expect(CAPTURE_UNSETTLED).toContain('settle');
  });

  it('accepts a usable pose unchanged', () => {
    const camera: Camera = { lon: 12, lat: 45, height: 900 };
    expect(captureOutcome(camera)).toEqual({ ok: true, camera });
  });
});

describe('the moment field', () => {
  // Fixed to a non-UTC zone: formatting by slicing `toISOString()` passes in
  // UTC and shifts every author elsewhere by their offset — on read *and* on
  // the write back, so the time drifts a little further with every edit.
  beforeEach(() => { process.env.TZ = 'Australia/Sydney'; });
  afterEach(() => { delete process.env.TZ; });

  it('shows an instant in the author\'s own local time', () => {
    const local = toDateTimeLocal('2024-05-01T00:30:00Z');
    expect(local).toBe('2024-05-01T10:30'); // AEST, UTC+10
    expect(local).not.toContain('Z');
  });

  it('round-trips without drifting', () => {
    const iso = '2024-05-01T00:30:00.000Z';
    expect(fromDateTimeLocal(toDateTimeLocal(iso))).toBe(iso);
  });

  it('reads a span at the moment the clock will actually fly to', () => {
    expect(toDateTimeLocal({ start: '2024-05-01T00:30:00Z', stop: '2024-05-02T00:00:00Z' })).toBe('2024-05-01T10:30');
    expect(toDateTimeLocal({ at: '2024-05-01T00:30:00Z' })).toBe('2024-05-01T10:30');
  });

  it('treats an emptied or half-typed value as "clear it"', () => {
    // `ScenePatch` reads null as *remove the field*, which is the honest
    // outcome: an untimed scene is legitimate, a garbage string is not — it
    // fails `Iso8601` at export.
    expect(fromDateTimeLocal('')).toBeNull();
    expect(fromDateTimeLocal('   ')).toBeNull();
    expect(fromDateTimeLocal('2024-13-45T99:99')).toBeNull();
    expect(toDateTimeLocal(undefined)).toBe('');
    expect(toDateTimeLocal('not a date')).toBe('');
  });

  it('warns before collapsing a span into an instant', () => {
    expect(isTimeSpan({ start: '2024-05-01T00:00:00Z', stop: '2024-05-02T00:00:00Z' })).toBe(true);
    expect(isTimeSpan({ at: '2024-05-01T00:00:00Z' })).toBe(false);
    expect(isTimeSpan('2024-05-01T00:00:00Z')).toBe(false);
    expect(isTimeSpan(undefined)).toBe(false);
    const html = render({ scene: { id: 'a', time: { start: '2024-05-01T00:00:00Z', end: '2024-05-02T00:00:00Z' } } });
    expect(html).toContain('replaces it with that instant');
  });
});

describe('the body field', () => {
  it('shows the legacy caption, so an adopted scene does not look emptied', () => {
    // `sceneNarrative` reads `narrative ?? caption`. An editor that only read
    // `narrative` would show an empty box beside a slide full of text.
    expect(narrativeText({ caption: 'from Earth-2' })).toBe('from Earth-2');
    expect(narrativeText({ narrative: 'the real one', caption: 'stale' })).toBe('the real one');
    expect(narrativeText(null)).toBe('');
    expect(render({ scene: { id: 'a', caption: 'from Earth-2' } })).toContain('from Earth-2');
  });

  it('is a plain textarea whose characters are what the slide renders', () => {
    // No rich-text surface: `MarkdownRenderer.tsx` renders a small subset with no
    // `dangerouslySetInnerHTML` anywhere, and a WYSIWYG layer would either
    // have to emit exactly that subset or start lying about the slide.
    const html = render({ scene: { id: 'a', narrative: '# Heading\n\n- one\n- two' } });
    expect(html).toContain('<textarea');
    expect(html).toContain('# Heading');
    expect(html).toContain('Markdown');
  });
});

describe('the layout picker', () => {
  it('offers every layout the renderer knows, and no others', () => {
    // Keyed off `SCENE_LAYOUTS`, so a sixth layout added to the schema cannot
    // become an option the author can never reach.
    expect(Object.keys(LAYOUT_LABEL).sort()).toEqual([...SCENE_LAYOUTS].sort());
    const html = render({ scene: { id: 'a' } });
    for (const l of SCENE_LAYOUTS) expect(html).toContain(LAYOUT_LABEL[l].label);
    expect(html.match(/aria-pressed=/g)).toHaveLength(SCENE_LAYOUTS.length);
  });

  it('marks the layout the presenter will actually use, including the fallback', () => {
    // A scene with no `layout` presents as `card-left`; showing nothing selected
    // would tell the author they had not chosen when in fact they had.
    expect(sceneLayout({ id: 'a' } as Scene)).toBe('card-left');
    const blank = render({ scene: { id: 'a' } });
    expect(blank).toMatch(/aria-pressed="true"[^>]*>.*?Card left/s);
    const split = render({ scene: { id: 'a', layout: 'split' } });
    expect(split).toMatch(/aria-pressed="true"[^>]*>.*?Split/s);
    expect(split.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('unrecognised values fall back rather than showing nothing chosen', () => {
    const html = render({ scene: { id: 'a', layout: 'card-middle' } as unknown as Scene });
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Card left/s);
  });
});

describe('the panel as a whole', () => {
  it('labels every control it renders', () => {
    // The standard the rest of the shell already meets.
    const html = render({ scene: { id: 'a' }, index: 2, count: 5 });
    for (const label of ['Title', 'Narrative', 'Layout', 'View', 'Moment']) expect(html).toContain(`>${label}<`);
    // Each of the two text controls is tied to its <label> by id.
    const ids = [...html.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
  });

  it('says where in the deck the author is', () => {
    expect(render({ scene: { id: 'a' }, index: 2, count: 5 })).toContain('aria-label="Scene 3 of 5"');
  });

  it('offers to capture rather than recapture when there is no pose yet', () => {
    expect(render({ scene: { id: 'a' } })).toContain('Capture this view');
    expect(render({ scene: { id: 'a' } })).toContain('No view stored');
    const posed = render({ scene: { id: 'a', camera: { lon: 12, lat: 45, height: 900 } } });
    expect(posed).toContain('Recapture from this view');
    expect(posed).toContain('Clear view');
  });

  it('puts an export problem beside the field that caused it', () => {
    const html = render({
      scene: { id: 'a', camera: { lon: 12, lat: 45 } },
      problems: [
        { sceneId: 'a', field: 'camera', message: 'the camera is wrong' },
        { sceneId: 'other', field: 'camera', message: 'not this scene' },
      ],
    });
    expect(html).toContain('the camera is wrong');
    expect(html).not.toContain('not this scene');
  });

  it('still shows a problem no field claims', () => {
    // A problem nobody is shown is a save that fails later.
    const html = render({ scene: { id: 'a' }, problems: [{ sceneId: 'a', message: 'something odd' }] });
    expect(html).toContain('something odd');
    expect(html).toContain('role="alert"');
  });

  it('invites a selection rather than rendering an empty form', () => {
    const html = render({ scene: null });
    expect(html).toContain('Pick a scene');
    expect(html).not.toContain('<textarea');
  });
});

describe('capture wiring', () => {
  it('asks the app for the pose rather than reaching for the globe', () => {
    // The callback exists so this panel stays mountable — and testable — with
    // no Cesium anywhere near it. If it were ever called during render, this
    // would catch that too.
    const onCaptureCamera = vi.fn(() => null);
    render({ scene: { id: 'a' }, onCaptureCamera });
    expect(onCaptureCamera).not.toHaveBeenCalled();
  });
});
