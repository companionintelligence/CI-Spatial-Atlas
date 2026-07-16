import { PinIcon } from './icons.js';
import type { AtlasModel, AtlasMemory } from '../model/atlasModel.js';

export function StatsRibbon({ stats }: { stats: AtlasModel['stats'] }) {
  const cells = [
    { v: stats.memories.toLocaleString(), l: 'Memories' },
    { v: String(stats.places), l: 'Places' },
    { v: String(stats.years), l: 'Years' },
  ];
  return (
    <div className="atlas-stats">
      {cells.map((c) => (
        <div className="atlas-stat" key={c.l}><b>{c.v}</b><span>{c.l}</span></div>
      ))}
    </div>
  );
}

export function Legend() {
  return (
    <div className="atlas-legend" aria-hidden="true">
      <div className="row"><span className="dot" style={{ color: 'var(--atlas-aqua-light)' }} /> Photo &amp; video</div>
      <div className="row"><span className="dot" style={{ color: 'var(--atlas-violet)' }} /> Place</div>
      <div className="row"><span className="dot" style={{ color: 'var(--atlas-coral)' }} /> Focused moment</div>
      <div className="row" style={{ marginTop: 2, color: 'var(--atlas-fg-dim)' }}>
        <span style={{ width: 16, borderTop: '1.5px dashed rgba(114,221,212,.6)' }} /> Journey (time-ordered)
      </div>
    </div>
  );
}

export function PlaceChip({ memory }: { memory: AtlasMemory | null }) {
  if (!memory) return null;
  const coord = memory.lat != null && memory.lon != null
    ? `${Math.abs(memory.lat).toFixed(4)}°${memory.lat >= 0 ? 'N' : 'S'} ${Math.abs(memory.lon).toFixed(4)}°${memory.lon >= 0 ? 'E' : 'W'}`
    : null;
  return (
    <div className="atlas-place-chip">
      <PinIcon />{memory.place ?? memory.title}
      {coord && <>&nbsp;<span className="coord">{coord}</span></>}
    </div>
  );
}

/** Floating scrapbook frames clustered over the focused place. */
export function ScrapbookFrames({ memories, onSelect }: { memories: AtlasMemory[]; onSelect: (m: AtlasMemory) => void }) {
  const spots = [
    { top: '30%', left: '31%', rot: -6, z: 3 },
    { top: '25%', left: '45%', rot: 3, z: 4 },
    { top: '46%', left: '41%', rot: -2, z: 3 },
  ];
  const shown = memories.slice(0, spots.length);
  return (
    <>
      {shown.map((m, i) => {
        const s = spots[i]!;
        return (
          <button
            key={m.id}
            className="atlas-scrap"
            onClick={() => onSelect(m)}
            style={{ top: s.top, left: s.left, transform: `rotate(${s.rot}deg)`, zIndex: s.z, padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
            aria-label={`${m.title}, ${m.whenDate} ${m.whenTime}`}
          >
            <div className="ph" style={{ background: m.gradient }} />
            <div className="cap"><b>{m.title}</b><span>{m.whenDate} · {m.whenTime}</span></div>
          </button>
        );
      })}
    </>
  );
}
