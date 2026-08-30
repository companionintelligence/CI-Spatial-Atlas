import { useEffect, useRef } from 'react';
import { BASEMAPS } from '../renderers/basemaps.js';
import { BuildingIcon, LayersIcon, SunIcon } from './icons.js';

/**
 * Basemap picker + sun toggle.
 *
 * Kept as one popover rather than two rail buttons because they answer the same
 * question — what the ground looks like right now — and a globe with four
 * basemaps and a day/night switch needs somewhere to put them that is not more
 * permanent chrome over the map.
 */
export function MapLayers({ open, basemap, sunLighting, buildings, buildingsAvailable, onBasemap, onToggleSun, onToggleBuildings, onToggle, onClose }: {
  open: boolean;
  basemap: string;
  sunLighting: boolean;
  buildings: boolean;
  /** False when no Google key is configured — the control explains itself. */
  buildingsAvailable: boolean;
  onBasemap: (id: string) => void;
  onToggleSun: () => void;
  onToggleBuildings: () => void;
  onToggle: () => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // `pointerdown` on the document also fires for the Cesium canvas, so a click
    // on the globe dismisses the panel the same way clicking off any menu does.
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, onClose]);

  return (
    <div className="atlas-layers" ref={popRef}>
      <button
        className="atlas-icon-btn"
        aria-label="Map layers"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Map layers"
        onClick={onToggle}
      >
        <LayersIcon />
      </button>

      {open && (
        <div className="atlas-layers-pop" role="dialog" aria-label="Map layers">
          <div className="lay-head">Basemap</div>
          <div className="lay-grid">
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                className={`lay-opt${b.id === basemap ? ' active' : ''}`}
                aria-pressed={b.id === basemap}
                onClick={() => onBasemap(b.id)}
              >
                <span className={`lay-swatch lay-${b.id}`} aria-hidden="true" />
                <span className="lay-label">{b.label}</span>
                <span className="lay-hint">{b.hint}</span>
              </button>
            ))}
          </div>

          <div className="lay-head">Terrain</div>
          <button
            className={`lay-row${buildings ? ' active' : ''}`}
            aria-pressed={buildings}
            disabled={!buildingsAvailable}
            onClick={onToggleBuildings}
          >
            <BuildingIcon />
            <span className="lay-label">3D buildings</span>
            <span className="lay-hint">
              {!buildingsAvailable
                ? 'Needs a Google Maps key'
                : buildings
                  ? 'Google Photorealistic 3D Tiles'
                  : 'Real building geometry'}
            </span>
          </button>

          <div className="lay-head">Lighting</div>
          <button
            className={`lay-row${sunLighting ? ' active' : ''}`}
            aria-pressed={sunLighting}
            onClick={onToggleSun}
          >
            <SunIcon />
            <span className="lay-label">Sun &amp; day/night</span>
            <span className="lay-hint">
              {sunLighting ? 'Real terminator — night side is dark' : 'Evenly lit globe'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
