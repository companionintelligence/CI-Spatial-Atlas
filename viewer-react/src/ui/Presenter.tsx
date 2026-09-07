/**
 * Present mode — stepping a reader through `story.scenes[]` one scene at a time.
 *
 * The parity target is Google Earth's story presentation: a Present button, a
 * table of contents, next/previous, full-screen slides, a position indicator
 * and a way out. What the atlas adds is that the globe is *live* behind the
 * three card layouts, so a scene can narrate a place while the reader can still
 * turn it.
 *
 * ── What this component does NOT do ────────────────────────────────────────
 *
 * It never touches Cesium. Camera flights and the clock belong to `AtlasApp`,
 * which owns the viewer; this component's job is to decide *which scene is
 * current* and say so through `onSceneEnter`. Everything the caller needs to
 * fly and to set the clock — a resolved `camera`, a `timeMs`, a normalised
 * `transition` — rides on the `DeckSlide` it hands over. Keeping the direction
 * of that dependency one-way is what lets the presenter be unit-tested and
 * re-used by the XR renderer, which has no Cesium viewer at all.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Scene, Story } from '@companion-atlas/story';
import { PauseIcon, PlayIcon, PrevIcon, NextIcon } from './icons.js';
import { SceneLayout } from './SceneLayout.js';
import {
  buildDeck,
  type DeckCursor,
  type DeckMemory,
  canStep,
  clampIndex,
  deckCursor,
  deckSignature,
  isTypingTarget,
  keyToCommand,
  positionLabel,
  reconcileCursor,
  sameCursor,
  slideEnterKey,
  stepIndex,
  type DeckSlide,
} from './sceneDeck.js';
import { createSceneAudio, type AudioElementLike, type AudioStatus, type SceneAudioState } from './sceneAudio.js';
import '../theme/presenter.css';

export interface PresenterProps {
  /** Derived memories, used to build a deck when the story has no authored
   *  scenes — which is every Companion Memory story. Without this the
   *  presenter is reachable only from a story someone wrote by hand. */
  memories?: readonly DeckMemory[];
  story: Story;
  /**
   * The scenes the user is authoring, which take the deck over when there are
   * any (see `deckScenes`).
   *
   * Passed as an array rather than as a story that already contains them, on
   * purpose. `deriveModel` collapses the globe to one pin per scene the moment
   * `story.scenes` is non-empty, so a merged story is a loaded gun sitting in
   * the render tree next to the globe; keeping the merge inside the caller's
   * memo and handing over only the array means there is nothing to misroute.
   * The caller is expected to hand over the *reconciled* deck —
   * `SceneControl.toStory(story)?.scenes` — so that Present previews exactly
   * what saving or downloading would produce.
   */
  authoredScenes?: readonly Scene[] | null;
  /** Present mode on/off. Rendering nothing when closed keeps the caller's JSX
   *  free of a conditional and keeps this component's state alive across a
   *  close/open cycle only where it should be (it resets on open). */
  open: boolean;
  onExit: () => void;
  /**
   * A scene became current — on open, on step, and on a jump from the contents
   * list. This is the hook the caller drives the camera and the clock from; see
   * the file header for why the presenter does not do it itself.
   */
  onSceneEnter?: (slide: DeckSlide) => void;
  /** The previous scene stopped being current (also fires on exit). Useful for
   *  tearing down anything `onSceneEnter` started. */
  onSceneLeave?: (slide: DeckSlide) => void;
  /** Open on this scene rather than the first — e.g. the memory the reader had
   *  selected when they pressed Present. Read once, when `open` flips true. */
  initialSceneId?: string | null;
  /** The caller already computes this for the globe; passing it keeps one
   *  answer for the whole app instead of two `matchMedia` calls that can
   *  disagree. Turns every transition into a cut. */
  reduceMotion?: boolean;
  /** Test seam: build the audio element. Read once, on first render. */
  createAudio?: (url: string) => AudioElementLike;
}

/**
 * Icons local to this feature rather than added to `icons.tsx`.
 *
 * The shared icon set is touched by everything; a presentation-only glyph in it
 * is a merge conflict waiting for someone else's branch, and neither of these
 * has a second caller.
 */
const ContentsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6h1M4 12h1M4 18h1M9 6h11M9 12h11M9 18h11" />
  </svg>
);

function AudioControl({ status, onPlay, onPause }: {
  status: AudioStatus;
  onPlay: () => void;
  onPause: () => void;
}) {
  if (status === 'none') return null;

  if (status === 'error') {
    return (
      <p className="pr-audio pr-audio-err" role="status">
        Narration for this scene could not be loaded.
      </p>
    );
  }

  const playing = status === 'playing';
  return (
    <div className="pr-audio">
      <button
        type="button"
        className={`pr-audio-btn${playing ? ' playing' : ''}`}
        aria-label={playing ? 'Pause narration' : 'Play narration'}
        title={playing ? 'Pause narration (M)' : 'Play narration (M)'}
        onClick={playing ? onPause : onPlay}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
        <span>{playing ? 'Narrating' : 'Narration'}</span>
      </button>
      {/* The honest state, shown rather than hidden. A browser refusing to
          autoplay is not an error and not the reader's fault, but a silent
          slide that was supposed to talk is a broken slide unless something on
          screen says otherwise and offers the fix. */}
      {status === 'blocked' && (
        <span className="pr-audio-hint" role="status">Your browser paused it — press play</span>
      )}
    </div>
  );
}

export function Presenter({
  story,
  open,
  onExit,
  onSceneEnter,
  onSceneLeave,
  initialSceneId,
  reduceMotion = false,
  createAudio,
  memories,
  authoredScenes,
}: PresenterProps) {
  const deck = useMemo(
    () => buildDeck(story, { reduceMotion, memories, authored: authoredScenes }),
    [story, reduceMotion, memories, authoredScenes],
  );
  const count = deck.length;
  /** Which scenes, in which order — the deck's identity for the reconciliation
   *  below. Content rather than reference, so a caller that hands over a fresh
   *  array every render costs a rebuild and not a render loop. */
  const deckKey = useMemo(() => deckSignature(deck), [deck]);

  /** Position plus identity — see `DeckCursor` for why an index alone stopped
   *  being enough once the deck became editable. */
  const [cursor, setCursor] = useState<DeckCursor>({ index: 0, id: null });
  const index = cursor.index;
  const [contentsOpen, setContentsOpen] = useState(false);
  const [audioState, setAudioState] = useState<SceneAudioState>({ url: null, status: 'none' });

  const [audio] = useState(() => createSceneAudio({
    create: createAudio,
    onChange: setAudioState,
    // Armed on purpose: *opening the presenter is itself a click*, so the
    // browser's autoplay gate is usually already satisfied by the time the
    // first scene asks. When it is not, `sceneAudio` records 'blocked' and the
    // control above offers the gesture instead of pretending it played.
    autoplay: true,
  }));

  /**
   * Callbacks through refs.
   *
   * `onSceneEnter` will be an inline arrow at the call site — it always is —
   * so putting it in the effect's dependency array would re-run the effect on
   * every render of `AtlasApp`, which re-renders roughly four times a second
   * while the clock ticks. That is a camera flight restarting four times a
   * second. The refs make the effect depend only on which scene is current.
   */
  const enterRef = useRef(onSceneEnter);
  const leaveRef = useRef(onSceneLeave);
  const exitRef = useRef(onExit);
  enterRef.current = onSceneEnter;
  leaveRef.current = onSceneLeave;
  exitRef.current = onExit;

  /** Same trick for the contents panel, so the document-level key handler can
   *  read whether it is open without re-subscribing every time it toggles. */
  const contentsRef = useRef(contentsOpen);
  contentsRef.current = contentsOpen;

  /**
   * Resolve the opening scene during render, not in an effect.
   *
   * Done in an effect, the first commit would render (and *enter*) scene 0 and
   * the correction would land a tick later — so pressing Present on scene 5
   * flew the camera to scene 1 and then to scene 5. This is React's documented
   * "adjust state when a prop changes" escape hatch: the render is discarded
   * and re-run before any effect sees it.
   */
  const [wasOpen, setWasOpen] = useState(open);
  /**
   * The deck this component last reconciled its cursor against.
   *
   * The follow below must run when the deck's *scenes* changed and at no other
   * time. Run every render it would fight the reader: after a step, the
   * cursor's id is still the previous scene's, and following it would drag the
   * presentation straight back to the slide they just left.
   */
  const [seenKey, setSeenKey] = useState(deckKey);

  if (open !== wasOpen || deckKey !== seenKey) {
    // State, not refs, for the "what did the last render see" flags: StrictMode
    // double-invokes render, and a ref mutated on the first pass makes the
    // second pass take a different branch — the exact non-idempotence
    // StrictMode exists to surface.
    if (open !== wasOpen) setWasOpen(open);
    if (deckKey !== seenKey) setSeenKey(deckKey);
    // Opening resolves from `initialSceneId`; a deck edited under a live
    // presentation keeps the reader on the scene they are reading rather than
    // on the slot it used to occupy. `reconcileCursor` owns the interlock.
    const next = reconcileCursor({ deck, deckKey, seenKey, open, wasOpen, cursor, initialSceneId });
    if (!sameCursor(next, cursor)) setCursor(next);
    if (open && !wasOpen && contentsOpen) setContentsOpen(false);
  }

  const current = count > 0 ? deck[clampIndex(index, count)]! : null;

  // ---- scene enter / leave -------------------------------------------------

  /** The scene we last announced, keyed by everything the caller acts on — see
   *  `slideEnterKey` for why that is neither the slide object nor its index now
   *  that the deck can be edited while it is being presented. */
  const entered = useRef<{ key: string; slide: DeckSlide } | null>(null);

  useEffect(() => {
    if (!open || !current) return;
    const key = slideEnterKey(current);
    if (entered.current?.key === key) return;
    const previous = entered.current?.slide;
    entered.current = { key, slide: current };
    if (previous) leaveRef.current?.(previous);
    enterRef.current?.(current);
    // Only re-arm the narration when the track itself changed. Re-entering a
    // scene because its camera was just re-captured has to move the globe, but
    // restarting the voice-over the reader is halfway through would read as the
    // edit having broken something.
    if (previous?.audioUrl !== current.audioUrl) audio.enter(current.audioUrl);
  }, [open, current, audio]);

  useEffect(() => {
    if (open) return;
    const previous = entered.current?.slide;
    entered.current = null;
    if (previous) leaveRef.current?.(previous);
    audio.stop();
  }, [open, audio]);

  /**
   * The deck emptied while it was open — the author deleted the last scene from
   * the editor behind the presentation.
   *
   * Without this the component renders null (there is no slide to show) while
   * the caller still believes it is presenting: no way out, the last scene's
   * narration still playing over an app that is no longer showing it, and
   * `onSceneLeave` never fired for a slide that no longer exists. Exiting for
   * real is the only state that matches what is on screen.
   */
  useEffect(() => {
    if (!open || count > 0) return;
    const previous = entered.current?.slide;
    entered.current = null;
    if (previous) leaveRef.current?.(previous);
    audio.stop();
    exitRef.current();
  }, [open, count, audio]);

  // Unmounting mid-presentation must not leave a voice playing over an app that
  // is no longer showing the slide it belongs to.
  useEffect(() => () => audio.stop(), [audio]);

  // ---- stepping ------------------------------------------------------------

  /**
   * Jump straight to a scene (the contents list). Clamped, because the deck can
   * shrink under a presentation — when the story is swapped, and now whenever
   * the author deletes a scene from the editor behind it.
   *
   * Both of these record the scene at the position as well as the position, so
   * that a deck edit arriving later can find the reader again. `deckCursor` is
   * pure, which is what makes it safe inside an updater: StrictMode invokes
   * updaters twice.
   */
  const go = useCallback((to: number) => setCursor(deckCursor(deck, to)), [deck]);
  const step = useCallback(
    (dir: -1 | 1) => setCursor((c) => deckCursor(deck, stepIndex(c.index, dir, count))),
    [deck, count],
  );
  const exit = useCallback(() => exitRef.current(), []);

  const toggleAudio = useCallback(() => {
    if (audio.state().status === 'playing') audio.pause();
    else audio.resume();
  }, [audio]);

  /**
   * Keys are listened for at the document, not on the presenter's own element.
   *
   * The same reason the lightbox does it: the globe swallows clicks, so the
   * moment a reader drags the camera the presenter's container loses focus and
   * an element-scoped handler stops firing — the arrow keys would work until
   * you touched the thing the presentation is about. `keyToCommand` returns
   * null for anything carrying a modifier, so listening this widely still
   * leaves the app's own shortcuts (⌘K) alone.
   */
  useEffect(() => {
    if (!open || count === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target as HTMLElement | null)) return;
      // Space and Enter belong to a focused button first. Without this, hitting
      // Space on the focused "Contents" button steps the deck instead of
      // opening the list — the control appears not to work.
      if ((e.key === ' ' || e.key === 'Spacebar') && (e.target as HTMLElement | null)?.tagName === 'BUTTON') return;

      const cmd = keyToCommand(e);
      if (!cmd) return;
      e.preventDefault();
      switch (cmd) {
        case 'next': step(1); break;
        case 'prev': step(-1); break;
        case 'first': go(0); break;
        case 'last': go(count - 1); break;
        case 'contents': setContentsOpen((o) => !o); break;
        case 'audio': toggleAudio(); break;
        case 'exit':
          // Escape closes the contents list first. Losing a whole presentation
          // because you wanted to dismiss a panel is the kind of thing people
          // only forgive once. Read through a ref rather than by calling
          // `exit()` inside a `setContentsOpen` updater: StrictMode invokes
          // updaters twice, so a side effect in one fires `onExit` twice.
          if (contentsRef.current) setContentsOpen(false);
          else exit();
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, count, go, step, exit, toggleAudio]);

  // ---- focus ---------------------------------------------------------------

  const rootRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      rootRef.current?.focus();
    } else if (restoreRef.current) {
      // Back to the Present button, so a keyboard reader is not dumped at the
      // top of the document every time they leave a story.
      restoreRef.current.focus?.();
      restoreRef.current = null;
    }
  }, [open]);

  if (!open || !current) return null;

  const position = positionLabel(current.index, count);
  const progress = count > 1 ? (current.index / (count - 1)) * 100 : 100;

  return (
    <div
      className="atlas-presenter"
      ref={rootRef}
      tabIndex={-1}
      role="region"
      aria-roledescription="story presentation"
      aria-label={`Presenting ${story.title}`}
    >
      <SceneLayout slide={current} position={position}>
        <AudioControl
          status={current.audioUrl ? audioState.status : 'none'}
          onPlay={() => audio.resume()}
          onPause={() => audio.pause()}
        />
      </SceneLayout>

      <button
        type="button"
        className="pr-exit"
        aria-label="Exit presentation"
        title="Exit presentation (Esc)"
        onClick={exit}
      >
        ✕
      </button>

      <div className="pr-bar" role="group" aria-label="Presentation controls">
        <button
          type="button"
          className={`pr-contents-btn${contentsOpen ? ' active' : ''}`}
          aria-expanded={contentsOpen}
          aria-controls="pr-contents"
          title="Contents (C)"
          onClick={() => setContentsOpen((o) => !o)}
        >
          <ContentsIcon />
          <span>Contents</span>
        </button>

        <button
          type="button"
          className="pr-step"
          aria-label="Previous scene"
          title="Previous scene (Left arrow)"
          disabled={!canStep(current.index, -1, count)}
          onClick={() => step(-1)}
        >
          <PrevIcon />
        </button>

        <p className="pr-position">
          {/* The visible form is a fraction; the announced form is a sentence. */}
          <span className="pr-sr">{position}</span>
          <span aria-hidden="true"><b>{current.index + 1}</b> / {count}</span>
        </p>

        <button
          type="button"
          className="pr-step"
          aria-label="Next scene"
          title="Next scene (Right arrow)"
          disabled={!canStep(current.index, 1, count)}
          onClick={() => step(1)}
        >
          <NextIcon />
        </button>
      </div>

      {/* A hairline along the top edge of the stage rather than a widget in the
          control bar: it is ambient — the reader glances at it — and putting it
          where nothing else lives means it never competes with the buttons for
          room on a phone. Decorative, because `pr-position` already states the
          same fact in words. */}
      <div className="pr-progress" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>

      {contentsOpen && (
        <nav id="pr-contents" className="pr-contents" aria-label="Scenes in this story">
          <ol>
            {deck.map((s) => (
              <li key={`${s.index}:${s.id}`}>
                <button
                  type="button"
                  className={s.index === current.index ? 'active' : undefined}
                  aria-current={s.index === current.index ? 'true' : undefined}
                  onClick={() => { go(s.index); setContentsOpen(false); }}
                >
                  <span className="pr-contents-n" aria-hidden="true">{s.index + 1}</span>
                  <span className="pr-contents-text">
                    <b>{s.title}</b>
                    {s.summary && <small>{s.summary}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </div>
  );
}
