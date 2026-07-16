import { mediaThumb, type AtlasMemory } from '../model/atlasModel.js';
import type { AtlasView } from './Shell.js';

/** Non-globe renderers of the same memory set — Gallery / Timeline / Graph.
 *  Each is a full-stage overlay (the globe stays mounted underneath so the
 *  Cesium clock keeps running). */
export function AltView({ view, memories, focusedId, onSelect }: {
  view: AtlasView;
  memories: AtlasMemory[];
  focusedId: string | null;
  onSelect: (m: AtlasMemory) => void;
}) {
  if (memories.length === 0) {
    return <div className="atlas-altview atlas-emptyview"><p>No located memories in this story yet.</p></div>;
  }
  if (view === 'gallery') return <Gallery memories={memories} focusedId={focusedId} onSelect={onSelect} />;
  if (view === 'timeline') return <Timeline memories={memories} focusedId={focusedId} onSelect={onSelect} />;
  return <Graph memories={memories} focusedId={focusedId} onSelect={onSelect} />;
}

function Thumb({ m }: { m: AtlasMemory }) {
  const url = mediaThumb(m);
  return url
    ? <img className="av-thumb" src={url} alt="" loading="lazy" />
    : <div className="av-thumb" style={{ background: m.gradient }} aria-hidden="true" />;
}

function Gallery({ memories, focusedId, onSelect }: { memories: AtlasMemory[]; focusedId: string | null; onSelect: (m: AtlasMemory) => void }) {
  return (
    <div className="atlas-altview atlas-gallery">
      {memories.map((m) => (
        <button key={m.id} className={`av-card${m.id === focusedId ? ' active' : ''}`} onClick={() => onSelect(m)} aria-label={`${m.title}, ${m.whenDate}`}>
          <Thumb m={m} />
          <div className="av-cap">
            <b>{m.title}</b>
            <span>{m.whenDate} · {m.whenTime}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function Timeline({ memories, focusedId, onSelect }: { memories: AtlasMemory[]; focusedId: string | null; onSelect: (m: AtlasMemory) => void }) {
  const sorted = [...memories].sort((a, b) => a.timeMs - b.timeMs);
  return (
    <div className="atlas-altview atlas-timeline-view">
      <ol className="tl-list">
        {sorted.map((m) => (
          <li key={m.id} className={`tl-row${m.id === focusedId ? ' active' : ''}`}>
            <div className="tl-when">{m.whenDate}<span>{m.whenTime}</span></div>
            <div className="tl-dot" aria-hidden="true" />
            <button className="tl-card" onClick={() => onSelect(m)}>
              <Thumb m={m} />
              <div className="tl-body">
                <b>{m.title}</b>
                {m.narrative && <p>{m.narrative}</p>}
                {m.place && <span className="tl-place">{m.place}</span>}
              </div>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Graph({ memories, focusedId, onSelect }: { memories: AtlasMemory[]; focusedId: string | null; onSelect: (m: AtlasMemory) => void }) {
  const sorted = [...memories].sort((a, b) => a.timeMs - b.timeMs);
  const W = 900;
  const H = 560;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) * 0.34;
  // Deterministic radial layout in chronological order (journey wraps the ring).
  const nodes = sorted.map((m, i) => {
    const a = (i / Math.max(1, sorted.length)) * Math.PI * 2 - Math.PI / 2;
    return { m, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  return (
    <div className="atlas-altview atlas-graph-view">
      <svg viewBox={`0 0 ${W} ${H}`} className="graph-svg" role="group" aria-label="Memory graph">
        {/* journey edges (chronological) */}
        {nodes.map((n, i) => {
          const nxt = nodes[i + 1];
          if (!nxt) return null;
          return <line key={`e${i}`} x1={n.x} y1={n.y} x2={nxt.x} y2={nxt.y} className="graph-edge" />;
        })}
        {/* spokes to the center "you" node */}
        {nodes.map((n, i) => <line key={`s${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y} className="graph-spoke" />)}
        <circle cx={cx} cy={cy} r={26} className="graph-hub" />
        <text x={cx} y={cy + 4} className="graph-hub-label" textAnchor="middle">You</text>
        {nodes.map(({ m, x, y }) => (
          <g key={m.id} className={`graph-node${m.id === focusedId ? ' active' : ''}`} onClick={() => onSelect(m)} role="button" tabIndex={0}
             aria-label={m.title}
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(m); } }}>
            <title>{m.title}</title>
            <circle cx={x} cy={y} r={m.id === focusedId ? 13 : 9} />
            <text x={x} y={y - 16} textAnchor="middle">{m.title}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
