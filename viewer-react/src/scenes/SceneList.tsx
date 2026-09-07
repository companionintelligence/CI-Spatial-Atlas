/**
 * The deck list — every authored scene in author order, and the controls that
 * change that order.
 *
 * ## Why reordering is buttons first and drag second
 *
 * Position *is* the story: `moveScene` swaps neighbours because `Scene` has no
 * ordering key (see `model.ts`), and `buildDeck` reads the array exactly as
 * written. So reordering is not a convenience here, it is the primary editing
 * gesture — which means it cannot be reachable by pointer only.
 *
 * `dnd-kit` is not a dependency of this workspace and adding one to move a row
 * up by one place would be a poor trade, so the canonical control is a pair of
 * up/down buttons: keyboard operable by construction, usable with a screen
 * reader, and the only reorder affordance that works on a touch device without
 * a long-press the user has to discover. Native HTML5 drag is layered on top
 * for a mouse, and is deliberately optional — omit `onMoveTo` and the rows stop
 * being draggable, with nothing else lost.
 *
 * ## Why the move announces itself
 *
 * A swap moves two rows at once and the row that moved keeps focus, so to
 * anyone not watching the list the button appears to do nothing. The live
 * region says where the scene landed — "Reykjavik moved to position 3 of 7" —
 * which is the only feedback a non-sighted author gets that the story order
 * changed. It is a `role="status"` (polite) rather than an alert: it is
 * confirmation of a thing the user just did, not an interruption.
 *
 * Presentational and fully controlled, like `authoring/Toolbar.tsx`: every
 * value arrives as a prop and every interaction leaves as a callback. The one
 * piece of local state is the announcement text, plus the id being dragged —
 * neither is anything the app needs to know about.
 */
import { useCallback, useState, type SVGProps } from 'react';
import type { Scene } from '@companion-atlas/story';
import type { SceneProblem } from './index.js';
import './scenes.css';

export interface SceneListProps {
  /** The deck, in author order. Never re-sorted by this component. */
  scenes: readonly Scene[];
  /** The scene the editor is showing, marked in the list. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Append a blank scene. */
  onCreate: () => void;
  /**
   * Append a scene holding the live camera pose, when the app can offer one.
   * Absent means the globe is not ready, and the affordance is not rendered —
   * a dead "capture" button in the empty state is worse than one fewer route
   * in, because the empty state is the one screen that has to teach.
   */
  onCaptureScene?: () => void;
  onRemove: (id: string) => void;
  /** One step through the deck. `+1` is later in the story. */
  onMove: (id: string, delta: 1 | -1) => void;
  /** Drop a scene at an explicit position. Omit to disable pointer dragging. */
  onMoveTo?: (id: string, index: number) => void;
  /** From `SceneControl.problems`. A row that has one is flagged, because the
   *  alternative is finding out at save time. */
  problems?: readonly SceneProblem[];
  onClose?: () => void;
}

/**
 * The name a scene shows in the list.
 *
 * Deliberately the same rule `buildDeck` uses for a slide's title — trim first,
 * so a title of three spaces is not a title, then fall back to the position.
 * If these two disagreed, a scene would be called one thing while authoring and
 * another while presenting, and the author would think they had lost a title.
 */
export function sceneTitleFor(scene: Pick<Scene, 'title'> | null | undefined, index: number): string {
  return scene?.title?.trim() || `Scene ${index + 1}`;
}

/** "Scene 3 of 7 · Reykjavik" — the row's accessible name, which has to carry
 *  the position because the position is the only thing reordering changes. */
export function sceneRowLabel(scene: Pick<Scene, 'title'> | null | undefined, index: number, count: number): string {
  return `Scene ${index + 1} of ${count} · ${sceneTitleFor(scene, index)}`;
}

/**
 * What the live region says after a move.
 *
 * Phrased as an outcome ("moved to position 3 of 7") rather than a direction
 * ("moved down"), because a move that was clamped at the end of the deck did
 * nothing at all and "moved down" would be a lie. `SceneList` only announces
 * when the index actually changed, and this sentence is what makes the
 * difference audible.
 */
export function reorderMessage(title: string, index: number, count: number): string {
  return `${title} moved to position ${index + 1} of ${count}.`;
}

export function SceneList({
  scenes,
  selectedId,
  onSelect,
  onCreate,
  onCaptureScene,
  onRemove,
  onMove,
  onMoveTo,
  problems = [],
  onClose,
}: SceneListProps) {
  const [announcement, setAnnouncement] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);

  const count = scenes.length;
  const broken = new Set(problems.map((p) => p.sceneId));

  const move = useCallback(
    (scene: Scene, index: number, delta: 1 | -1) => {
      const to = index + delta;
      // Clamped rather than wrapped in the model, so the ends are genuinely
      // no-ops. Announcing one would tell a screen-reader user the story
      // changed when it did not.
      if (to < 0 || to >= count) return;
      onMove(scene.id, delta);
      setAnnouncement(reorderMessage(sceneTitleFor(scene, index), to, count));
    },
    [count, onMove],
  );

  const drop = useCallback(
    (index: number) => {
      if (!dragId || !onMoveTo) return;
      const from = scenes.findIndex((s) => s.id === dragId);
      setDragId(null);
      if (from < 0 || from === index) return;
      onMoveTo(dragId, index);
      setAnnouncement(reorderMessage(sceneTitleFor(scenes[from], from), index, count));
    },
    [count, dragId, onMoveTo, scenes],
  );

  return (
    <section className="sc-deck" aria-label="Story deck">
      <header className="sc-head">
        <b><SlideIcon aria-hidden="true" />Scenes</b>
        <span className="sc-count">{count}</span>
        {onClose ? (
          <button type="button" className="sc-close" aria-label="Close scene authoring" onClick={onClose}>✕</button>
        ) : null}
      </header>

      <div className="sc-row-actions sc-new">
        {onCaptureScene ? (
          <button type="button" className="sc-action primary" onClick={onCaptureScene}>
            <CameraViewIcon aria-hidden="true" />
            <span>Scene from this view</span>
          </button>
        ) : null}
        <button type="button" className="sc-action" onClick={onCreate}>
          <PlusIcon aria-hidden="true" />
          <span>Blank scene</span>
        </button>
      </div>

      {count === 0 ? (
        /* The empty state is the only screen that has to teach, because nothing
           else in the app explains that a story is a deck. It names the gesture
           ("frame the globe, then…") rather than the button, since the button
           is right there and the framing is the part nobody guesses. */
        <p className="sc-empty">
          No scenes yet. Frame the globe on the place your story starts, then add
          a <b>scene from this view</b> — it keeps the camera exactly as you left
          it. Give it a title and a few lines, add the next one, and press play.
        </p>
      ) : (
        <ol className="sc-list">
          {scenes.map((scene, index) => {
            const title = sceneTitleFor(scene, index);
            const selected = scene.id === selectedId;
            return (
              <li
                key={scene.id}
                className={`sc-item${selected ? ' selected' : ''}${dragId === scene.id ? ' dragging' : ''}`}
                draggable={!!onMoveTo}
                onDragStart={(e) => {
                  setDragId(scene.id);
                  // Firefox ignores a drag that carries no payload.
                  e.dataTransfer.setData('text/plain', scene.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => { if (dragId && onMoveTo) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); drop(index); }}
              >
                <button
                  type="button"
                  className="sc-pick"
                  aria-current={selected ? 'true' : undefined}
                  aria-label={sceneRowLabel(scene, index, count)}
                  onClick={() => onSelect(scene.id)}
                >
                  <span className="sc-no" aria-hidden="true">{index + 1}</span>
                  <span className="sc-name">
                    <b>{title}</b>
                    <small>{summarise(scene)}</small>
                  </span>
                  {/* An `aria-label` on the <svg> itself is not reliably
                      exposed without `role="img"`; a visually-hidden span is,
                      in every combination. */}
                  {broken.has(scene.id) ? (
                    <span className="sc-flag">
                      <WarnIcon aria-hidden="true" />
                      <span className="sc-sr">Cannot be saved until it is fixed</span>
                    </span>
                  ) : null}
                </button>
                <div className="sc-move" role="group" aria-label={`Reorder ${title}`}>
                  <button
                    type="button"
                    className="sc-mini"
                    aria-label={`Move ${title} earlier`}
                    disabled={index === 0}
                    onClick={() => move(scene, index, -1)}
                  >
                    <UpIcon aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="sc-mini"
                    aria-label={`Move ${title} later`}
                    disabled={index === count - 1}
                    onClick={() => move(scene, index, 1)}
                  >
                    <DownIcon aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="sc-mini danger"
                    aria-label={`Delete ${title}`}
                    onClick={() => onRemove(scene.id)}
                  >
                    <TrashIcon aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Always mounted, never conditionally rendered: a live region added to
          the DOM at the same moment it gains text is frequently not announced
          at all, because assistive tech watches an existing region for changes.
          Empty until the first move. */}
      <p className="sc-live" role="status" aria-live="polite">{announcement}</p>
    </section>
  );
}

/** One line under the row's title: where it goes and whether it says anything.
 *  Not the narrative itself — a Markdown body rendered raw into a 12px row is
 *  unreadable, and `buildDeck` already owns turning it into prose. */
function summarise(scene: Scene): string {
  const parts: string[] = [];
  const c = scene.camera;
  const lat = c?.location?.lat ?? c?.lat;
  const lon = c?.location?.lon ?? c?.lon;
  parts.push(
    typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)
      ? `${lat.toFixed(2)}, ${lon.toFixed(2)}`
      : 'No view',
  );
  const words = (scene.narrative ?? scene.caption ?? '').trim().split(/\s+/).filter(Boolean).length;
  parts.push(words ? `${words} word${words === 1 ? '' : 's'}` : 'No text');
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Icons — local to the scene panel rather than added to `ui/icons.tsx`, which
// the shell owns; the same choice, and the same 24×24 stroked grid, as
// `authoring/Toolbar.tsx`.
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

const SlideIcon = (p: P) => (
  <svg {...S(p)}><rect x="3" y="4.5" width="18" height="12.5" rx="2" /><path d="M8 20.5h8M12 17v3.5" /></svg>
);
const PlusIcon = (p: P) => <svg {...S({ ...p, strokeWidth: 1.8 })}><path d="M12 5v14M5 12h14" /></svg>;
const CameraViewIcon = (p: P) => (
  <svg {...S(p)}><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 7l1.5-2.5h5L16 7" /><circle cx="12" cy="13.5" r="3.4" /></svg>
);
const UpIcon = (p: P) => <svg {...S(p)}><path d="m6 14 6-6 6 6" /></svg>;
const DownIcon = (p: P) => <svg {...S(p)}><path d="m6 10 6 6 6-6" /></svg>;
const TrashIcon = (p: P) => (
  <svg {...S(p)}><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10.5 11v5M13.5 11v5" /></svg>
);
const WarnIcon = (p: P) => (
  <svg {...S(p)}><path d="M12 4 2.6 20h18.8z" /><path d="M12 10v4M12 17v.01" /></svg>
);
