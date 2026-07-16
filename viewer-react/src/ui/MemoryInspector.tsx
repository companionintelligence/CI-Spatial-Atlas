import { PinIcon, ClockIcon, CameraIcon, SunIcon, MoonIcon, PlaneIcon, PlusIcon } from './icons.js';
import type { AtlasMemory } from '../model/atlasModel.js';

const TOD_LABEL: Record<AtlasMemory['tod'], string> = { dawn: 'Dawn', day: 'Daylight', dusk: 'Dusk', night: 'Night' };

export function MemoryInspector({ memory, related, onFly }: { memory: AtlasMemory | null; related: AtlasMemory[]; onFly: (m: AtlasMemory) => void }) {
  if (!memory) return null;
  const coord = memory.lat != null && memory.lon != null
    ? `${Math.abs(memory.lat).toFixed(2)}°${memory.lat >= 0 ? 'N' : 'S'} ${Math.abs(memory.lon).toFixed(2)}°${memory.lon >= 0 ? 'E' : 'W'}`
    : '—';
  const night = memory.tod === 'night';
  return (
    <aside className="atlas-inspector" aria-label="Memory detail">
      <div className="atlas-insp-hero">
        <div style={{ position: 'absolute', inset: 0, background: memory.gradient }} />
        <div className="tint" />
        <div className="now">{night ? <MoonIcon /> : <SunIcon />}{TOD_LABEL[memory.tod]} · sky set to {memory.whenTime}</div>
      </div>
      <div className="atlas-insp-body">
        <div className="atlas-insp-title">{memory.title}</div>
        {memory.narrative && <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--atlas-fg-dim)' }}>{memory.narrative}</p>}
        <div className="atlas-meta-row"><PinIcon />{memory.place ?? 'Unknown place'} <span className="m">{coord}</span></div>
        <div className="atlas-meta-row"><ClockIcon />{memory.whenDate} <span className="m">{memory.whenTime}</span></div>
        <div className="atlas-meta-row"><CameraIcon />Companion Memory <span className="m">4D story</span></div>
        <div className="atlas-tags">
          {['this journey', memory.tod, 'located'].map((t) => <span className="atlas-tag" key={t}>{t}</span>)}
        </div>
        {related.length > 0 && (
          <>
            <div className="atlas-divider" />
            <div className="atlas-insp-label">In this journey</div>
            <div className="atlas-related">
              {related.slice(0, 4).map((m) => (
                <button key={m.id} className="atlas-rel" onClick={() => onFly(m)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} aria-label={m.title}>
                  <div className="ph" style={{ background: m.gradient }} /><small>{m.whenTime}</small>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="atlas-insp-actions">
          <button className="atlas-btn primary" onClick={() => onFly(memory)}><PlaneIcon />Fly here</button>
          <button className="atlas-btn"><PlusIcon />Collect</button>
        </div>
      </div>
    </aside>
  );
}
