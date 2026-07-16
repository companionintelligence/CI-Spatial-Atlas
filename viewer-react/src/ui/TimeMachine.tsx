import { useEffect, useRef } from 'react';
import { PlayIcon, PauseIcon, PrevIcon, NextIcon, SunIcon, MoonIcon } from './icons.js';
import { solarLocal, type AtlasModel, type AtlasMemory } from '../model/atlasModel.js';

const DAY = 86_400_000;

export function TimeMachine({
  model, currentMs, playing, onTogglePlay, onScrub, onStep,
}: {
  model: AtlasModel;
  currentMs: number;
  playing: boolean;
  onTogglePlay: () => void;
  onScrub: (ms: number) => void;
  onStep: (dir: -1 | 1) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const { startMs, stopMs, ticks } = model.timeline;
  const rawSpan = stopMs - startMs;
  const span = Number.isFinite(rawSpan) ? Math.max(1, rawSpan) : 1;
  const frac = Math.min(1, Math.max(0, (currentMs - startMs) / span));

  // Static memory-density histogram (gaussian bumps around each memory time).
  // Keyed on the model/bounds only — NOT on `frac` — so it isn't torn down and
  // re-rasterized on every clock tick; the moving playhead is a separate DOM
  // element (.tm-playhead) layered over this canvas.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const times = model.memories.map((m) => (m.timeMs - startMs) / span).filter((v) => v >= 0 && v <= 1);
    const draw = () => {
      const r = c.getBoundingClientRect();
      const dpr = devicePixelRatio || 1;
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      const x = c.getContext('2d');
      if (!x) return;
      x.scale(dpr, dpr);
      const W = r.width, H = r.height, n = 90, sigma = 0.045;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        let v = 0;
        for (const tm of times) v += Math.exp(-Math.pow((t - tm) / sigma, 2));
        v = Math.min(1, v * 0.9 + 0.06);
        const bh = Math.max(2, v * H);
        const g = x.createLinearGradient(0, H, 0, H - bh);
        g.addColorStop(0, 'rgba(64,155,155,.10)');
        g.addColorStop(1, 'rgba(64,155,155,.5)');
        x.fillStyle = g;
        x.fillRect(t * W, H - bh, W / n - 1.5, bh);
      }
    };
    draw();
    addEventListener('resize', draw);
    return () => removeEventListener('resize', draw);
  }, [model, startMs, span]);

  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = r.width > 0 ? (e.clientX - r.left) / r.width : 0;
    onScrub(startMs + span * Math.min(1, Math.max(0, ratio)));
  };

  // Keyboard scrubbing (WCAG 2.1.1): Arrows step, Page keys jump, Home/End snap.
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const small = Math.max(DAY, span / 100);
    const big = Math.max(DAY * 7, span / 10);
    let ms: number | null = null;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': ms = currentMs - small; break;
      case 'ArrowRight': case 'ArrowUp': ms = currentMs + small; break;
      case 'PageDown': ms = currentMs - big; break;
      case 'PageUp': ms = currentMs + big; break;
      case 'Home': ms = startMs; break;
      case 'End': ms = stopMs; break;
      default: return;
    }
    e.preventDefault();
    onScrub(Math.min(stopMs, Math.max(startMs, ms)));
  };

  const near = nearestMemory(model.memories, currentMs);
  const when = solarLocal(currentMs, near?.lon);
  const finite = Number.isFinite(currentMs);
  const dateStr = finite ? when.whenDate : '—';
  const timeStr = finite ? when.whenTime : '';
  const place = near?.place ? ` over ${near.place}` : '';

  return (
    <div className="atlas-timemachine" role="group" aria-label="Time machine">
      <div className="tm-controls">
        <button className="tm-btn" title="Previous memory" aria-label="Previous memory" onClick={() => onStep(-1)}><PrevIcon /></button>
        <button className="tm-play" title={playing ? 'Pause' : 'Play through time'} aria-label={playing ? 'Pause' : 'Play'} onClick={onTogglePlay}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="tm-btn" title="Next memory" aria-label="Next memory" onClick={() => onStep(1)}><NextIcon /></button>
      </div>
      <div
        className="tm-track"
        onClick={scrub}
        onKeyDown={onKey}
        role="slider"
        aria-label="Scrub time"
        aria-valuemin={startMs}
        aria-valuemax={stopMs}
        aria-valuenow={finite ? currentMs : startMs}
        aria-valuetext={finite ? `${dateStr}, ${timeStr} · ${when.tod}${place}` : undefined}
        tabIndex={0}
      >
        <canvas ref={canvas} className="tm-histogram" aria-hidden="true" />
        <div className="tm-playhead" style={{ left: `${frac * 100}%` }} />
        <div className="tm-axis">{ticks.map((t, i) => <span key={i} className={t.hot ? 'hot' : ''}>{t.label}</span>)}</div>
      </div>
      <div className="tm-readout">
        <div className="date">{dateStr}</div>
        <div className="sub">{when.tod === 'night' ? <MoonIcon /> : <SunIcon />}{timeStr} · {when.tod}{place}</div>
      </div>
    </div>
  );
}

function nearestMemory(memories: AtlasMemory[], ms: number): AtlasMemory | null {
  let best: AtlasMemory | null = null, bd = Infinity;
  for (const m of memories) {
    const dd = Math.abs(m.timeMs - ms);
    if (dd < bd) { bd = dd; best = m; }
  }
  return best;
}
