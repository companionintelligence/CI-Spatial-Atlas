import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { useStory } from './story/useStory.js';
import { CesiumStoryViewer } from './renderers/CesiumStoryViewer.js';
import { deriveModel, memoriesAround, nearestMemory, type AtlasMemory } from './model/atlasModel.js';
import { Rail, TopBar, type AtlasView } from './ui/Shell.js';
import { Starfield, GridHorizon } from './ui/Backdrop.js';
import { StatsRibbon, Legend, PlaceChip, ScrapbookFrames } from './ui/Overlays.js';
import { MemoryInspector } from './ui/MemoryInspector.js';
import { TimeMachine } from './ui/TimeMachine.js';
import { AltView } from './ui/AltViews.js';
import { CommandPalette } from './ui/CommandPalette.js';
import { Lightbox } from './ui/Lightbox.js';

/** The last memory whose time is at or before `ms` (the segment being played). */
function lastPassed(memories: AtlasMemory[], ms: number): AtlasMemory | null {
  const sorted = [...memories].sort((a, b) => a.timeMs - b.timeMs);
  let r: AtlasMemory | null = sorted[0] ?? null;
  for (const m of sorted) {
    if (m.timeMs <= ms) r = m; else break;
  }
  return r;
}

/**
 * Companion Atlas — the redesigned shell. A CI-branded frame (rail + top bar)
 * around the Cesium memory globe, with a right memory inspector and the bottom
 * Time Machine scrubber wired to the Cesium `Clock`. See docs/REDESIGN.md.
 */
export function AtlasApp() {
  const { story, error, loading, source } = useStory();
  const model = useMemo(() => (story ? deriveModel(story) : null), [story]);

  // Reduced-motion gates the app's dominant motion (time autoplay + camera
  // flights), not just the starfield.
  const reduceMotion = useMemo(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const [view, setView] = useState<AtlasView>('globe');
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(!reduceMotion);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<AtlasMemory | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const lastSync = useRef(0);
  const flownToRef = useRef<string | null>(null);
  const introDone = useRef(false);

  const focused: AtlasMemory | null = useMemo(() => {
    if (!model) return null;
    return model.memories.find((m) => m.id === focusedId) ?? model.focused;
  }, [model, focusedId]);

  const related = useMemo(
    () => (model ? model.memories.filter((m) => m.id !== focused?.id) : []),
    [model, focused],
  );

  // Overlays that follow the clock: the scrapbook shows the memories nearest the
  // playhead and the place chip names the current place, so scrubbing/playing
  // repopulates them.
  const scrapbook = useMemo(
    () => (model ? memoriesAround(model.memories, currentMs, 3) : []),
    [model, currentMs],
  );
  const currentPlace = useMemo(
    () => (model ? nearestMemory(model.memories, currentMs) : null),
    [model, currentMs],
  );

  // Sync React state from the Cesium clock (throttled) so the Time Machine + the
  // "sky follows the moment" readout track playback.
  useEffect(() => {
    if (!viewer) return;
    const clock = viewer.clock;
    // Play the journey once and stop at the end — don't loop back and re-fly the
    // camera to the first memory forever.
    clock.clockRange = Cesium.ClockRange.CLAMPED;
    if (reduceMotion) clock.shouldAnimate = false;
    setCurrentMs(Cesium.JulianDate.toDate(clock.currentTime).getTime());
    setPlaying(clock.shouldAnimate);
    const onTick = () => {
      // At the end, actually stop — CLAMPED holds currentTime at stopTime but
      // leaves shouldAnimate true, which makes the scrubber snap back to the end.
      if (clock.shouldAnimate && Cesium.JulianDate.greaterThanOrEquals(clock.currentTime, clock.stopTime)) {
        clock.shouldAnimate = false;
      }
      const now = performance.now();
      if (now - lastSync.current < 240) return;
      lastSync.current = now;
      setCurrentMs(Cesium.JulianDate.toDate(clock.currentTime).getTime());
      setPlaying(clock.shouldAnimate);
    };
    clock.onTick.addEventListener(onTick);
    return () => {
      clock.onTick.removeEventListener(onTick);
    };
  }, [viewer, reduceMotion]);

  const flyTo = useCallback((m: AtlasMemory) => {
    if (!viewer || m.lat == null || m.lon == null) return;
    void viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 1_800_000),
      duration: reduceMotion ? 0 : 1.6,
    });
  }, [viewer, reduceMotion]);

  const scrub = useCallback((ms: number) => {
    if (!Number.isFinite(ms)) return;
    setCurrentMs(ms);
    if (viewer) viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(ms));
  }, [viewer]);

  // Selecting a memory jumps the clock to its instant (so the terminator follows
  // the moment) and flies the camera. `flownToRef` keeps the playback fly-through
  // from immediately re-flying the same memory.
  const select = useCallback((m: AtlasMemory) => {
    setFocusedId(m.id);
    flownToRef.current = m.id;
    scrub(m.timeMs);
    flyTo(m);
  }, [flyTo, scrub]);

  const pause = useCallback(() => {
    if (viewer) viewer.clock.shouldAnimate = false;
    setPlaying(false);
  }, [viewer]);

  // A user-initiated jump: select + pause, so the camera settles on the memory
  // instead of the playback fly-through carrying on.
  const inspect = useCallback((m: AtlasMemory) => { select(m); pause(); }, [select, pause]);

  // "Fit all places": frame the camera on every located memory at once.
  const frameAll = useCallback(() => {
    setView('globe');
    if (!viewer || !model) return;
    const positions = model.memories
      .filter((m) => m.lat != null && m.lon != null)
      .map((m) => Cesium.Cartesian3.fromDegrees(m.lon!, m.lat!));
    if (positions.length === 0) return;
    pause();
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    void viewer.camera.flyToBoundingSphere(sphere, {
      duration: reduceMotion ? 0 : 1.6,
      offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, Math.max(2_000_000, sphere.radius * 3)),
    });
  }, [viewer, model, reduceMotion, pause]);

  const togglePlay = useCallback(() => {
    if (!viewer) { setPlaying((p) => !p); return; }
    const clock = viewer.clock;
    // Pressing play at the end replays from the start.
    if (!clock.shouldAnimate && Cesium.JulianDate.greaterThanOrEquals(clock.currentTime, clock.stopTime)) {
      clock.currentTime = Cesium.JulianDate.clone(clock.startTime);
      flownToRef.current = null;
      setCurrentMs(Cesium.JulianDate.toDate(clock.startTime).getTime());
    }
    clock.shouldAnimate = !clock.shouldAnimate;
    setPlaying(clock.shouldAnimate);
  }, [viewer]);

  // Prev/Next move to the memory bracketing the playhead: Next → first memory
  // strictly after now, Prev → last strictly before it (so neither skips one
  // while the clock sits between memories during playback).
  const step = useCallback((dir: -1 | 1) => {
    if (!model || model.memories.length === 0) return;
    const sorted = [...model.memories].sort((a, b) => a.timeMs - b.timeMs);
    const next = dir === 1
      ? sorted.find((m) => m.timeMs > currentMs) ?? sorted[sorted.length - 1]
      : [...sorted].reverse().find((m) => m.timeMs < currentMs) ?? sorted[0];
    if (next) inspect(next);
  }, [model, currentMs, inspect]);

  // The scrubber flies the camera *along the route*: while playing, as the clock
  // crosses each memory, fly to it and focus it (the inspector follows too).
  useEffect(() => {
    if (!viewer || !model || !playing || !introDone.current) return;
    const passed = lastPassed(model.memories, currentMs);
    if (passed && passed.id !== flownToRef.current) {
      flownToRef.current = passed.id;
      setFocusedId(passed.id);
      flyTo(passed);
    }
  }, [currentMs, playing, viewer, model, flyTo]);

  // Open *on the memories*: once the viewer + model are both ready, frame the
  // first memory and set the clock to its moment (so its region is lit, not the
  // default empty night hemisphere), then let playback carry the journey. Once.
  useEffect(() => {
    if (!viewer || !model || introDone.current) return;
    const first = model.memories[0];
    if (first) { introDone.current = true; select(first); }
  }, [viewer, model, select]);

  // ⌘K / Ctrl-K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const share = useCallback(() => {
    try { void navigator.clipboard?.writeText(window.location.href); } catch { /* ignore */ }
  }, []);

  // Stable close handlers so overlay effects (e.g. Lightbox's Escape listener)
  // don't re-subscribe on every ~240ms clock-driven re-render.
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  if (loading) return <div className="atlas-boot"><div className="msg">Loading Companion Atlas…</div></div>;
  if (error || !model || !story) {
    return <div className="atlas-boot"><div className="msg"><strong>Couldn’t load a story.</strong><span>{error ?? 'Append ?story=<url> to view one.'}</span></div></div>;
  }

  const isGlobe = view === 'globe';

  return (
    <div className="atlas-app">
      <Starfield />
      <div className="atlas-aurora" aria-hidden="true" />
      <Rail view={view} onView={setView} onSearch={() => setPaletteOpen(true)} onFrameAll={frameAll} />
      <TopBar view={view} onView={setView} onSearch={() => setPaletteOpen(true)} onShare={share} live={source === 'memory'} />
      <main className="atlas-stage">
        <CesiumStoryViewer
          story={story}
          memories={model.memories}
          focusedId={focused?.id ?? null}
          onViewer={setViewer}
          onPick={inspect}
          onHover={setHoveredId}
          onInteract={pause}
        />
        {isGlobe && <GridHorizon />}
        {isGlobe && (
          <div className="atlas-overlay">
            <StatsRibbon stats={model.stats} />
            <PlaceChip memory={currentPlace} />
            <ScrapbookFrames memories={scrapbook} hoveredId={hoveredId} onSelect={inspect} />
            <Legend />
          </div>
        )}
        {!isGlobe && (
          <AltView view={view} memories={model.memories} focusedId={focused?.id ?? null} onSelect={inspect} />
        )}
      </main>
      {isGlobe && <MemoryInspector memory={focused} related={related} onFly={inspect} onExpand={() => focused && setLightbox(focused)} />}
      <TimeMachine
        model={model}
        currentMs={currentMs || model.timeline.startMs}
        playing={playing}
        onTogglePlay={togglePlay}
        onScrub={scrub}
        onStep={step}
      />
      <CommandPalette
        open={paletteOpen}
        memories={model.memories}
        onClose={closePalette}
        onSelect={(m) => { inspect(m); closePalette(); }}
        onView={(v) => { setView(v); closePalette(); }}
      />
      <Lightbox memory={lightbox} onClose={closeLightbox} />
    </div>
  );
}
