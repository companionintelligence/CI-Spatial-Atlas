import { PinIcon, ClockIcon, CameraIcon, SunIcon, MoonIcon, PlaneIcon, PlusIcon } from './icons.js';
import { mediaThumb, type AtlasMemory, type AtlasPlaceSummary } from '../model/atlasModel.js';

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** "2 years 4 months" — how long this place has been part of the person's life. */
function spanLabel(firstMs: number, lastMs: number): string {
  const days = Math.max(0, Math.round((lastMs - firstMs) / 86_400_000));
  if (days < 1) return 'same day';
  if (days < 31) return `over ${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `over ${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return `over ${years} year${years === 1 ? '' : 's'}${rem ? ` ${rem} mo` : ''}`;
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

const TOD_LABEL: Record<AtlasMemory['tod'], string> = { dawn: 'Dawn', day: 'Daylight', dusk: 'Dusk', night: 'Night' };

export function MemoryInspector({ memory, related, place, onFly, onExpand, collected, onCollect }: {
  memory: AtlasMemory | null;
  related: AtlasMemory[];
  /** Everything else that happened at this memory's place, for the visit history. */
  place?: AtlasPlaceSummary | null;
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
      {/* A hero only when there is a real image. This used to paint
          `memory.gradient` — an invented colour wash — into a photo frame for
          every memory, and a personal archive's located events are almost all
          calendar entries, rides and orders with no media at all. A frame full
          of fake photos is what made the app read as a mockup; when there is
          nothing to show, the panel leads with the place instead. */}
      {hero ? (
        <button className="atlas-insp-hero" onClick={onExpand} aria-label="Open full media">
          <img className="hero-media" src={hero} alt="" />
          <div className="tint" />
          <div className="now">{night ? <MoonIcon /> : <SunIcon />}{TOD_LABEL[memory.tod]} · sky set to {memory.whenTime}</div>
          <span className="expand-hint">⤢</span>
        </button>
      ) : (
        <div className="atlas-insp-plainhead">
          <div className="now">{night ? <MoonIcon /> : <SunIcon />}{TOD_LABEL[memory.tod]} · {memory.whenTime}</div>
        </div>
      )}
      <div className="atlas-insp-body">
        <div className="atlas-insp-title">{memory.title}</div>
        {memory.narrative && <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--atlas-fg-dim)' }}>{memory.narrative}</p>}
        <div className="atlas-meta-row"><PinIcon />{memory.place ?? 'Unknown place'} <span className="m">{coord}</span></div>
        <div className="atlas-meta-row"><ClockIcon />{memory.whenDate} <span className="m">{memory.whenTime}</span></div>
        {memory.durationMinutes != null && memory.durationMinutes > 0 && (
          <div className="atlas-meta-row"><ClockIcon />Lasted <span className="m">{formatDuration(memory.durationMinutes)}</span></div>
        )}
        <div className="atlas-meta-row"><CameraIcon />{mediaLabel}{memory.category ? <span className="m">{memory.category}</span> : null}</div>
        <div className="atlas-tags">
          {tags.map((t) => <span className="atlas-tag" key={t}>{t}</span>)}
        </div>
        {place && place.visits > 1 && (
          <>
            <div className="atlas-divider" />
            <div className="atlas-insp-label">Your history here</div>
            <div className="atlas-visits">
              <div className="v-count"><b>{place.visits}</b><span>visit{place.visits === 1 ? '' : 's'}</span></div>
              <div className="v-span">
                {fmtDate(place.firstMs)} → {fmtDate(place.lastMs)}
                <small>{spanLabel(place.firstMs, place.lastMs)}</small>
              </div>
            </div>
            <div className="atlas-visit-list">
              {place.memories
                .filter((m) => m.id !== memory.id)
                .sort((a, b) => b.timeMs - a.timeMs)
                .slice(0, 5)
                .map((m) => (
                  <button key={m.id} className="visit-row" onClick={() => onFly(m)} title={m.title}>
                    <span className="vr-date">{fmtDate(m.timeMs)}</span>
                    <span className="vr-title">{m.title}</span>
                  </button>
                ))}
            </div>
          </>
        )}
        {related.length > 0 && (
          <>
            <div className="atlas-divider" />
            <div className="atlas-insp-label">Around this time</div>
            <div className="atlas-related">
              {related.slice(0, 4).map((m) => {
                const t = mediaThumb(m);
                return (
                  <button key={m.id} className="atlas-rel" onClick={() => onFly(m)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} aria-label={m.title}>
                    {t
                      ? <img className="ph" src={t} alt="" loading="lazy" />
                      : <span className="ph ph-text">{m.title.slice(0, 18)}</span>}
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
