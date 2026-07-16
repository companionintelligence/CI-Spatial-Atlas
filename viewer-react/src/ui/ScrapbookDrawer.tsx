import type { Visibility } from '@companion-atlas/story';
import { mediaThumb, type AtlasMemory } from '../model/atlasModel.js';
import { SparkIcon, PlayIcon, PlusIcon } from './icons.js';

export type SaveState =
  | { s: 'idle' }
  | { s: 'saving' }
  | { s: 'done'; id: string }
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
 */
export function ScrapbookDrawer({
  open, entries, title, visibility, canSave, saveState,
  onClose, onTitle, onVisibility, onRemove, onClear, onCurate, onPlay, onSave, onDownload,
}: {
  open: boolean;
  entries: AtlasMemory[];
  title: string;
  visibility: Visibility;
  canSave: boolean;
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
  const empty = entries.length === 0;
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

      <div className="sb-actions">
        <button className="atlas-btn primary" disabled={empty} onClick={onCurate} title="Companion writes the narrative and titles the journey">
          <SparkIcon />Curate with Companion
        </button>
        <button className="atlas-btn" disabled={empty} onClick={onPlay}><PlayIcon />Play journey</button>
        <button
          className="atlas-btn"
          disabled={empty || !canSave || saveState.s === 'saving'}
          onClick={onSave}
          title={canSave ? 'Save into Companion Memory (shares per visibility)' : 'Connect Companion Memory (?memory=…) to save'}
        >
          {saveState.s === 'saving' ? 'Saving…' : 'Save to Memory'}
        </button>
        <button className="atlas-btn" disabled={empty} onClick={onDownload}>Download .story.json</button>
        <button className="atlas-btn ghost" disabled={empty} onClick={onClear}>Clear</button>
      </div>

      {saveState.s === 'done' && (
        <p className="sb-status ok" role="status">Saved to Companion Memory ({saveState.id}) — {visibility === 'private' ? 'visible only to you' : visibility === 'unlisted' ? 'your household can see it' : 'public'}.</p>
      )}
      {saveState.s === 'error' && <p className="sb-status err" role="alert">{saveState.msg}</p>}
      {!canSave && !empty && saveState.s === 'idle' && (
        <p className="sb-status dim">Not connected to Companion Memory — Play and Download work; connect with <code>?memory=&lt;server&gt;</code> to save &amp; share.</p>
      )}
    </aside>
  );
}
