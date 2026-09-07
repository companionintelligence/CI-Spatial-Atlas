/**
 * The editor for one scene: its title, its Markdown body, its layout, its
 * moment and its camera pose.
 *
 * ## What is typed is what gets rendered
 *
 * The body is a plain `<textarea>` and not a rich-text surface, on purpose. The
 * presenter renders `scene.narrative` through `ui/markdown.ts` → `Markdown.tsx`,
 * which is a deliberately small subset (headings, emphasis, code, links,
 * images, lists) parsed to React elements with no `dangerouslySetInnerHTML`
 * anywhere. A WYSIWYG surface over that would have to emit exactly that subset
 * or start lying about what the slide will look like, and the moment it needs a
 * round-trip through HTML the injection safety of the whole narrative pipeline
 * is in play. A textarea has neither problem: the characters stored are the
 * characters typed, and the slide is the one true preview.
 *
 * ## Why the text fields keep a local draft
 *
 * `patchScene` trims and drops empty values — it has to, because a scene
 * exported with `title: ''` claims a title and renders nothing. A fully
 * controlled input bound straight to `scene.title` would therefore erase a
 * space the instant it was typed, so "Cape Town" could never be reached past
 * "Cape". The draft below holds what the user is typing; the patch holds what
 * will be saved. Same shape of problem, and the same answer, as the custom-icon
 * field in `authoring/Toolbar.tsx`.
 *
 * ## Why capture is refused rather than stored
 *
 * `captureCamera()` reports a NaN pose during the first frame and mid-flight,
 * and `lat: 500` is a perfectly good number that puts the camera somewhere that
 * does not exist. Either one presents as a black slide with nothing logged, and
 * would not be caught until `Story.parse` at save time — long after the author
 * wrote a scene around it. So the pose is checked with `hasUsableLocation`
 * before it is stored, and the refusal names the remedy.
 *
 * Presentational and fully controlled otherwise, like `authoring/Toolbar.tsx`.
 */
import { useId, useState, type SVGProps } from 'react';
import type { Camera, Scene } from '@companion-atlas/story';
import { SCENE_LAYOUTS, sceneLayout, type SceneLayout } from '../ui/sceneDeck.js';
import { hasUsableLocation, type SceneProblem, type ScenePatch } from './index.js';
import './scenes.css';

export interface SceneEditorProps {
  /** The scene being edited, or `null` when nothing is selected. */
  scene: Scene | null;
  /** Its position in the deck, and the deck's size — for the panel's heading,
   *  which is the only place the author sees where they are. */
  index: number;
  count: number;
  onPatch: (patch: ScenePatch) => void;
  onRemove: () => void;
  /**
   * Read the live globe camera. Returns `null` when there is no viewer.
   *
   * Taken as a callback rather than reached for through the authoring
   * controller, because this panel must stay mountable — and testable — with
   * no Cesium anywhere near it.
   */
  onCaptureCamera: () => Camera | null;
  /** From `SceneControl.problems`; only this scene's are shown, beside the
   *  field that caused each one. */
  problems?: readonly SceneProblem[];
}

/** What the app says when the globe cannot give a pose worth storing. */
export const CAPTURE_UNSETTLED =
  'That view has no usable position yet — let the globe settle, then capture it again.';

/**
 * Decide what a capture attempt should do.
 *
 * Split out from the click handler because it is the rule, not the plumbing:
 * refusing a NaN or out-of-range pose is the difference between an author
 * being told to try again and an author discovering at save time that the
 * scene they wrote cannot be written.
 */
export function captureOutcome(camera: Camera | null | undefined):
  | { ok: true; camera: Camera }
  | { ok: false; message: string } {
  if (!hasUsableLocation(camera)) return { ok: false, message: CAPTURE_UNSETTLED };
  return { ok: true, camera: camera as Camera };
}

/**
 * The body text to show for a scene.
 *
 * Reads the legacy `caption` too, exactly as `sceneNarrative` does. A scene
 * adopted from an Earth-2 document carries its prose there, and an editor that
 * only looked at `narrative` would show an empty box beside a slide full of
 * text — which reads as the app having lost the writing. `patchScene` deletes
 * `caption` on the first edit, so this only matters until the author types.
 */
export function narrativeText(scene: Pick<Scene, 'narrative' | 'caption'> | null | undefined): string {
  return scene?.narrative ?? scene?.caption ?? '';
}

/**
 * A scene's instant as a `<input type="datetime-local">` value, or `''`.
 *
 * `Scene.time` is a `TimeSpec`: either an ISO instant or a span. A span is read
 * at its `at`/`start`, the same field `sceneTimeMs` steps the clock from, so
 * the control shows the moment the presenter will actually fly to.
 *
 * Formatted from the local-time getters rather than by slicing `toISOString()`,
 * because that string is UTC — slicing it shows a Sydney author a time eleven
 * hours off and, worse, saves that shifted value back on the next edit.
 */
export function toDateTimeLocal(time: Scene['time'] | undefined): string {
  const iso = typeof time === 'string' ? time : (time?.at ?? time?.start);
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * A `datetime-local` value back to the ISO instant `ScenePatch.time` wants.
 *
 * `''` — which is also what the control reports for a half-typed or invalid
 * date — becomes `null`, i.e. *clear the field*. That is the honest reading:
 * an untimed scene is legitimate (`buildDeck` renders it with no eyebrow),
 * whereas storing a garbage string would fail `Iso8601` at export.
 */
export function fromDateTimeLocal(value: string): string | null {
  const ms = Date.parse(value);
  if (!value.trim() || Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** True when the scene's time is a span rather than an instant — which this
 *  editor can only replace, not preserve. */
export function isTimeSpan(time: Scene['time'] | undefined): boolean {
  return !!time && typeof time !== 'string' && (time.start != null || time.stop != null || time.end != null);
}

/**
 * A stored camera pose in one readable line, or `null` when there is none.
 *
 * Not `authoring/camera.ts`'s `describeCamera`: that one reports `height` and
 * an Atlas orbit camera has `range` instead, so a scene created from a memory
 * — `{ lon, lat, range: 90 000, pitch: -40 }` — would be described as "0 m",
 * which reads as a broken capture. The distance here says which of the two it
 * is, because they frame the globe differently and the author can see that.
 */
export function describeScenePose(camera: Camera | null | undefined): string | null {
  if (!hasUsableLocation(camera)) return null;
  const c = camera as Camera;
  const lat = (c.location?.lat ?? c.lat) as number;
  const lon = (c.location?.lon ?? c.lon) as number;
  const parts = [
    `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`,
  ];
  const height = c.location?.height ?? c.height;
  if (typeof c.range === 'number' && Number.isFinite(c.range)) parts.push(`${distance(c.range)} out`);
  else if (typeof height === 'number' && Number.isFinite(height)) parts.push(`${distance(height)} up`);
  if (typeof c.heading === 'number' && Number.isFinite(c.heading)) parts.push(`facing ${compassPoint(c.heading)}`);
  return parts.join(' · ');
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Degrees → a 16-point compass label, for any real number of turns. */
export function compassPoint(headingDeg: number): string {
  const d = ((headingDeg % 360) + 360) % 360;
  return POINTS[Math.round(d / 22.5) % 16]!;
}

function distance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/**
 * The five layouts, named for an author rather than for the schema.
 *
 * Keyed off `SCENE_LAYOUTS` — the same list `sceneLayout()` falls back through
 * — so the picker and the renderer can never disagree about what exists. A
 * sixth layout added to the schema shows up here as a type error rather than as
 * a silently unreachable option.
 */
export const LAYOUT_LABEL: Record<SceneLayout, { label: string; hint: string }> = {
  'card-left': { label: 'Card left', hint: 'Text on the left, globe visible beside it.' },
  'card-right': { label: 'Card right', hint: 'Text on the right, globe visible beside it.' },
  'card-bottom': { label: 'Card below', hint: 'Text along the bottom, widest view of the globe.' },
  fullscreen: { label: 'Full screen', hint: 'Text over the whole slide; the globe is hidden.' },
  split: { label: 'Split', hint: 'Half text, half image or globe.' },
};

export function SceneEditor({
  scene, index, count, onPatch, onRemove, onCaptureCamera, problems = [],
}: SceneEditorProps) {
  const ids = useId();
  // Local draft for the two free-text fields — see the header. Reset by
  // comparing the id during render rather than in an effect, so switching
  // scenes never paints one frame of the previous scene's text into the new
  // scene's boxes (which, with a keystroke landing in between, would write it).
  const [draft, setDraft] = useState({ id: '', title: '', narrative: '' });
  const [captureError, setCaptureError] = useState<string | null>(null);

  if (scene && draft.id !== scene.id) {
    setDraft({ id: scene.id, title: scene.title ?? '', narrative: narrativeText(scene) });
    if (captureError) setCaptureError(null);
  }

  if (!scene) {
    return (
      <section className="sc-editor sc-blank" aria-label="Scene">
        <p className="sc-empty">Pick a scene from the deck to write it, or add one above.</p>
      </section>
    );
  }

  const mine = problems.filter((p) => p.sceneId === scene.id);
  const problemFor = (field: string) => mine.find((p) => p.field === field || p.field?.startsWith(`${field}.`));
  const cameraProblem = problemFor('camera');
  const timeProblem = problemFor('time');
  const layout = sceneLayout(scene);
  const pose = describeScenePose(scene.camera);
  const title = draft.id === scene.id ? draft.title : (scene.title ?? '');
  const narrative = draft.id === scene.id ? draft.narrative : narrativeText(scene);

  const capture = () => {
    const outcome = captureOutcome(onCaptureCamera());
    if (!outcome.ok) { setCaptureError(outcome.message); return; }
    setCaptureError(null);
    onPatch({ camera: outcome.camera });
  };

  return (
    <section className="sc-editor" aria-label={`Scene ${index + 1} of ${count}`}>
      <header className="sc-head">
        <b>Scene {index + 1}<span className="sc-of"> of {count}</span></b>
        <button type="button" className="sc-action danger sc-head-action" onClick={onRemove}>
          <TrashIcon aria-hidden="true" />
          <span>Delete</span>
        </button>
      </header>

      <div className="sc-field">
        <label htmlFor={`${ids}-title`}>Title</label>
        <input
          id={`${ids}-title`}
          className="sc-input"
          type="text"
          value={title}
          placeholder={`Scene ${index + 1}`}
          onChange={(e) => {
            setDraft({ id: scene.id, title: e.target.value, narrative });
            onPatch({ title: e.target.value });
          }}
        />
        <p className="sc-note">Left blank, the slide is titled “Scene {index + 1}”.</p>
      </div>

      <div className="sc-field">
        <label htmlFor={`${ids}-body`}>Narrative</label>
        <textarea
          id={`${ids}-body`}
          className="sc-input sc-body"
          rows={7}
          value={narrative}
          placeholder={'What happened here?\n\nMarkdown: **bold**, *italic*, [links](https://…), - lists, # headings.'}
          aria-describedby={`${ids}-body-help`}
          onChange={(e) => {
            setDraft({ id: scene.id, title, narrative: e.target.value });
            onPatch({ narrative: e.target.value });
          }}
        />
        <p className="sc-note" id={`${ids}-body-help`}>
          Markdown. Headings, <b>**bold**</b>, <i>*italic*</i>, links, images and lists render on the slide; anything
          else shows as the characters you typed.
        </p>
      </div>

      <div className="sc-field">
        <span className="sc-label" id={`${ids}-layout`}>Layout</span>
        <div className="sc-layouts" role="group" aria-labelledby={`${ids}-layout`}>
          {SCENE_LAYOUTS.map((l) => (
            <button
              key={l}
              type="button"
              className={`sc-layout${layout === l ? ' active' : ''}`}
              aria-pressed={layout === l}
              title={LAYOUT_LABEL[l].hint}
              onClick={() => onPatch({ layout: l })}
            >
              <LayoutGlyph layout={l} aria-hidden="true" />
              <span>{LAYOUT_LABEL[l].label}</span>
            </button>
          ))}
        </div>
        <p className="sc-note">{LAYOUT_LABEL[layout].hint}</p>
      </div>

      <div className="sc-field">
        <span className="sc-label" id={`${ids}-view`}>View</span>
        <div className="sc-pose" role="group" aria-labelledby={`${ids}-view`}>
          <p className={`sc-posetext${pose ? '' : ' none'}`}>
            {pose ?? 'No view stored — this scene will not move the globe.'}
          </p>
          <div className="sc-row-actions">
            <button type="button" className="sc-action" onClick={capture}>
              <CameraViewIcon aria-hidden="true" />
              <span>{pose ? 'Recapture from this view' : 'Capture this view'}</span>
            </button>
            {pose ? (
              <button
                type="button"
                className="sc-action ghost"
                onClick={() => { setCaptureError(null); onPatch({ camera: null }); }}
              >
                Clear view
              </button>
            ) : null}
          </div>
        </div>
        {captureError ? (
          <p className="sc-warning" role="alert"><WarnIcon aria-hidden="true" /><span>{captureError}</span></p>
        ) : null}
        {cameraProblem ? (
          <p className="sc-warning" role="alert"><WarnIcon aria-hidden="true" /><span>{cameraProblem.message}</span></p>
        ) : null}
      </div>

      <div className="sc-field">
        <label htmlFor={`${ids}-time`}>Moment</label>
        <input
          id={`${ids}-time`}
          className="sc-input"
          type="datetime-local"
          value={toDateTimeLocal(scene.time)}
          onChange={(e) => onPatch({ time: fromDateTimeLocal(e.target.value) })}
        />
        {isTimeSpan(scene.time) ? (
          <p className="sc-note">This scene covers a span. Setting a moment here replaces it with that instant.</p>
        ) : (
          <p className="sc-note">Optional. A scene with a moment carries the time machine with it.</p>
        )}
        {timeProblem ? (
          <p className="sc-warning" role="alert"><WarnIcon aria-hidden="true" /><span>{timeProblem.message}</span></p>
        ) : null}
      </div>

      {/* Anything the field-level slots above did not claim still has to be
          visible: a problem nobody is shown is a save that fails later. */}
      {mine.filter((p) => p !== cameraProblem && p !== timeProblem).map((p, i) => (
        <p className="sc-warning" role="alert" key={`${p.field ?? ''}-${i}`}>
          <WarnIcon aria-hidden="true" /><span>{p.message}</span>
        </p>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Icons — local to the scene panel, matching `authoring/Toolbar.tsx`'s choice
// and its 24×24 stroked grid.
// ---------------------------------------------------------------------------

type P = SVGProps<SVGSVGElement>;
const S = (props: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

const CameraViewIcon = (p: P) => (
  <svg {...S(p)}><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 7l1.5-2.5h5L16 7" /><circle cx="12" cy="13.5" r="3.4" /></svg>
);
const TrashIcon = (p: P) => (
  <svg {...S(p)}><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10.5 11v5M13.5 11v5" /></svg>
);
const WarnIcon = (p: P) => (
  <svg {...S(p)}><path d="M12 4 2.6 20h18.8z" /><path d="M12 10v4M12 17v.01" /></svg>
);

/** A miniature of the slide: the frame is the screen, the filled block is the
 *  card. Cheaper to read than the layout's name, which is why both are shown. */
function LayoutGlyph({ layout, ...rest }: { layout: SceneLayout } & P) {
  const card: Record<SceneLayout, { x: number; y: number; w: number; h: number }> = {
    'card-left': { x: 3.5, y: 5.5, w: 7, h: 13 },
    'card-right': { x: 13.5, y: 5.5, w: 7, h: 13 },
    'card-bottom': { x: 3.5, y: 13.5, w: 17, h: 5 },
    fullscreen: { x: 3.5, y: 5.5, w: 17, h: 13 },
    split: { x: 3.5, y: 5.5, w: 8.25, h: 13 },
  };
  const c = card[layout];
  return (
    <svg {...S(rest)}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="1.2" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  );
}
