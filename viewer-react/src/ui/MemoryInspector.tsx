import { PinIcon, ClockIcon, CameraIcon, SunIcon, MoonIcon, PlaneIcon, PlusIcon } from './icons.js';
import { mediaThumb, type AtlasMemory } from '../model/atlasModel.js';

const TOD_LABEL: Record<AtlasMemory['tod'], string> = { dawn: 'Dawn', day: 'Daylight', dusk: 'Dusk', night: 'Night' };

export function MemoryInspector({ memory, related, onFly, onExpand, collected, onCollect }: {
  memory: AtlasMemory | null;
  related: AtlasMemory[];
  onFly: (m: AtlasMemory) => void;
  onExpand: () => void;
  /** Whether this memory is already in the scrapbook draft. */
  collected: boolean;
  onCollect: () => void;
}) {
  if (!memory) return null;
  const coord = memory.lat != null && memory.lon != null
    ? `${Math.abs(memory.lat).toFixed(2)}°${memory.lat >= 0 ? 'N' : 'S'} ${Math.abs(memory.lon).toFixed(2)}°${memory.lon >= 0 ? 'E' : 'W'}`
    : '—';
  const night = memory.tod === 'night';
  const hero = mediaThumb(memory);
  const tags = memory.tags?.length ? memory.tags : ['this journey', memory.tod, 'located'];
  const mediaLabel = memory.media?.kind === 'video' ? 'Video' : memory.media ? 'Photo' : 'Companion Memory';
  return (
    <aside className="atlas-inspector" aria-label="Memory detail">
      <button className="atlas-insp-hero" onClick={onExpand} aria-label="Open full media">
        {hero
          ? <img className="hero-media" src={hero} alt="" />
          : <div className="hero-media" style={{ background: memory.gradient }} aria-hidden="true" />}
        <div className="tint" />
        <div className="now">{night ? <MoonIcon /> : <SunIcon />}{TOD_LABEL[memory.tod]} · sky set to {memory.whenTime}</div>
        <span className="expand-hint">⤢</span>
      </button>
      <div className="atlas-insp-body">
        <div className="atlas-insp-title">{memory.title}</div>
        {memory.narrative && <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--atlas-fg-dim)' }}>{memory.narrative}</p>}
        <div className="atlas-meta-row"><PinIcon />{memory.place ?? 'Unknown place'} <span className="m">{coord}</span></div>
        <div className="atlas-meta-row"><ClockIcon />{memory.whenDate} <span className="m">{memory.whenTime}</span></div>
        <div className="atlas-meta-row"><CameraIcon />{mediaLabel} <span className="m">4D story</span></div>
        <div className="atlas-tags">
          {tags.map((t) => <span className="atlas-tag" key={t}>{t}</span>)}
        </div>
        {related.length > 0 && (
          <>
            <div className="atlas-divider" />
            <div className="atlas-insp-label">In this journey</div>
            <div className="atlas-related">
              {related.slice(0, 4).map((m) => {
                const t = mediaThumb(m);
                return (
                  <button key={m.id} className="atlas-rel" onClick={() => onFly(m)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} aria-label={m.title}>
                    {t ? <img className="ph" src={t} alt="" loading="lazy" /> : <div className="ph" style={{ background: m.gradient }} />}
                    <small>{m.whenTime}</small>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div className="atlas-insp-actions">
          <button className="atlas-btn primary" onClick={() => onFly(memory)}><PlaneIcon />Fly here</button>
          <button
            className={`atlas-btn${collected ? ' collected' : ''}`}
            onClick={onCollect}
            aria-pressed={collected}
            title={collected ? 'Remove from your scrapbook' : 'Collect into your scrapbook'}
          >
            <PlusIcon />{collected ? 'Collected' : 'Collect'}
          </button>
        </div>
      </div>
    </aside>
  );
}
