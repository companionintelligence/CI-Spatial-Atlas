import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { PinIcon } from './icons.js';
import { mediaThumb, type AtlasModel, type AtlasMemory } from '../model/atlasModel.js';

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

/** Floating scrapbook frames for the memories nearest the playhead (time-driven:
 *  scrubbing/playing repopulates them). Real media when the story carries it. */
/**
 * Scrapbook cards anchored to where their memory actually is on the globe.
 *
 * These used to sit at three hardcoded screen positions, so Reykjavik and
 * Singapore — 10,000km apart — rendered as a tidy cluster mid-screen that
 * ignored the camera entirely. Cards now project their real lat/lon through
 * Cesium and hide when the globe rotates them out of view, so what you see is
 * the data's geography rather than a fixed decorative arrangement.
 */
export function ScrapbookFrames({ memories, hoveredId, onSelect, viewer }: {
  memories: AtlasMemory[];
  hoveredId?: string | null;
  onSelect: (m: AtlasMemory) => void;
  viewer?: Cesium.Viewer | null;
}) {
  const [placed, setPlaced] = useState<{ m: AtlasMemory; x: number; y: number }[]>([]);
  // `memories` is a fresh array on every render, so it must not be an effect
  // dependency: the effect would tear down and re-add its postRender listener
  // each frame, and the setState below would retrigger the render that caused
  // it — a feedback loop that starves Cesium's own render and blanks the globe.
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) { setPlaced([]); return; }
    const scene = viewer.scene;

    const project = () => {
      if (viewer.isDestroyed()) return;
      const located = memoriesRef.current.filter((m) => m.lat != null && m.lon != null);
      const next: { m: AtlasMemory; x: number; y: number }[] = [];
      const camera = scene.camera.positionWC;
      for (const m of located) {
        const carto = Cesium.Cartesian3.fromDegrees(m.lon!, m.lat!);
        // Cull the far side of the globe — without this, cards for places
        // behind the Earth still project to valid screen coords and float over
        // the front face. Horizon test: the outward surface normal at the point
        // must face the camera, i.e. the camera sits in that point's hemisphere.
        const normal = Cesium.Cartesian3.normalize(carto, new Cesium.Cartesian3());
        const toCamera = Cesium.Cartesian3.subtract(camera, carto, new Cesium.Cartesian3());
        if (Cesium.Cartesian3.dot(normal, toCamera) <= 0) continue;
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, carto);
        if (!win) continue;
        next.push({ m, x: win.x, y: win.y });
      }
      // Only commit when something actually moved. Setting state unconditionally
      // every frame re-renders the overlay continuously even with a still camera.
      setPlaced((prev) => {
        if (prev.length === next.length && prev.every((p, i) => {
          const n = next[i]!;
          return p.m.id === n.m.id && Math.abs(p.x - n.x) < 0.5 && Math.abs(p.y - n.y) < 0.5;
        })) return prev;
        return next;
      });
    };

    project();
    const remove = scene.postRender.addEventListener(project);
    return () => { remove(); };
  }, [viewer]);

  if (!viewer) return null;
  return (
    <>
      {placed.map(({ m, x, y }) => {
        const thumb = mediaThumb(m);
        return (
          <button
            key={m.id}
            className={`atlas-scrap${m.id === hoveredId ? ' hover' : ''}`}
            onClick={() => onSelect(m)}
            style={{
              // Anchor the card's bottom point at the projected ground position.
              left: x,
              top: y,
              transform: 'translate(-50%, -100%)',
              zIndex: m.id === hoveredId ? 5 : 3,
              padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit',
            }}
            aria-label={`${m.title}, ${m.whenDate} ${m.whenTime}`}
          >
            {thumb
              ? <img className="ph" src={thumb} alt="" loading="lazy" />
              : <div className="ph" style={{ background: m.gradient }} aria-hidden="true" />}
            <div className="cap"><b>{m.title}</b><span>{m.whenDate} · {m.whenTime}</span></div>
          </button>
        );
      })}
    </>
  );
}
