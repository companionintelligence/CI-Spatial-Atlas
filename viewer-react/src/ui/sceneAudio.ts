/**
 * Scene narration playback — `Scene.audioUrl`, the third schema field nothing
 * in the viewer has ever read.
 *
 * ── Why this is a controller and not four lines in a `useEffect` ────────────
 *
 * Because the browser gets a vote. `HTMLMediaElement.play()` returns a promise
 * that *rejects* with `NotAllowedError` when the page has not earned an
 * autoplay gesture, and Chrome/Safari both refuse by default on a first visit.
 * Code that calls `play()` and moves on ends up with a UI claiming to be
 * narrating in silence — and, because the rejection is an unhandled promise, a
 * red console error on top. So the outcome of the attempt is *state*: 'blocked'
 * is a real, expected result that the UI must be able to show a control for.
 *
 * The element is injected rather than constructed, so every one of those
 * outcomes — refused, resolved late, refused for the *previous* scene — is
 * exercised in the node suite with no DOM and no audio hardware.
 */

export type AudioStatus =
  /** The scene carries no narration. */
  | 'none'
  /** Loaded, not playing, and the reader has not been asked. */
  | 'idle'
  | 'playing'
  /** The reader paused it. Nothing autoplays again until they say so. */
  | 'paused'
  /** The browser refused to autoplay. Needs a gesture — show a play control. */
  | 'blocked'
  /** The source will not load or decode. Nothing to offer. */
  | 'error';

export interface SceneAudioState {
  url: string | null;
  status: AudioStatus;
}

/** The slice of `HTMLAudioElement` this controller uses. */
export interface AudioElementLike {
  src: string;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
}

export interface SceneAudioController {
  state(): SceneAudioState;
  /** A scene became current. Stops whatever was playing and, if autoplay is
   *  still permitted, tries to start the new track. */
  enter(url: string | null | undefined): void;
  /** Leaving the presentation: stop and forget. */
  stop(): void;
  /** From a user gesture — retry a blocked track or resume a paused one. This
   *  also re-arms autoplay for later scenes, because the reader just told us
   *  they want to hear it. */
  resume(): void;
  /** The reader pressed pause. Disarms autoplay for the rest of the session. */
  pause(): void;
  /** Whether the *next* scene should try to play on its own. */
  autoplayArmed(): boolean;
}

export interface SceneAudioOptions {
  /** Build the element for a URL. Defaults to `new Audio(url)` in a browser. */
  create?: (url: string) => AudioElementLike;
  onChange?: (state: SceneAudioState) => void;
  /** Start armed. The presenter passes `true` because *opening* the presenter
   *  is itself the user gesture that unlocks audio — which is why the first
   *  scene's narration usually plays and the reader never sees 'blocked'. */
  autoplay?: boolean;
}

function defaultCreate(url: string): AudioElementLike {
  // `Audio` only exists in a browser; the node suite always injects `create`.
  return new Audio(url);
}

/**
 * Classify a rejected `play()`.
 *
 * `NotAllowedError` is the autoplay policy and means "ask the user"; every
 * media decoding failure surfaces as `NotSupportedError` (or an `AbortError`
 * when a load was cancelled by a newer one) and means "there is nothing to
 * offer". Getting this wrong in either direction is visible: a decode failure
 * shown as 'blocked' leaves a play button that can never work, and a policy
 * refusal shown as 'error' hides the button that would have fixed it.
 */
function statusForRejection(err: unknown): AudioStatus {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotSupportedError' || name === 'NotFoundError') return 'error';
  return 'blocked';
}

export function createSceneAudio(opts: SceneAudioOptions = {}): SceneAudioController {
  const create = opts.create ?? defaultCreate;
  const onChange = opts.onChange;

  let el: AudioElementLike | null = null;
  let state: SceneAudioState = { url: null, status: 'none' };
  let armed = opts.autoplay ?? true;
  /**
   * Bumped on every `enter`/`stop`. A `play()` promise settles a turn later, by
   * which time the reader may already be two slides on — and the previous
   * scene's rejection would otherwise overwrite the current scene's status with
   * 'blocked'. Scene 4 showing "narration blocked" because scene 2's file was a
   * 404 is exactly the kind of bug that only appears when someone clicks fast.
   */
  let generation = 0;

  const set = (next: Partial<SceneAudioState>) => {
    const merged = { ...state, ...next };
    if (merged.url === state.url && merged.status === state.status) return;
    state = merged;
    onChange?.(state);
  };

  const attempt = () => {
    if (!el) return;
    const mine = generation;
    try {
      const p = el.play();
      // Some elements (and every fake) return undefined rather than a promise;
      // treat that as the old synchronous contract and believe it.
      if (!p || typeof (p as Promise<void>).then !== 'function') { set({ status: 'playing' }); return; }
      void (p as Promise<void>).then(
        () => { if (mine === generation) set({ status: 'playing' }); },
        (err: unknown) => {
          if (mine !== generation) return;
          // Quietly. An autoplay refusal is the browser working as designed,
          // not an application error, and logging it trains people to ignore
          // the console.
          armed = false;
          set({ status: statusForRejection(err) });
        },
      );
    } catch (err) {
      // Older WebKit throws synchronously instead of rejecting.
      armed = false;
      set({ status: statusForRejection(err) });
    }
  };

  const teardown = () => {
    generation++;
    if (el) {
      try { el.pause(); } catch { /* an element mid-load can throw; nothing to do */ }
      el = null;
    }
  };

  return {
    state: () => state,

    enter(url) {
      const next = typeof url === 'string' && url !== '' ? url : null;
      teardown();
      if (!next) { set({ url: null, status: 'none' }); return; }
      try {
        el = create(next);
      } catch {
        set({ url: next, status: 'error' });
        return;
      }
      set({ url: next, status: armed ? 'idle' : 'paused' });
      if (armed) attempt();
    },

    stop() {
      teardown();
      set({ url: null, status: 'none' });
    },

    resume() {
      if (!el) return;
      armed = true;
      attempt();
    },

    pause() {
      if (!el) return;
      // Disarm: a reader who silenced scene 2 does not want scene 3 to start
      // talking. They can un-silence it with the same control.
      armed = false;
      try { el.pause(); } catch { /* see teardown */ }
      generation++;
      set({ status: 'paused' });
    },

    autoplayArmed: () => armed,
  };
}
