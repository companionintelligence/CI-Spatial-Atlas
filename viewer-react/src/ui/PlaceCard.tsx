import { useEffect } from 'react';
import { FlagIcon, ClockIcon, PlaneIcon } from './icons.js';
import type { Place } from '@companion-atlas/story';

const KIND_LABEL: Record<string, string> = {
  room: 'Room', building: 'Building', venue: 'Venue', address: 'Address',
  neighborhood: 'Neighborhood', city: 'City', region: 'Region', country: 'Country',
  continent: 'Continent', planet: 'Planet', other: 'Place',
};

function formatVisit(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Detail card for a named CI-Server Place — deliberately lighter than
 * `MemoryInspector`: no hero image, no scrapbook actions (a Place is the
 * *context* memories happen in, not itself a collectible memory). Docks in
 * the same slot as `MemoryInspector`, shown instead of it while a place is
 * focused (see `AtlasApp`).
 */
export function PlaceCard({ place, onFly, onClose }: {
  place: Place;
  onFly: (p: Place) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const coord = place.latitude != null && place.longitude != null
    ? `${Math.abs(place.latitude).toFixed(2)}°${place.latitude >= 0 ? 'N' : 'S'} ${Math.abs(place.longitude).toFixed(2)}°${place.longitude >= 0 ? 'E' : 'W'}`
    : '—';
  const lastVisit = formatVisit(place.visitStats.lastVisitAt);

  return (
    <aside className="atlas-inspector" aria-label="Place detail">
      <div className="atlas-insp-body">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div className="atlas-insp-title">{place.name ?? 'Unnamed place'}</div>
          <button className="atlas-icon-btn" title="Close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {place.description && (
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--atlas-fg-dim)' }}>{place.description}</p>
        )}
        <div className="atlas-meta-row"><FlagIcon />{KIND_LABEL[place.placeKind ?? 'other'] ?? 'Place'} <span className="m">{coord}</span></div>
        <div className="atlas-meta-row">
          <ClockIcon />
          {place.visitStats.visitCount > 0
            ? `${place.visitStats.visitCount} visit${place.visitStats.visitCount === 1 ? '' : 's'}`
            : 'No visits recorded'}
          {lastVisit && <span className="m">last {lastVisit}</span>}
        </div>
        <div className="atlas-insp-actions">
          <button className="atlas-btn primary" onClick={() => onFly(place)} disabled={place.latitude == null}>
            <PlaneIcon />Fly here
          </button>
        </div>
      </div>
    </aside>
  );
}
