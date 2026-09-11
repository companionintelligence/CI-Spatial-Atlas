import type { Scene, Visibility } from '@companion-atlas/story';
import { mediaThumb, type AtlasMemory } from '../model/atlasModel.js';
import { SparkIcon, PlayIcon, PlusIcon } from './icons.js';

export type SaveState =
  | { s: 'idle' }
  | { s: 'saving' }
  /** `visibility` is snapshotted at save time — the banner must describe what was
   *  actually shared, not whatever the radio group says now. */
  | { s: 'done'; id: string; visibility: Visibility }
  | { s: 'error'; msg: string };

const VIS_LABEL: { v: Visibility; label: string }[] = [
  { v: 'private', label: 'Private' },
  { v: 'unlisted', label: 'Household' },
  { v: 'public', label: 'Public' },
];

/**
 * The scrapbook drawer — collected memories become a journey: curate it with
 * the Companion, play it on the globe, and save it back into Companion Memory
 * (which is what shares it with the household).
 *
 * A journey's stops are not only collected memories: the deck of scenes
 * written in the Scenes panel is right there, already telling a story, and
 * "collect the same places over again by hand to reuse them" was the only
 * route in. Checking one into the journey here weaves it into the same
 * chronological line curate/play/save already build, in the position its own
 * moment puts it — not tacked on after everything else the way every
 * authored scene is when it is left unchecked.
 */
const NO_SELECTION: ReadonlySet<string> = new Set();

export function ScrapbookDrawer({
  open, entries, title, visibility, canSave, canClear, saveState,
  scenes = [], selectedSceneIds = NO_SELECTION, onToggleScene,
  onClose, onTitle, onVisibility, onRemove, onClear, onCurate, onPlay, onSave, onDownload,
}: {
  open: boolean;
  entries: AtlasMemory[];
  title: string;
  visibility: Visibility;
  canSave: boolean;
  /** The authored deck, offered as journey stops. Every scene here is savable
   *  content in its own right whether or not it is checked — checking one
   *  moves it INTO the journey; the rest still travel alongside it. */
  scenes?: Scene[];
  /** Which of `scenes`, by id, are checked in as journey stops. */
  selectedSceneIds?: ReadonlySet<string>;
  onToggleScene?: (id: string) => void;
  /** True when the raw draft holds anything — even ids this story can't resolve. */
  canClear: boolean;
  saveState: SaveState;
  onClose: () => void;
  onTitle: (t: string) => void;
  onVisibility: (v: Visibility) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onCurate: () => void;
  onPlay: () => void;
  onSave: () => void;
  onDownload: () => void;
}) {
  if (!open) return null;
  // Authored scenes are savable content in their own right, so Save and
  // Download must not be dead just because nothing was collected. A user who
  // writes a five-scene story and collects no memories has still written a
  // story, and this drawer holds the only Save button they will look for.
  const empty = entries.length === 0;
  const nothingToSave = empty && scenes.length === 0;
  // `selectedSceneIds.size` alone would count a checked id whose scene has
  // since been deleted — a stale selection nothing here can act on. Checking
  // it against the LIVE `scenes` list is what keeps this in sync with what
  // `AtlasApp`'s `journeySources` (built the same way, from the same two
  // inputs) will actually produce, so the button is never enabled for a click
  // that would visibly do nothing.
  const checkedInCount = scenes.filter((sc) => selectedSceneIds.has(sc.id)).length;
  const journeyEmpty = empty && checkedInCount === 0;
  return (
    <aside className="atlas-sbdrawer" aria-label="Scrapbook">
      <header className="sb-head">
        <b>Scrapbook</b>
        <span className="sb-count">{entries.length}</span>
        <button className="sb-close" aria-label="Close scrapbook" onClick={onClose}>✕</button>
      </header>

      <input
        className="sb-title"
        value={title}
        placeholder="Name this journey…"
        aria-label="Journey title"
        onChange={(e) => onTitle(e.target.value)}
      />

      <div className="sb-vis" role="group" aria-label="Who can see this">
        {VIS_LABEL.map(({ v, label }) => (
          <button key={v} aria-pressed={visibility === v} className={visibility === v ? 'active' : ''} onClick={() => onVisibility(v)}>
            {label}
          </button>
        ))}
      </div>

      {empty ? (
        <p className="sb-empty">
          Collect memories into your scrapbook with the <b><PlusIcon /> Collect</b> button
          on any memory, then curate them into a journey.
        </p>
      ) : (
        <ul className="sb-list">
          {entries.map((m) => {
            const t = mediaThumb(m);
            return (
              <li key={m.id} className="sb-item">
                {t ? <img className="ph" src={t} alt="" loading="lazy" /> : <div className="ph" style={{ background: m.gradient }} aria-hidden="true" />}
                <div className="sb-item-body">
                  <b>{m.title}</b>
                  <span>{m.place ? `${m.place} · ` : ''}{m.whenDate}</span>
                </div>
                <button className="sb-remove" aria-label={`Remove ${m.title}`} onClick={() => onRemove(m.id)}>✕</button>
              </li>
            );
          })}
        </ul>
      )}

      {scenes.length > 0 && (
        <div className="sb-scenes">
          <span className="sb-scenes-label">Scenes — check any to include as journey stops</span>
          <ul className="sb-scene-list">
            {scenes.map((sc) => {
              const on = selectedSceneIds.has(sc.id);
              return (
                <li key={sc.id} className="sb-scene-item">
                  <label>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggleScene?.(sc.id)}
                    />
                    <span className="sb-scene-title">{sc.title || 'Untitled scene'}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {/* A scene left unchecked is not discarded — see `draftStory` — but an
              author who just checked five boxes and sees no change to "Curate"
              or "Play" below would reasonably conclude the checkbox did
              nothing. Both operate on the journey now, not on collected
              memories alone, so this says so exactly where the confusion would
              start. */}
          <p className="sb-scenes-note">
            {selectedSceneIds.size > 0
              ? `${selectedSceneIds.size} scene${selectedSceneIds.size === 1 ? '' : 's'} will play as part of this journey.`
              : 'Unchecked scenes still save with the story — just not as part of this journey.'}
          </p>
        </div>
      )}

      <div className="sb-actions">
        <button className="atlas-btn primary" disabled={journeyEmpty} onClick={onCurate} title="Companion writes the narrative and titles the journey">
          <SparkIcon />Curate with Companion
        </button>
        <button className="atlas-btn" disabled={journeyEmpty} onClick={onPlay}><PlayIcon />Play journey</button>
        <button
          className="atlas-btn"
          disabled={nothingToSave || !canSave || saveState.s === 'saving'}
          onClick={onSave}
          title={canSave ? 'Save into Companion Memory (shares per visibility)' : 'Connect Companion Memory (?memory=…) to save'}
        >
          {saveState.s === 'saving' ? 'Saving…' : 'Save to Memory'}
        </button>
        <button className="atlas-btn" disabled={nothingToSave} onClick={onDownload}>Download .story.json</button>
        {/* Gate Clear on the raw draft, not on resolvable entries: a draft whose
            ids this story can't resolve renders zero rows, and disabling Clear
            there left the only reset affordance dead exactly when it was needed. */}
        <button className="atlas-btn ghost" disabled={!canClear} onClick={onClear}>Clear</button>
      </div>

      {saveState.s === 'done' && (
        <p className="sb-status ok" role="status">Saved to Companion Memory ({saveState.id}) — {saveState.visibility === 'private' ? 'visible only to you' : saveState.visibility === 'unlisted' ? 'your household can see it' : 'public'}.</p>
      )}
      {saveState.s === 'error' && <p className="sb-status err" role="alert">{saveState.msg}</p>}
      {!canSave && !empty && saveState.s === 'idle' && (
        <p className="sb-status dim">Not connected to Companion Memory — Play and Download work; connect with <code>?memory=&lt;server&gt;</code> to save &amp; share.</p>
      )}
    </aside>
  );
}
