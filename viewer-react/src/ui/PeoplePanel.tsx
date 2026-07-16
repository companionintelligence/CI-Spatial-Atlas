import { useMemo } from 'react';
import { PeopleIcon, PlayIcon } from './icons.js';
import type { AtlasMemory } from '../model/atlasModel.js';

/** Human-ish label from a participant entity id ("person:amara" → "Amara"). */
export function personLabel(id: string): string {
  const tail = id.split(/[:/]/).pop() ?? id;
  const clean = tail.replace(/[-_]+/g, ' ').trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : id;
}

export interface PersonGroup { id: string; label: string; memories: AtlasMemory[] }

export function groupByPerson(memories: AtlasMemory[]): PersonGroup[] {
  const map = new Map<string, AtlasMemory[]>();
  for (const m of memories) {
    for (const p of m.people ?? []) {
      map.set(p, [...(map.get(p) ?? []), m]);
    }
  }
  return [...map.entries()]
    .map(([id, mems]) => ({ id, label: personLabel(id), memories: mems }))
    .sort((a, b) => b.memories.length - a.memories.length);
}

/** People facet — everyone who appears in your located memories; play a
 *  person's journey (their memories as a time-machine flythrough). */
export function PeoplePanel({ open, groups, onClose, onPlayPerson }: {
  open: boolean;
  groups: PersonGroup[];
  onClose: () => void;
  onPlayPerson: (g: PersonGroup) => void;
}) {
  const total = useMemo(() => groups.reduce((n, g) => n + g.memories.length, 0), [groups]);
  if (!open) return null;
  return (
    <aside className="atlas-sbdrawer atlas-people" aria-label="People">
      <header className="sb-head">
        <b><PeopleIcon /> People</b>
        <span className="sb-count">{groups.length}</span>
        <button className="sb-close" aria-label="Close people" onClick={onClose}>✕</button>
      </header>
      {groups.length === 0 ? (
        <p className="sb-empty">No participants on these memories yet — Companion Memory tags people on events as they're captured.</p>
      ) : (
        <ul className="sb-list">
          {groups.map((g) => (
            <li key={g.id} className="sb-item people-row">
              <div className="people-avatar" aria-hidden="true">{g.label.charAt(0)}</div>
              <div className="sb-item-body">
                <b>{g.label}</b>
                <span>{g.memories.length} shared {g.memories.length === 1 ? 'memory' : 'memories'}</span>
              </div>
              <button className="tm-btn" title={`Play ${g.label}'s journey`} aria-label={`Play ${g.label}'s journey`} onClick={() => onPlayPerson(g)}>
                <PlayIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      {groups.length > 0 && (
        <p className="sb-status dim">{total} appearances across your journey — click ▶ to fly through the memories you share with someone.</p>
      )}
    </aside>
  );
}
