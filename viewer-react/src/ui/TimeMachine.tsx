import { useEffect, useRef } from 'react';
import { PlayIcon, PauseIcon, PrevIcon, NextIcon, SunIcon, MoonIcon } from './icons.js';
import { solarLocal, nearestMemory, type AtlasModel } from '../model/atlasModel.js';

const DAY = 86_400_000;

export function TimeMachine({
  model, currentMs, playing, sunLighting, onTogglePlay, onToggleSun, onScrub, onStep,
}: {
  model: AtlasModel;
  currentMs: number;
  playing: boolean;
  /** Whether the globe is lit by the real sun for the moment being viewed. */
  sunLighting: boolean;
  onTogglePlay: () => void;
  onToggleSun: () => void;
  onScrub: (ms: number) => void;
  onStep: (dir: -1 | 1) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const { startMs, stopMs, ticks } = model.timeline;
  const rawSpan = stopMs - startMs;
  const span = Number.isFinite(rawSpan) ? Math.max(1, rawSpan) : 1;
  const frac = Math.min(1, Math.max(0, (currentMs - startMs) / span));

  // Memory-density histogram, bucketed by calendar month and normalised to the
  // busiest month.
  //
  // The previous version summed a gaussian per memory and then clamped with
  // `Math.min(1, v * 0.9 + 0.06)`. With a real archive (290 memories over 8
  // years) that saturates: almost every column reaches 1.0, so the track drew
  // solid blocks of full-height bars — a barcode that said "there is data" and
  // nothing about when life was busy. Normalising against the peak is what
  // makes the shape mean something, and month buckets match how a person
  // actually remembers a year.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;

    const draw = () => {
      const r = c.getBoundingClientRect();
      if (r.width === 0) return;
      const dpr = devicePixelRatio || 1;
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      const x = c.getContext('2d');
      if (!x) return;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = r.width, H = r.height;
      x.clearRect(0, 0, W, H);

      // One bucket per month across the span, capped so a very long archive
      // still gets bars wide enough to see.
      const months = Math.max(1, Math.round(span / 2.628e9));
      const buckets = Math.min(months, Math.max(12, Math.floor(W / 4)));
      const counts = new Array(buckets).fill(0);
      for (const m of model.memories) {
        const t = (m.timeMs - startMs) / span;
        if (t < 0 || t > 1) continue;
        counts[Math.min(buckets - 1, Math.floor(t * buckets))] += 1;
      }
      const peak = Math.max(...counts, 1);

      const bw = W / buckets;
      for (let i = 0; i < buckets; i++) {
        if (counts[i] === 0) continue;
        // sqrt keeps a single-memory month visible next to a 30-memory one
        // without letting the peak flatten everything else.
        const v = Math.sqrt(counts[i] / peak);
        const bh = Math.max(2, v * (H - 6));
        const g = x.createLinearGradient(0, H, 0, H - bh);
        g.addColorStop(0, 'rgba(64,155,155,.16)');
        g.addColorStop(1, 'rgba(114,221,212,.62)');
        x.fillStyle = g;
        x.fillRect(i * bw, H - bh, Math.max(1, bw - 1), bh);
      }
    };

    draw();
    // Observe the TRACK, not the canvas. Observing the canvas while this
    // callback resizes it is a feedback loop, and the canvas grows without
    // bound (see the note on .tm-histogram in the theme).
    const parent = c.parentElement;
    const ro = new ResizeObserver(draw);
    if (parent) ro.observe(parent);
    return () => ro.disconnect();
  }, [model, startMs, span]);

  /**
   * Dragging the track, not just clicking it.
   *
   * A click-only scrubber is usable with a mouse and close to useless with a
   * thumb: on a phone the track is the whole control, and tapping a single
   * point of a seven-year archive to within a month asks for pixel accuracy
   * nobody has. Pointer events cover mouse, pen and touch in one path, and the
   * capture is what keeps the drag alive once the finger leaves the 76px-tall
   * strip — which, on a phone, is almost immediately.
   */
  const dragging = useRef(false);

  const scrubTo = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const ratio = r.width > 0 ? (clientX - r.left) / r.width : 0;
    onScrub(startMs + span * Math.min(1, Math.max(0, ratio)));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Taking hold of the scrubber stops playback, the way it does in every
    // video player. Without it the clock keeps running under the finger — and
    // at this multiplier (a whole archive in ~60 s) it runs *fast*, so the
    // playhead fights the drag and lands somewhere neither party chose.
    if (playing) onTogglePlay();
    dragging.current = true;
    // Scrub first, capture second. The other order loses a *tap* entirely:
    // `setPointerCapture` throws for a pointer the element cannot capture, and
    // with the scrub behind it the throw takes the one thing the gesture was
    // for. Dragging still worked, which is what made it hard to see — the
    // move handler picked up from the flag that had already been set.
    scrubTo(e.clientX, e.currentTarget);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // No capture: the drag still tracks while the finger is over the track,
      // which is strictly worse than capturing but far better than nothing.
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    scrubTo(e.clientX, e.currentTarget);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Already gone — the browser releases capture on its own at pointerup.
    }
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
  // Real place names are full postal addresses ("Adler Theater for the Arts,
  // 1305 Allenford Ave, Los Angeles, CA, US, 90049"). Keep the leading name for
  // the readout — the inspector shows the full string.
  const shortPlace = near?.place ? near.place.split(',')[0]!.trim().slice(0, 38) : '';
  const place = shortPlace ? ` over ${shortPlace}` : '';

  return (
    <div className="atlas-timemachine" role="group" aria-label="Time machine">
      <div className="tm-controls">
        <button className="tm-btn" title="Previous memory" aria-label="Previous memory" onClick={() => onStep(-1)}><PrevIcon /></button>
        <button className="tm-play" title={playing ? 'Pause' : 'Play through time'} aria-label={playing ? 'Pause' : 'Play'} onClick={onTogglePlay}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="tm-btn" title="Next memory" aria-label="Next memory" onClick={() => onStep(1)}><NextIcon /></button>
        {/* The sun lives in the time bar, not in the layers menu.
            Cesium already swings the terminator with `clock.currentTime`, so
            scrubbing has always moved the sun — but with the lighting off by
            default and its switch two clicks deep in a popover, nothing on
            screen ever showed it. The readout would say "10:06 PM · night"
            over a globe in full daylight: two claims about the same moment,
            contradicting each other. Putting the switch here, wearing the
            glyph that already tracks the moment, is the connection. */}
        <button
          className={`tm-btn tm-sun${sunLighting ? ' active' : ''}`}
          title={sunLighting ? 'Turn off day/night lighting' : 'Light the globe for this moment'}
          aria-label="Day and night lighting"
          aria-pressed={sunLighting}
          onClick={onToggleSun}
        >
          {when.tod === 'night' ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
      <div
        className="tm-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
        {/* `hot` marks the tick the playhead is currently nearest, so the
            highlight follows playback instead of sitting on a fixed index. */}
        <div className="tm-axis">{ticks.map((t, i) => {
          const nearest = ticks.reduce(
            (best, cand, idx) => (Math.abs(cand.ms - currentMs) < Math.abs(ticks[best].ms - currentMs) ? idx : best),
            0,
          );
          return <span key={i} className={i === nearest ? 'hot' : ''}>{t.label}</span>;
        })}</div>
      </div>
      <div className="tm-readout">
        <div className="date">{dateStr}</div>
        <div className="sub">{when.tod === 'night' ? <MoonIcon /> : <SunIcon />}{timeStr} · {when.tod}{place}</div>
      </div>
    </div>
  );
}
