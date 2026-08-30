/**
 * Which memory the off-hand plate is peeking at, and how it is credited.
 *
 * The pure half of `StreetViewPlate`. Everything here is arithmetic over ids and
 * gaze scores, so it can be reasoned about — and tested — without a headset, a
 * canvas or a network.
 */

/** A memory in view, scored by how close it is to the middle of the gaze. */
export interface PeekCandidate {
  id: string;
  /** Dot product of the gaze direction with the bearing to the memory. */
  towards: number;
}

/** Roughly 53° off-axis. Anything wider is not what the viewer is looking at. */
export const PEEK_MIN_GAZE = 0.6;

/**
 * How much better a challenger must score before the plate switches to it.
 *
 * Without this the plate flips between two memories a degree apart every time
 * the head drifts, and each flip is a metadata round trip and a new texture. A
 * held panel that keeps changing its mind is worse than one that lags.
 */
export const PEEK_SWITCH_MARGIN = 0.05;

export interface PeekChoice {
  /** The memory the viewer explicitly selected; it always wins. */
  focusedId: string | null;
  /** What the plate is showing now, so a near-tie holds rather than flickers. */
  current: string | null;
  candidates: readonly PeekCandidate[];
  minGaze?: number;
  margin?: number;
}

/**
 * Pick the memory to show.
 *
 * Focus beats gaze outright: picking a pin is a statement about what you want
 * to look at, and it should survive turning your head to talk to someone. With
 * nothing focused the plate follows the gaze, held steady by `margin`.
 */
export function choosePeek({
  focusedId,
  current,
  candidates,
  minGaze = PEEK_MIN_GAZE,
  margin = PEEK_SWITCH_MARGIN,
}: PeekChoice): string | null {
  if (focusedId) return focusedId;

  let best: PeekCandidate | null = null;
  let held: PeekCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.towards < minGaze) continue;
    if (candidate.id === current) held = candidate;
    if (!best || candidate.towards > best.towards) best = candidate;
  }

  if (!best) return null;
  if (held && best.towards - held.towards < margin) return held.id;
  return best.id;
}

/**
 * Which hand carries the plate.
 *
 * The off hand, so the dominant one stays free to point at a memory and to grab
 * the planet — the same split the grab locomotion makes between trigger and
 * grip. A single tracked controller carries it anyway; a plate you cannot see is
 * no better than no plate.
 */
export function peekHand(
  present: readonly XRHandedness[],
  preferred: XRHandedness = 'left',
): XRHandedness | null {
  if (present.includes(preferred)) return preferred;
  const other = present.find((h) => h !== 'none');
  return other ?? present[0] ?? null;
}

/**
 * The credit line.
 *
 * This is Google's imagery of the place, not the person's photo of the moment,
 * and the date is Google's capture date — usually years off the memory's own.
 * Saying so is the difference between a preview and a forgery.
 */
export function peekCredit(captured?: string): string {
  return captured ? `Street View · ${captured}` : 'Street View';
}
