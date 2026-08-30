/**
 * Dictation for the wrist menu.
 *
 * Typing in a headset is the thing everyone complains about: the system
 * keyboard is a two-finger peck at a floating slab, and it is the reason
 * in-headset search usually goes unused. Wander — the Street View app people
 * actually navigate the whole planet in — makes voice the primary way to name a
 * place, and reviewers reach for it over the keyboard every time.
 *
 * So voice is offered here, and it is offered *as an extra*. `webkitSpeechRecognition`
 * is a Chromium-only, network-backed API: it does not exist in Firefox or in
 * WebKit-based headset browsers, it needs a microphone permission that a user
 * can refuse, and it is absent from the emulator this path is tested in. Every
 * one of those is a normal Tuesday, not an error state — which is why the menu's
 * filters and pager are a complete path on their own and this module's only
 * contract is "may return nothing".
 */

/** The slice of the Web Speech API we use. Local, so it cannot clash with lib.dom. */
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognizerCtor = new () => Recognizer;

function ctor(): RecognizerCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function voiceSearchAvailable(): boolean {
  return ctor() != null;
}

export interface Dictation {
  /** Stop listening. Safe to call after it has already ended. */
  cancel(): void;
}

/**
 * How long to wait for a recogniser that has gone quiet.
 *
 * `start()` resolving proves nothing: with the microphone permission unresolved
 * or denied, Chromium's recogniser can accept `start()` and then never fire
 * `onresult`, `onerror` *or* `onend`. Measured in an automated browser with the
 * permission cleared: the panel sat on "Listening" for the full six seconds it
 * was watched, and would have sat there forever. Eight seconds is longer than
 * anyone speaks one search phrase for, and short enough that a dead recogniser
 * gives the row back before the wearer concludes the menu is broken.
 */
const SILENCE_TIMEOUT_MS = 8000;

/**
 * Listen for one phrase.
 *
 * `onDone` always fires exactly once — on a transcript, on an error, or on the
 * recogniser giving up in silence. The menu's "Listening…" row is driven by it,
 * and a row that never stops saying "Listening" is worse than no voice at all.
 */
export function dictate(onDone: (transcript: string | null) => void): Dictation | null {
  const Ctor = ctor();
  if (!Ctor) return null;

  let settled = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const finish = (text: string | null) => {
    if (settled) return;
    settled = true;
    if (watchdog !== undefined) clearTimeout(watchdog);
    onDone(text);
  };

  let recognition: Recognizer;
  try {
    recognition = new Ctor();
  } catch {
    return null;
  }

  recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const best = event.results?.[0]?.[0]?.transcript ?? '';
    finish(best.trim() || null);
  };
  recognition.onerror = () => finish(null);
  recognition.onend = () => finish(null);

  const stop = () => {
    try {
      recognition.abort();
    } catch {
      /* already stopped */
    }
  };

  try {
    recognition.start();
  } catch {
    // Already running, or the page has no gesture to spend. Either way there is
    // no session to cancel.
    finish(null);
    return null;
  }

  watchdog = setTimeout(() => {
    stop();
    finish(null);
  }, SILENCE_TIMEOUT_MS);

  return {
    cancel() {
      stop();
      finish(null);
    },
  };
}
