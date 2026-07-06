/**
 * Journey playback controller — shared by the classic three.js path and the
 * Cesium path so the auto-fly-through-pins behavior can't drift between the
 * two renderers. Owns only the interval/index bookkeeping; the caller
 * supplies the actual pin lookup and camera-fly primitives.
 */

import type { Pin } from '../types';

export interface JourneyControllerDeps {
  getJourneyPins: () => Pin[];
  selectPin: (pinId: string) => void;
  flyToPin: (pin: Pin) => void;
  onStatus: (message: string) => void;
}

export interface JourneyController {
  start: () => void;
  stop: () => void;
  next: () => void;
}

const STEP_INTERVAL_MS = 2600;

export function createJourneyController(deps: JourneyControllerDeps): JourneyController {
  let intervalId: number | null = null;
  let index = 0;

  function stop(): void {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    deps.onStatus('Journey idle.');
  }

  function next(): void {
    const journeyPins = deps.getJourneyPins();

    if (journeyPins.length === 0) {
      deps.onStatus('No journey points. Create pins first.');
      return;
    }

    if (index >= journeyPins.length) {
      index = 0;
    }

    const pin = journeyPins[index];
    deps.selectPin(pin.id);
    deps.flyToPin(pin);
    index += 1;
    deps.onStatus(`Journey stop ${index}/${journeyPins.length}: ${pin.label}`);
  }

  function start(): void {
    stop();
    index = 0;
    next();
    intervalId = window.setInterval(next, STEP_INTERVAL_MS);
  }

  return { start, stop, next };
}
