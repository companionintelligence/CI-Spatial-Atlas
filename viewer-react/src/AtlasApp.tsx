import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { useStory } from './story/useStory.js';
import { CesiumStoryViewer } from './renderers/CesiumStoryViewer.js';
import { deriveModel, type AtlasMemory } from './model/atlasModel.js';
import { Rail, TopBar, type AtlasView } from './ui/Shell.js';
import { Starfield, GridHorizon } from './ui/Backdrop.js';
import { StatsRibbon, Legend, PlaceChip, ScrapbookFrames } from './ui/Overlays.js';
import { MemoryInspector } from './ui/MemoryInspector.js';
import { TimeMachine } from './ui/TimeMachine.js';

/**
 * Companion Atlas — the redesigned shell. A CI-branded frame (rail + top bar)
 * around the Cesium memory globe, with a right memory inspector and the bottom
 * Time Machine scrubber wired to the Cesium `Clock`. See docs/REDESIGN.md.
 */
export function AtlasApp() {
  const { story, error, loading } = useStory();
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
  const lastSync = useRef(0);

  const focused: AtlasMemory | null = useMemo(() => {
    if (!model) return null;
    return model.memories.find((m) => m.id === focusedId) ?? model.focused;
  }, [model, focusedId]);

  const related = useMemo(
    () => (model ? model.memories.filter((m) => m.id !== focused?.id) : []),
    [model, focused],
  );

  // Sync React state from the Cesium clock (throttled) so the Time Machine + the
  // "sky follows the moment" readout track playback.
  useEffect(() => {
    if (!viewer) return;
    const clock = viewer.clock;
    if (reduceMotion) clock.shouldAnimate = false;
    setCurrentMs(Cesium.JulianDate.toDate(clock.currentTime).getTime());
    setPlaying(clock.shouldAnimate);
    const onTick = () => {
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

  // Selecting a memory also jumps the clock to its instant, so the globe's
  // lighting/terminator ("sky follows the moment") tracks the chosen memory.
  const select = useCallback((m: AtlasMemory) => {
    setFocusedId(m.id);
    scrub(m.timeMs);
    flyTo(m);
  }, [flyTo, scrub]);

  const togglePlay = useCallback(() => {
    if (!viewer) { setPlaying((p) => !p); return; }
    viewer.clock.shouldAnimate = !viewer.clock.shouldAnimate;
    setPlaying(viewer.clock.shouldAnimate);
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
    if (next) select(next);
  }, [model, currentMs, select]);

  // Open *on the memories*: once the viewer + model are both ready, frame the
  // first memory and set the clock to its moment (so its region is lit, not the
  // default empty night hemisphere). Runs exactly once.
  const introDone = useRef(false);
  useEffect(() => {
    if (!viewer || !model || introDone.current) return;
    const first = model.memories[0];
    if (first) { introDone.current = true; select(first); }
  }, [viewer, model, select]);

  if (loading) return <div className="atlas-boot"><div className="msg">Loading Companion Atlas…</div></div>;
  if (error || !model || !story) {
    return <div className="atlas-boot"><div className="msg"><strong>Couldn’t load a story.</strong><span>{error ?? 'Append ?story=<url> to view one.'}</span></div></div>;
  }

  return (
    <div className="atlas-app">
      <Starfield />
      <div className="atlas-aurora" aria-hidden="true" />
      <Rail />
      <TopBar view={view} onView={setView} />
      <main className="atlas-stage">
        <CesiumStoryViewer story={story} onViewer={setViewer} />
        <GridHorizon />
        <div className="atlas-overlay">
          <StatsRibbon stats={model.stats} />
          <PlaceChip memory={focused} />
          <ScrapbookFrames memories={model.memories} onSelect={select} />
          <Legend />
        </div>
      </main>
      <MemoryInspector memory={focused} related={related} onFly={select} />
      <TimeMachine
        model={model}
        currentMs={currentMs || model.timeline.startMs}
        playing={playing}
        onTogglePlay={togglePlay}
        onScrub={scrub}
        onStep={step}
      />
    </div>
  );
}
