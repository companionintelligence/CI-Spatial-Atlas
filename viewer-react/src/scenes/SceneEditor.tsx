/**
 * The editor for one scene: its title, its Markdown body, its layout, its
 * background media, its narration, its moment and its camera pose.
 *
 * ## Why the background is a wall of thumbnails
 *
 * `Scene.itemIds` is a list of ids into the story's own entities, and an id
 * that names nothing resolvable produces no background and no complaint — so
 * the two obvious controls are both traps. A free-text id field is a box in
 * which almost everything typed does nothing. A list of ids is a list of
 * `mem-4f2a…` strings, and "attach the harbour photo" is not a decision anyone
 * makes from those. So the picker is built from `sceneMediaPool`, which offers
 * only what `sceneBackground` will actually resolve, and shows each one as the
 * picture it is. Multi-select, because `itemIds` is a list and
 * `sceneHighlightIds` reads all of it; the tile the presenter is actually
 * painting says so in words.
 *
 * ## Why narration is validated as it is typed
 *
 * `buildDeck` stores `safeMediaUrl(scene.audioUrl)`, which is `null` for
 * anything that is not http(s) — the `ci-memory://` address a real archive is
 * full of, most obviously. Accepting one here would produce a scene that claims
 * to be narrated and plays silence, with nothing said anywhere. `checkAudioUrl`
 * runs the presenter's own sanitiser on each keystroke and the field refuses to
 * store what the presentation would drop.
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
import { useId, useMemo, useState, type SVGProps } from 'react';
import type { Camera, Scene, Story } from '@companion-atlas/story';
import { SCENE_LAYOUTS, sceneLayout, type SceneLayout } from '../ui/sceneDeck.js';
import { hasUsableLocation, type SceneProblem, type ScenePatch } from './index.js';
import { MediaUploadSection } from '../interop/MediaUploadSection.js';
import type { ImportedFile } from '../interop/importFile.js';
import type { AtlasApiConfig } from '../upload/index.js';
import {
  SCENE_MEDIA_KIND_LABEL,
  backgroundCandidate,
  checkAudioUrl,
  AUDIO_URL_TIDIED,
  playableAudioUrl,
  sceneAttachedIds,
  sceneMediaEmptyMessage,
  sceneMediaPool,
  toggleAttachment,
  unresolvedAttachedIds,
  type SceneMediaCandidate,
} from './sceneMedia.js';
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
  /**
   * The story the globe is rendering — the pool `sceneBackground` resolves
   * `Scene.itemIds` against, and therefore the only honest source for the
   * background picker.
   *
   * The *rendered* story, deliberately, not one carrying the authored deck: an
   * id is a promise that the presented document contains that entity, and the
   * two documents differ (see `scenes/story.ts`). Optional because the panel
   * must stay mountable with nothing loaded — the picker then says it has
   * nothing to offer, which is true.
   */
  story?: Story | null;
  /** From `SceneControl.problems`; only this scene's are shown, beside the
   *  field that caused each one. */
  problems?: readonly SceneProblem[];
  /**
   * Upload a new photo or video straight into this scene's background,
   * instead of only offering what is already in the story.
   *
   * Two collaborating optional props, both omitted together: `uploadApi` null
   * or absent renders nothing (matching `MediaUploadSection`'s own behaviour
   * everywhere else it appears), which keeps this panel mountable with no
   * Atlas API configured, exactly as it is mountable with no story loaded.
   */
  uploadApi?: AtlasApiConfig | null;
  /** Merge the uploaded file into the *rendered* story — the same route a
   *  dropped KML or an Import & export upload takes — so it exists to attach
   *  in the first place. Attaching it to *this* scene happens locally, right
   *  after, using `onPatch` above. */
  onUploadPhoto?: (file: ImportedFile) => void;
  /** Where to pin an uploaded photo. Read at the moment of upload, not at
   *  render — the caller decides (this scene's own camera when it has one,
   *  the live globe view otherwise). */
  uploadPosition?: () => { lat: number; lon: number } | null;
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
 * What handling an upload made from inside this scene means for the scene
 * itself: nothing, or the `itemIds` patch that attaches the one item it
 * produced.
 *
 * An upload made here means "use this," not "add this to the story and maybe
 * pick it later from the grid below" — so success attaches immediately. Null
 * for an upload the section itself already reported as failed (`file.error`)
 * and for the "uploaded but not placed" case (`itemFromUpload` in
 * `MediaUploadSection` returns no item when there is nowhere to pin it): both
 * already have their own message on screen, in the upload section itself,
 * and a scene should not additionally claim an attachment that does not
 * exist. Exported and pure so this decision is testable without a DOM —
 * `renderToStaticMarkup`, which is how this component's suite runs, cannot
 * exercise a click.
 */
export function scenePhotoPatch(file: ImportedFile, attached: readonly string[]): ScenePatch | null {
  if (file.error || file.items.length !== 1) return null;
  return { itemIds: toggleAttachment(attached, file.items[0]!.id) };
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

/**
 * What the panel says under the picker.
 *
 * Three states, and the distinction between the last two is the point: a scene
 * can have ids attached and still show nothing, which is exactly the situation
 * an author cannot diagnose by looking at the slide. Prose rather than JSX so
 * it is one text node — assertable in a suite, and read out as one phrase.
 */
export function backgroundNote(showing: SceneMediaCandidate | null, attachedCount: number): string {
  if (showing) {
    return `“${showing.label}” is on the slide. Full screen uses it edge to edge; every other layout puts it at the top of the card.`;
  }
  if (attachedCount > 0) {
    return 'Nothing attached here can be shown, so the slide falls back to the story’s cover image or its tint.';
  }
  return 'Optional. Pick one or more; the first the story resolves is the one the slide shows.';
}

/**
 * The line about attached ids with no tile, or null when there are none.
 *
 * Worth a sentence rather than silence: `sceneFromMemory` seeds a scene with
 * its memory's id whether or not that memory has a loadable picture, so a
 * perfectly ordinary scene can carry ids this picker cannot draw — and "Use
 * none" clears those too, which is a surprise unless it is said first.
 */
export function unresolvedNote(ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  const shown = ids.slice(0, 2).join(', ') + (ids.length > 2 ? ', …' : '');
  const what = ids.length === 1 ? 'one entity' : `${ids.length} entities`;
  return `This scene also points at ${what} with no picture to show (${shown}). “Use none” clears those too.`;
}

export function SceneEditor({
  scene, index, count, onPatch, onRemove, onCaptureCamera, story = null, problems = [],
  uploadApi = null, onUploadPhoto, uploadPosition,
}: SceneEditorProps) {
  const ids = useId();
  // Local draft for the three free-text fields — see the header. Reset by
  // comparing the id during render rather than in an effect, so switching
  // scenes never paints one frame of the previous scene's text into the new
  // scene's boxes (which, with a keystroke landing in between, would write it).
  const [draft, setDraft] = useState({ id: '', title: '', narrative: '', audio: '' });
  const [captureError, setCaptureError] = useState<string | null>(null);

  if (scene && draft.id !== scene.id) {
    setDraft({
      id: scene.id,
      title: scene.title ?? '',
      narrative: narrativeText(scene),
      audio: scene.audioUrl ?? '',
    });
    if (captureError) setCaptureError(null);
  }

  // Keyed on the story alone: resolving a background walks every item and every
  // media entry of an archive that routinely holds hundreds, and it does not
  // depend on the scene — which is the thing changing on every keystroke.
  const pool = useMemo(() => sceneMediaPool(story), [story]);

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
  const mediaProblem = problemFor('itemIds');
  const audioProblem = problemFor('audioUrl');
  const layout = sceneLayout(scene);
  const pose = describeScenePose(scene.camera);
  const title = draft.id === scene.id ? draft.title : (scene.title ?? '');
  const narrative = draft.id === scene.id ? draft.narrative : narrativeText(scene);

  // What the scene attaches, in whichever spelling it arrived — and which of
  // those the presenter is actually painting. Both come from `sceneMedia.ts`
  // so the panel and the slide cannot disagree.
  const attached = sceneAttachedIds(scene);
  const showing = backgroundCandidate(pool.candidates, attached);
  const orphanNote = unresolvedNote(unresolvedAttachedIds(pool.candidates, attached));

  const handleScenePhoto = (file: ImportedFile) => {
    onUploadPhoto?.(file);
    const patch = scenePhotoPatch(file, attached);
    if (patch) onPatch(patch);
  };

  const audio = draft.id === scene.id ? draft.audio : (scene.audioUrl ?? '');
  const audioCheck = checkAudioUrl(audio);
  // Never offer a player or a Clear control for text the field is refusing:
  // that pairing is what made the stored-prefix bug look like a working
  // attachment. The preview follows the field's verdict, not just storage.
  const audioPreview = audioCheck.state === 'rejected' ? null : playableAudioUrl(scene.audioUrl);

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
            setDraft({ id: scene.id, title: e.target.value, narrative, audio });
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
            setDraft({ id: scene.id, title, narrative: e.target.value, audio });
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

      {/* ---- background ---------------------------------------------------
          Thumbnails rather than an id field, because "attach the harbour
          photo" is a visual decision and `mem-4f2a…` is not a photo. Every
          tile is something `sceneBackground` will actually resolve — see
          `sceneMedia.ts` — so a picked tile always changes the slide. */}
      <div className="sc-field">
        <span className="sc-label" id={`${ids}-media`}>Background</span>
        {onUploadPhoto && (
          <MediaUploadSection
            api={uploadApi}
            onUploaded={handleScenePhoto}
            position={uploadPosition}
            heading="Add a new photo"
            hint={
              <>
                Uploaded to this Atlas server and attached to this scene the moment
                it lands — pinned at the scene&rsquo;s own view when it has one, the
                live globe view otherwise. A video has no still frame, so it can be
                shown on the globe but not used as a scene background.
              </>
            }
          />
        )}
        {pool.candidates.length === 0 ? (
          <p className="sc-empty">{sceneMediaEmptyMessage(pool)}</p>
        ) : null}
        {pool.candidates.length > 0 ? (
          <>
            <div className="sc-media" role="group" aria-labelledby={`${ids}-media`}>
              {pool.candidates.map((c) => {
                const on = attached.includes(c.id);
                const onSlide = showing?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`sc-thumb${on ? ' active' : ''}${onSlide ? ' showing' : ''}`}
                    aria-pressed={on}
                    title={c.detail ? `${c.label} — ${c.detail}` : c.label}
                    onClick={() => onPatch({ itemIds: toggleAttachment(attached, c.id) })}
                  >
                    {/* Decorative: the button's own text names the picture, and
                        a duplicate alt would have a screen reader say it
                        twice. */}
                    <img className="sc-thumb-img" src={c.thumbUrl} alt="" loading="lazy" decoding="async" />
                    <span className="sc-thumb-name">{c.label}</span>
                    <span className="sc-thumb-kind">
                      {/* Never colour alone: the tile that is *winning* says so
                          in words, because "attached" and "on the slide" are
                          different states and only one of them is visible in
                          the presentation. */}
                      {onSlide ? 'On the slide' : SCENE_MEDIA_KIND_LABEL[c.kind]}
                      {c.isPoster ? ' · still' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="sc-note">{backgroundNote(showing, attached.length)}</p>
          </>
        ) : null}
        {/* Outside the branch above on purpose. An empty picker is exactly when
            a scene is most likely to be holding ids nothing here can draw —
            `sceneFromMemory` seeds them, and a Memory archive whose pictures
            live at internal addresses draws none of them — so the note that
            explains it, and the only control that clears it, must not vanish
            with the grid. They did, which left the author looking at an
            unexplained attachment with no way to remove it. */}
        {attached.length > 0 ? (
          <div className="sc-row-actions">
            <button
              type="button"
              className="sc-action ghost"
              onClick={() => onPatch({ itemIds: null })}
            >
              Use none
            </button>
          </div>
        ) : null}
        {orphanNote ? <p className="sc-note">{orphanNote}</p> : null}
        {mediaProblem ? (
          <p className="sc-warning" role="alert"><WarnIcon aria-hidden="true" /><span>{mediaProblem.message}</span></p>
        ) : null}
      </div>

      {/* ---- narration ----------------------------------------------------
          Checked against the presenter's own sanitiser as it is typed: a URL
          `safeMediaUrl` refuses is dropped by `buildDeck` in silence, and an
          author who cannot tell the difference between "attached" and
          "attached and inaudible" is guessing. */}
      <div className="sc-field">
        <label htmlFor={`${ids}-audio`}>Narration</label>
        <input
          id={`${ids}-audio`}
          className="sc-input"
          /* `text`, not `url`: `checkAudioUrl` is the rule here, and the
             browser's own URL validation disagrees with it in both directions
             — it rejects the relative link the deck happily plays, and it
             accepts `javascript:` and `data:`, which the deck drops. Two
             validators giving one field two different verdicts is worse than
             either. `inputMode` still asks a phone for the right keyboard. */
          type="text"
          inputMode="url"
          value={audio}
          placeholder="https://…/narration.mp3"
          aria-invalid={audioCheck.state === 'rejected' || undefined}
          aria-describedby={`${ids}-audio-help`}
          onChange={(e) => {
            const value = e.target.value;
            setDraft({ id: scene.id, title, narrative, audio: value });
            const check = checkAudioUrl(value);
            // A refused URL CLEARS what is stored; it does not merely decline
            // to overwrite it. Returning early here was wrong in both
            // directions, because this fires per keystroke:
            //
            //   typing  — every accepted prefix of a rejected URL was written,
            //     so `data:audio/mpeg;base64,…` left `audioUrl: "data"` on the
            //     scene, with a player and a Clear button beside the rejection
            //     warning, and that string rode out into the exported document;
            //   pasting — no intermediates fire, so the PREVIOUS good URL
            //     stayed attached and kept playing while the field showed
            //     refused text, with nothing saying the old track was still on
            //     the slide.
            //
            // Both are the same mistake: what the field says and what the scene
            // holds have to agree, and the field is the author's intent.
            onPatch({ audioUrl: check.state === 'ok' || check.state === 'relative' ? check.url : null });
          }}
          onBlur={() => {
            // Show what is stored. The sanitiser removes invisible characters
            // from anywhere in the string, so a pasted link can be stored
            // pointing somewhere other than the text on screen — and an author
            // cannot debug an address they are not being shown.
            //
            // On blur rather than on change: rewriting the field mid-keystroke
            // moves the caret, and a URL is half-invalid for most of the time
            // it is being typed.
            const check = checkAudioUrl(audio);
            if ((check.state === 'ok' || check.state === 'relative') && check.tidied) {
              setDraft({ id: scene.id, title, narrative, audio: check.url });
            }
          }}
        />
        {(audioCheck.state === 'ok' || audioCheck.state === 'relative') && audioCheck.tidied ? (
          <p className="sc-note">{AUDIO_URL_TIDIED}</p>
        ) : null}
        {audioPreview ? (
          <audio
            className="sc-audio"
            controls
            preload="none"
            src={audioPreview}
            aria-label={`Narration for ${title.trim() || `Scene ${index + 1}`}`}
          />
        ) : null}
        {audioPreview ? (
          <div className="sc-row-actions">
            <button
              type="button"
              className="sc-action ghost"
              onClick={() => {
                setDraft({ id: scene.id, title, narrative, audio: '' });
                onPatch({ audioUrl: null });
              }}
            >
              Clear narration
            </button>
          </div>
        ) : null}
        {audioCheck.state === 'rejected' ? (
          <p className="sc-warning" role="alert"><WarnIcon aria-hidden="true" /><span>{audioCheck.reason}</span></p>
        ) : null}
        {audioCheck.state === 'relative' ? (
          <p className="sc-warning" role="alert"><WarnIcon aria-hidden="true" /><span>{audioCheck.note}</span></p>
        ) : null}
        <p className="sc-note" id={`${ids}-audio-help`}>
          Optional. Plays when the slide opens — a reader whose browser blocks autoplay gets a play button instead.
        </p>
        {audioProblem ? (
          <p className="sc-warning" role="alert"><WarnIcon aria-hidden="true" /><span>{audioProblem.message}</span></p>
        ) : null}
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
      {mine.filter((p) => p !== cameraProblem && p !== timeProblem && p !== mediaProblem && p !== audioProblem).map((p, i) => (
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
