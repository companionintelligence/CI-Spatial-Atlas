import { useState } from 'react';

const DISMISS_KEY = 'atlas.welcome.dismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Storage can be refused (private windows, blocked site data). The card then
    // returns on the next visit, which is harmless.
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Nothing to do: the dismissal lasts this visit only.
  }
}

/**
 * The first thing a visitor to the demo reads: what this is, and the two things to do next.
 * It replaces the memory card that used to open by itself over the globe.
 */
export function WelcomeCard({ onTour, onConnect }: { onTour: () => void; onConnect: () => void }) {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed) return null;

  const dismiss = () => {
    rememberDismissed();
    setDismissed(true);
  };

  return (
    <section className="atlas-welcome" aria-label="About this demo">
      <div className="atlas-welcome-copy">
        <strong>Companion Atlas</strong>
        <span>
          Your memories, placed on a globe and in time. You are looking at a demo story. Connect a
          Companion Memory to see yours.
        </span>
      </div>
      <div className="atlas-welcome-actions">
        <button type="button" className="atlas-btn primary" onClick={onTour}>
          Take the tour
        </button>
        <button type="button" className="atlas-btn" onClick={onConnect}>
          Connect my memories
        </button>
      </div>
      <button type="button" className="atlas-welcome-close" aria-label="Dismiss" onClick={dismiss}>
        ×
      </button>
    </section>
  );
}
