import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { buildScrapbookStory, curateJourney, type ScrapbookEntry, type Story, type Place } from '@companion-atlas/story';
import { useStory } from './story/useStory.js';
import { usePlaces } from './story/usePlaces.js';
import { CesiumStoryViewer } from './renderers/CesiumStoryViewer.js';
import { deriveModel, memoriesAround, nearestMemory, type AtlasMemory } from './model/atlasModel.js';
import { Rail, TopBar } from './ui/Shell.js';
import { MapLayers } from './ui/MapLayers.js';
import { DEFAULT_BASEMAP } from './renderers/basemaps.js';

const googleMapsAvailable = Boolean(
  (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_GOOGLE_MAPS_API_KEY,
);
import { Starfield } from './ui/Backdrop.js';
import { StatsRibbon, Legend, PlaceChip, ScrapbookFrames } from './ui/Overlays.js';
import { nameUnplacedMemories, placeSummaries } from './model/atlasModel.js';
import { useWeather } from './story/useWeather.js';
import { useStreetView } from './story/useStreetView.js';
import { MemoryInspector } from './ui/MemoryInspector.js';
import { PlaceCard } from './ui/PlaceCard.js';
import { TimeMachine } from './ui/TimeMachine.js';
import { CommandPalette } from './ui/CommandPalette.js';
import { Lightbox } from './ui/Lightbox.js';
import { useScrapbook } from './scrapbook/useScrapbook.js';
import { useLayers } from './layers/index.js';
import { Presenter } from './ui/Presenter.js';
import type { DeckSlide } from './ui/sceneDeck.js';
import { InteropPanel, DropOverlay } from './interop/InteropPanel.js';
import { useImported, withImported } from './interop/useImported.js';
import { applyMemoryPlaces, type MemoryImport } from './memory/import.js';
import { isFramableBounds, type GeoPlace } from './memory/geocode.js';
import { useFileDrop } from './interop/useFileDrop.js';
import { useAuthoring } from './authoring/useAuthoring.js';
import { AuthoringToolbar, mergeAuthoredItems } from './authoring/index.js';
import { importFiles } from './interop/importFile.js';
import { ScrapbookDrawer, type SaveState } from './ui/ScrapbookDrawer.js';
import { PeoplePanel, groupByPerson, type PersonGroup } from './ui/PeoplePanel.js';
import { saveStoryToMemory } from './memory/client.js';

/** The last memory whose time is at or before `ms` (the segment being played). */
function lastPassed(memories: AtlasMemory[], ms: number): AtlasMemory | null {
  const sorted = [...memories].sort((a, b) => a.timeMs - b.timeMs);
  let r: AtlasMemory | null = sorted[0] ?? null;
  for (const m of sorted) {
    if (m.timeMs <= ms) r = m; else break;
  }
  return r;
}

/** How long a journey should take to play back, whatever its real span. */
const PLAYBACK_SECONDS = 45;

/**
 * The current URL with credentials stripped. `?token=` is a bearer token and
 * `?memory=` is a private server address — neither belongs on the clipboard or
 * persisted into a household-visible event's `metadata.shareUrl`.
 */
function safeShareUrl(): string {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('token');
    u.searchParams.delete('memory');
    return u.toString();
  } catch {
    return window.location.origin;
  }
}

const toEntry = (m: AtlasMemory): ScrapbookEntry => ({
  id: m.id,
  title: m.title,
  narrative: m.narrative,
  place: m.place,
  timeMs: m.timeMs,
  lat: m.lat,
  lon: m.lon,
  people: m.people,
  media: m.media,
});

/**
 * Companion Atlas — a social scrapbook and memory time machine. A CI-branded
 * frame around the Cesium memory globe: collect memories into a scrapbook, let
 * the Companion curate them into a journey, play it through time, and save it
 * back into Companion Memory (which is what shares it). See docs/REDESIGN.md.
 */
export function AtlasApp() {
  const { story: loadedStory, error, loading, source, isSample, memory } = useStory();
  // A Companion Memory import REPLACES the loaded story rather than merging
  // into it. `deriveModel` reads its memory list from `story.scenes` whenever
  // there are any, so an archive merged into a scened story renders as nothing;
  // the imported document has no scenes by design (`memoryToStory`), which is
  // exactly what makes the entity fallback project every row.
  const [memImport, setMemImport] = useState<MemoryImport | null>(null);

  // The importer's roster beats a second places() query — it also covers
  // places the events reference but that query never returned.
  const { places } = usePlaces(memory, memImport?.places ?? null);

  // A curated scrapbook journey temporarily takes over the globe; the loaded
  // story stays the base the scrapbook collects against.
  const [journey, setJourney] = useState<Story | null>(null);
  // Files dropped on the globe live here until they are saved somewhere real.
  // They are merged into the rendered story rather than kept as a side-channel,
  // so an imported placemark is exportable, collectable, and visible in a
  // headset — the reason import lands in the model at all (see interop/).
  const imported = useImported();
  const story = useMemo(
    () => withImported(journey ?? memImport?.story ?? loadedStory, imported.items),
    [journey, memImport, loadedStory, imported.items],
  );
  const model = useMemo(() => (story ? deriveModel(story) : null), [story]);
  // The scrapbook collects against the *base* story. If that stayed
  // `loadedStory` after an import, every collected id would resolve against a
  // story no longer on screen and the draft would silently empty.
  const baseModel = useMemo(() => {
    const base = memImport?.story ?? loadedStory;
    return base ? deriveModel(base) : null;
  }, [memImport, loadedStory]);

  // Reduced-motion gates the app's dominant motion (time autoplay + camera
  // flights), not just the starfield.
  const reduceMotion = useMemo(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const [basemap, setBasemap] = useState<string>(DEFAULT_BASEMAP);
  const [sunLighting, setSunLighting] = useState(false);
  const [buildings, setBuildings] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);

  // "What was this place to me": the other memories sharing the focused
  // memory's place, which is how a real archive is actually structured — a
  // handful of venues returned to dozens of times.
  // Name the memories the server could not place, from the Places already
  // loaded for the places layer — no extra request. Without this a delivery
  // renders as "Unnamed location" even when a known venue sits metres away.
  // Two passes, in this order and not the other. `applyMemoryPlaces` is the
  // *exact* join — CI-Server told us which place each memory belongs to — and
  // `MediaItem` has no `placeId` field to carry it, so without this a photo's
  // real place is structurally lost and it falls into "no place" even though
  // the server knew. `nameUnplacedMemories` is the 150m proximity guess, and a
  // guess must only ever fill what the exact join left empty.
  const memoriesNamed = useMemo(
    () => (model
      ? nameUnplacedMemories(
          applyMemoryPlaces(model.memories, memImport?.placeOfMemory ?? new Map()),
          places,
        )
      : []),
    [model, places, memImport],
  );

  const placeIndex = useMemo(() => {
    const summaries = placeSummaries(memoriesNamed);
    // The local tally only counts memories currently loaded (the client pages a
    // bounded window), so it under-reports: a venue visited 50 times shows 37.
    // CI-Server's Places API carries the true lifetime count, so prefer it and
    // keep the local figure only as the offline fallback.
    const byId = new Map(places.map((p) => [p.id, p]));
    for (const s of summaries) {
      const server = byId.get(s.id);
      if (!server) continue;
      if (server.visitStats?.visitCount) s.visits = server.visitStats.visitCount;
      const first = server.visitStats?.firstVisitAt ? Date.parse(server.visitStats.firstVisitAt) : NaN;
      const last = server.visitStats?.lastVisitAt ? Date.parse(server.visitStats.lastVisitAt) : NaN;
      if (Number.isFinite(first)) s.firstMs = Math.min(s.firstMs, first);
      if (Number.isFinite(last)) s.lastMs = Math.max(s.lastMs, last);
      if (server.name) s.name = server.name;
    }
    return new Map(summaries.map((p) => [p.id, p]));
  }, [memoriesNamed, places]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Named-places layer: opt-in (the memory layer is the primary surface), and
  // its own focus state — independent of `focusedId`/`focused`, which are memory-only.
  const [showPlaces, setShowPlaces] = useState(false);
  const [focusedPlace, setFocusedPlace] = useState<Place | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(!reduceMotion);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<AtlasMemory | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sbOpen, setSbOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [interopOpen, setInteropOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ s: 'idle' });
  const lastSync = useRef(0);
  const flownToRef = useRef<string | null>(null);
  const introDone = useRef(false);
  const lightboxRef = useRef<AtlasMemory | null>(null);
  lightboxRef.current = lightbox;
  /** journey scene id → base memory id, for the currently playing journey. */
  const journeyMapRef = useRef(new Map<string, string>());

  // Scope the draft to the story it collects from — memory ids only mean
  // something within one story, so a global draft counted memories the current
  // story can't resolve.
  const sb = useScrapbook(loadedStory?.id ?? null);

  const focused: AtlasMemory | null = useMemo(() => {
    if (!model) return null;
    return model.memories.find((m) => m.id === focusedId) ?? model.focused;
  }, [model, focusedId]);

  const related = useMemo(
    () => (model ? model.memories.filter((m) => m.id !== focused?.id) : []),
    [model, focused],
  );

  // What the weather actually was, at this place, that hour.
  const weather = useWeather(focused);
  const streetView = useStreetView(focused);

  // The scrapbook always collects against the *base* story, so a draft survives
  // playing a journey built from it.
  const sbEntries = useMemo(() => {
    if (!baseModel) return [];
    return sb.draft.memoryIds
      .map((id) => baseModel.memories.find((m) => m.id === id))
      .filter((m): m is AtlasMemory => !!m);
  }, [baseModel, sb.draft.memoryIds]);

  const peopleGroups = useMemo(() => (baseModel ? groupByPerson(baseModel.memories) : []), [baseModel]);

  // Overlays that follow the clock: the scrapbook shows the memories nearest the
  // playhead and the place chip names the current place, so scrubbing/playing
  // repopulates them.
  const scrapbook = useMemo(
    () => (model ? memoriesAround(model.memories, currentMs, 3) : []),
    [model, currentMs],
  );
  // The chip names the place the user is actually looking at. It used to track
  // only the clock playhead, so clicking a pin left it naming a different
  // memory than the inspector — two competing "current" labels on screen at
  // once. An explicit selection wins; with none, it follows playback.
  const currentPlace = useMemo(
    () => (focusedId && focused ? focused : model ? nearestMemory(model.memories, currentMs) : null),
    [model, currentMs, focusedId, focused],
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

  // Apply the *current story's* clock explicitly. Cesium's automatic
  // data-source clock tracking is off (the memory layer was stealing it, which
  // left the viewer one story behind on every swap), so the app is the single
  // owner of range/pacing/bounds — and it re-applies on each story change.
  useEffect(() => {
    if (!viewer || !model || !story) return;
    const clock = viewer.clock;
    const { startMs, stopMs } = model.timeline;
    if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) return;
    const start = Cesium.JulianDate.fromDate(new Date(startMs));
    const stop = Cesium.JulianDate.fromDate(new Date(Math.max(stopMs, startMs + 1000)));
    const spanSec = Math.max(1, (stopMs - startMs) / 1000);
    clock.startTime = start;
    clock.stopTime = stop;
    // Only loop when the story asks to; otherwise play once and stop.
    clock.clockRange = story.timeline?.loop === true ? Cesium.ClockRange.LOOP_STOP : Cesium.ClockRange.CLAMPED;
    // Any journey — 70 minutes or 10 years — plays in ~PLAYBACK_SECONDS.
    clock.multiplier = story.timeline?.multiplier ?? Math.max(1, spanSec / PLAYBACK_SECONDS);
    // Clamp the playhead into the new story's window.
    if (Cesium.JulianDate.lessThan(clock.currentTime, start) || Cesium.JulianDate.greaterThan(clock.currentTime, stop)) {
      clock.currentTime = Cesium.JulianDate.clone(start);
      setCurrentMs(startMs);
    }
  }, [viewer, model, story]);

  const flyTo = useCallback((m: AtlasMemory) => {
    if (!viewer || m.lat == null || m.lon == null) return;
    void viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 1_800_000),
      duration: reduceMotion ? 0 : 1.6,
    });
  }, [viewer, reduceMotion]);

  // The palette can now find a place that is in no story at all — the first
  // time the camera can be asked somewhere nothing is pinned. A place with an
  // extent gets framed by its box; a point (an address, a POI) gets the same
  // fixed altitude a memory does, because flying to the 20m "box" around a
  // house puts the camera inside the roof. A degenerate box, or one crossing
  // the antimeridian (east < west), falls back to the point rather than handing
  // Cesium a rectangle it will read the long way round.
  const flyToGeoPlace = useCallback((gp: GeoPlace) => {
    if (!viewer || viewer.isDestroyed()) return;
    const b = gp.bounds;
    // `isFramableBounds` rather than a truthiness check: a box being *present*
    // says nothing about it being worth flying to. Nominatim attaches a
    // boundingbox to every row including house numbers, so a street address
    // arrives with a ~10m rectangle and framing it puts the camera inside the
    // roof — the exact case this fallback exists for. The predicate lives with
    // the parsers that produce the boxes, and covers degenerate and
    // antimeridian-crossing ones too.
    void viewer.camera.flyTo({
      destination: b && isFramableBounds(b)
        ? Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north)
        : Cesium.Cartesian3.fromDegrees(gp.lon, gp.lat, 1_800_000),
      duration: reduceMotion ? 0 : 1.6,
    });
  }, [viewer, reduceMotion]);

  const flyToPlace = useCallback((p: Place) => {
    if (!viewer || p.latitude == null || p.longitude == null) return;
    void viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, 1_800_000),
      duration: reduceMotion ? 0 : 1.6,
    });
  }, [viewer, reduceMotion]);

  // One switch, two places to reach it: the layers menu (where map layers
  // live) and the time bar (where the moment lives). Same state, so they can
  // never disagree about whether the globe is lit for the moment on screen.
  const toggleSun = useCallback(() => setSunLighting((v) => !v), []);

  const closePlace = useCallback(() => setFocusedPlace(null), []);
  const togglePlaces = useCallback(() => setShowPlaces((v) => !v), []);

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

  const play = useCallback(() => {
    if (viewer) viewer.clock.shouldAnimate = true;
    setPlaying(true);
  }, [viewer]);

  // A user-initiated jump: select + pause, so the camera settles on the memory
  // instead of the playback fly-through carrying on.
  const inspect = useCallback((m: AtlasMemory) => { select(m); pause(); }, [select, pause]);

  // "Fit all places": frame the camera on every located memory at once.
  const frameAll = useCallback(() => {
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
  // default empty night hemisphere), then let playback carry the journey.
  useEffect(() => {
    if (!viewer || !model || introDone.current) return;
    const first = model.memories[0];
    if (first) { introDone.current = true; select(first); }
  }, [viewer, model, select]);

  // ————— the scrapbook loop: collect → curate → play → save —————

  // While a journey plays, its scenes are re-ids of base memories. Map back by
  // membership (built when the journey is constructed) rather than by stripping
  // an `sb-` prefix — the exporter names every scene `sb-<id>`, so a downloaded
  // journey re-opened as the base story would have had its own ids mangled.
  const toBaseId = useCallback((id: string) => journeyMapRef.current.get(id) ?? id, []);
  const collected = useCallback((m: AtlasMemory) => sb.has(toBaseId(m.id)), [sb, toBaseId]);
  const toggleCollect = useCallback((m: AtlasMemory) => {
    const id = toBaseId(m.id);
    if (sb.has(id)) sb.remove(id); else sb.add(id);
  }, [sb, toBaseId]);

  /** Hand the globe a story to fly through, and re-run the intro on it. Resumes
   *  the clock: every route to collecting a memory pauses it (inspect = select +
   *  pause), so without this the chip reads "Playing journey" while the globe
   *  sits frozen on the first memory. */
  const playStory = useCallback((s: Story, sources: AtlasMemory[]) => {
    // Remember which base memory each journey scene came from.
    journeyMapRef.current = new Map(s.scenes.map((sc, i) => [sc.id, sources[i]?.id ?? sc.id]));
    introDone.current = false;
    flownToRef.current = null;
    setFocusedId(null);
    setJourney(s);
    setSbOpen(false);
    setPeopleOpen(false);
    play();
  }, [play]);

  const exitJourney = useCallback(() => {
    journeyMapRef.current = new Map();
    introDone.current = false;
    flownToRef.current = null;
    setFocusedId(null);
    setJourney(null);
    play();
  }, [play]);

  // Layers the user has added, scoped per connected memory so two accounts on
  // one browser don't inherit each other's stack. `timeMs` drives the
  // availability window — a layer that only applies to part of the timeline
  // hides itself as the clock leaves its range.
  const layerControl = useLayers(memory?.url ?? null, { timeMs: currentMs || null });

  // The document actually on screen — not just `loadedStory`, which is only the
  // `?story=` and bundled-demo path. On a Companion Memory session the story on
  // screen is `memoryToStory` output or an imported archive, so gating the merge
  // on `loadedStory` is why the layers `draftStory` correctly writes were
  // write-only: saved, and never read back.
  const openStory = journey ?? memImport?.story ?? loadedStory;

  // A story that arrives carrying layers must put them in the stack, or it
  // renders none of them and says nothing — a layer nobody draws logs nothing.
  // The story id travels with them: those rows belong to the document, so they
  // stay out of the user's own account-scoped stack, and one the user removes
  // stays removed instead of being re-adopted on the next render.
  useEffect(() => {
    layerControl.mergeStoryLayers(openStory?.layers, openStory?.id);
  }, [openStory, layerControl.mergeStoryLayers]);

  // Layers from a dropped `.story.json`. No story id on purpose: the user
  // brought the file deliberately, so these are theirs — persisted with the rest
  // of their stack rather than borrowed from whatever document happens to be open.
  useEffect(() => {
    layerControl.mergeStoryLayers(imported.layers);
  }, [imported.layers, layerControl.mergeStoryLayers]);

  // Drawing. The controller owns rendering for what it draws (its own
  // CustomDataSource), which is why `draw.items` are merged into the story for
  // *export* only — feeding them through the story's CZML as well would draw
  // every shape twice, z-fighting two coincident surfaces and giving each two
  // pick targets.
  const draw = useAuthoring(viewer, {
    story: loadedStory,
    enabled: drawing,
    // Drawn shapes now survive a reload. Same bucket rule as the layer stack —
    // per connected memory, so two accounts on one browser never inherit each
    // other's annotations.
    scope: memory?.url ?? null,
    onSelect: (sel) => {
      if (sel?.kind === 'memory') setFocusedId(sel.id);
      else if (sel?.kind === 'place') setFocusedPlace(places.find((p) => p.id === sel.id) ?? null);
    },
  });

  const draftStory = useCallback(
    (curated: boolean): Story | null => {
      if (sbEntries.length === 0) return null;
      const entries = sbEntries.map(toEntry);
      const opts = { visibility: sb.draft.visibility, title: sb.draft.title || undefined };
      const base = curated ? curateJourney(entries, opts) : buildScrapbookStory(entries, opts);
      // Everything that leaves the app carries everything on the globe.
      //
      // Layers, because a user who added four of them would otherwise save a
      // story with none — and each layer's attribution goes with it, which is a
      // licence condition rather than a nicety.
      //
      // Drawn shapes, because localStorage is a convenience, not custody: it is
      // per-browser, cleared by a privacy setting, and invisible to anyone the
      // story is shared with. If saving a journey silently dropped the
      // annotations the user drew on it, "Save to Memory" would be quietly
      // lossy in the one direction that is meant to be durable.
      return layerControl.toStory(
        draw.items.length ? mergeAuthoredItems(base, draw.items) : base,
      );
    },
    [sbEntries, sb.draft.visibility, sb.draft.title, layerControl.toStory, draw.items],
  );

  const curate = useCallback(() => {
    const s = draftStory(true);
    if (!s) return;
    sb.setTitle(s.title);   // the Companion names the journey
    sb.setCurated(true);    // …and save/download must keep its work
    playStory(s, sbEntries);
  }, [draftStory, sb, playStory, sbEntries]);

  const playScrapbook = useCallback(() => {
    const s = draftStory(sb.draft.curated);
    if (s) playStory(s, sbEntries);
  }, [draftStory, playStory, sb.draft.curated, sbEntries]);

  const saveScrapbook = useCallback(async () => {
    // Honour the curation: saving after "Curate with Companion" used to rebuild
    // the raw story, throwing away the generated narratives *and* the agent
    // provenance the curator stamped.
    const s = draftStory(sb.draft.curated);
    if (!s || !memory) return;
    setSaveState({ s: 'saving' });
    try {
      const r = await saveStoryToMemory(memory, s, { shareUrl: safeShareUrl() });
      setSaveState({ s: 'done', id: r.id, visibility: sb.draft.visibility });
    } catch (e) {
      setSaveState({ s: 'error', msg: e instanceof Error ? e.message : String(e) });
    }
  }, [draftStory, memory, sb.draft.curated, sb.draft.visibility]);

  const downloadScrapbook = useCallback(() => {
    const s = draftStory(sb.draft.curated);
    if (!s) return;
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(s.title || 'journey').replace(/[^\w.-]+/g, '-').toLowerCase()}.story.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [draftStory]);

  // ⌘K / Ctrl-K toggles the command palette (never behind the lightbox, which
  // sits above it — an invisible focused palette would steal keystrokes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (lightboxRef.current) return;
        setPaletteOpen((o) => !o);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const share = useCallback(() => {
    try { void navigator.clipboard?.writeText(safeShareUrl()); } catch { /* ignore */ }
  }, []);

  // A "Saved" banner must not outlive the thing it described: editing the draft
  // (or clearing it) invalidates the confirmation.
  useEffect(() => { setSaveState({ s: 'idle' }); }, [sb.draft.memoryIds, sb.draft.title, sb.draft.visibility]);

  const playPersonJourney = useCallback((g: PersonGroup) => {
    const s = curateJourney(g.memories.map(toEntry), { title: `${g.label} — shared memories`, visibility: 'private' });
    playStory(s, g.memories);
  }, [playStory]);

  // Stable close handlers so overlay effects (e.g. Lightbox's Escape listener)
  // don't re-subscribe on every ~240ms clock-driven re-render.
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeScrapbook = useCallback(() => setSbOpen(false), []);
  const closePeople = useCallback(() => setPeopleOpen(false), []);
  const closeInterop = useCallback(() => setInteropOpen(false), []);

  // The way back out of an empty or unwanted import, without a page reload.
  const clearImport = useCallback(() => {
    setMemImport(null);
    introDone.current = false;
  }, []);

  const onMemoryImported = useCallback((r: MemoryImport) => {
    setMemImport(r);
    // The intro flight ("frame the first memory, set the clock to its moment")
    // is one-shot per session. A freshly imported archive is a new set of
    // memories and deserves it again, or the camera stays parked over the old
    // story's coordinates with nothing under it.
    introDone.current = false;
  }, []);
  const exitPresent = useCallback(() => setPresenting(false), []);


  // Dropping files anywhere on the globe imports them. Reported per file so one
  // bad file in a multi-file drop doesn't lose the rest, and the panel opens so
  // the outcome — including failures — is visible rather than silent.
  const takeFiles = useCallback(
    async (files: File[]) => {
      const result = await importFiles(files);
      imported.add(result.files);
      setInteropOpen(true);
      if (result.items.length) frameAll();
    },
    [imported, frameAll],
  );
  const { dragging } = useFileDrop((files) => void takeFiles(files));
  // Imported items have no scene, so no memory pin represents them — the
  // renderer needs to know not to filter their CZML away.
  const importedIds = useMemo(() => imported.items.map((i) => i.id), [imported.items]);


  /** What leaves the app: everything on the globe — drawn shapes and layers. */
  const exportStory = useMemo(
    // `story` is still nullable here — the loading/error guards sit below.
    // `toStory` returns its argument unchanged when the stack is empty, so a
    // user with no layers keeps today's object identity and the viewer does not
    // rebuild its CZML data source for nothing.
    () => layerControl.toStory(story && draw.items.length ? mergeAuthoredItems(story, draw.items) : story),
    [story, draw.items, layerControl.toStory],
  );

  // Stepping through authored scenes. The presenter owns the deck and the
  // keyboard; the camera and the clock stay here, because they belong to the
  // renderer this component owns.
  const presentScene = useCallback(
    (slide: DeckSlide) => {
      pause(); // a presentation is stepped, not played
      if (slide.timeMs != null) scrub(slide.timeMs);
      setFocusedId(slide.id);
      // Claim the fly so the playback fly-through doesn't re-fly this scene
      // from under the presenter a frame later.
      flownToRef.current = slide.id;
      if (!viewer || viewer.isDestroyed() || !slide.camera) return;
      const { lon, lat, height, heading, pitch, roll, range } = slide.camera;
      const duration = slide.transition.durationMs / 1000; // already 0 for a cut
      if (range != null) {
        void viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, height ?? 0), 1),
          {
            duration,
            offset: new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(heading ?? 0),
              Cesium.Math.toRadians(pitch ?? -35),
              range,
            ),
          },
        );
        return;
      }
      void viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height ?? 1_800_000),
        orientation: {
          heading: Cesium.Math.toRadians(heading ?? 0),
          pitch: Cesium.Math.toRadians(pitch ?? -90),
          roll: Cesium.Math.toRadians(roll ?? 0),
        },
        duration,
      });
    },
    [viewer, pause, scrub],
  );

  if (loading) return <div className="atlas-boot"><div className="msg">Loading Companion Atlas…</div></div>;
  if (error || !model || !story) {
    return <div className="atlas-boot"><div className="msg"><strong>Couldn’t load a story.</strong><span>{error ?? 'Append ?story=<url> to view one.'}</span></div></div>;
  }
  // A memory query that matches nothing returns a perfectly valid *empty* story,
  // so the error branch never fires — without this the user just gets a blank
  // globe and no idea whether it's broken, empty, or filtered.
  // `!memImport` is load-bearing. This guard is a full-screen early return, and
  // everything — Rail, InteropPanel, the running transfer state — is mounted
  // below it. An import whose filter legitimately matched nothing (a wrong year,
  // a box over open sea) sets `memImport` to an empty story, drives
  // `model.memories.length` to 0, and `source` is 'memory' for the whole
  // session regardless. So the guard fired and ejected the user out of the app
  // and away from the panel they were operating, with no control on the card and
  // no way back but a page reload — which discarded the filter and the import.
  // Following the panel's own "narrow it first" advice was the fastest way to
  // hit it. An empty *import* is now an in-app state (the chip below); this card
  // is only for an empty initial connection, which is what it was written for.
  if (source === 'memory' && !memImport && model.memories.length === 0) {
    return (
      <div className="atlas-boot">
        <div className="msg">
          <strong>Connected to Companion Memory — no located memories yet.</strong>
          <span>
            The search matched nothing with coordinates. Memories need a location to appear on the globe;
            imports without GPS won’t show here.
          </span>
          <span className="dim">Connected to {memory?.url}</span>
        </div>
      </div>
    );
  }


  return (
    <div className="atlas-app">
      <Starfield />
      <div className="atlas-aurora" aria-hidden="true" />
      <Rail
        onSearch={() => setPaletteOpen(true)}
        onFrameAll={frameAll}
        onPeople={() => { setPeopleOpen((o) => !o); setSbOpen(false); }}
        onCollections={() => { setSbOpen((o) => !o); setPeopleOpen(false); }}
        // Count what the drawer can actually show, so the badge can never claim
        // memories this story can't resolve.
        scrapbookCount={sbEntries.length}
        onPresent={() => setPresenting(true)}
        onDraw={() => setDrawing((d) => !d)}
        drawing={drawing}
        onInterop={() => setInteropOpen((o) => !o)}
        // `memoryToStory` returns `scenes: []`, so gating on scenes hid Present
        // from every real story and left it reachable only from the bundled
        // demo. `buildDeck` now projects memories when a story has no authored
        // scenes, so the honest question is whether there is anything to show.
        canPresent={(story.scenes?.length ?? 0) > 0 || model.memories.length > 0}
        importedCount={imported.items.length}
      />
      <TopBar
        onSearch={() => setPaletteOpen(true)}
        onShare={share}
        live={source === 'memory'}
        sample={isSample}
        showPlaces={showPlaces}
        onTogglePlaces={togglePlaces}
        layers={(
          <MapLayers
            open={layersOpen}
            basemap={basemap}
            sunLighting={sunLighting}
            buildings={buildings}
            buildingsAvailable={Boolean(googleMapsAvailable)}
            onBasemap={setBasemap}
            onToggleSun={toggleSun}
            onToggleBuildings={() => setBuildings((v) => !v)}
            onToggle={() => setLayersOpen((o) => !o)}
            onClose={() => setLayersOpen(false)}
            layers={layerControl}
          />
        )}
      />
      <main className="atlas-stage">
        <CesiumStoryViewer
          story={story}
          memories={model.memories}
          places={showPlaces ? places : []}
          focusedId={focused?.id ?? null}
          basemap={basemap}
          sunLighting={sunLighting}
          buildings={buildings}
          onViewer={setViewer}
          onPick={draw.mode === 'idle' ? inspect : undefined}
          onPickPlace={setFocusedPlace}
          onHover={setHoveredId}
          onInteract={pause}
          layers={layerControl.layers}
          claimedUrls={layerControl.claimedUrls}
          timeMs={currentMs || model.timeline.startMs}
          extraItemIds={importedIds}
        />
        {(
          <div className="atlas-overlay">
            <StatsRibbon stats={model.stats} />
            <PlaceChip memory={currentPlace} />
            <ScrapbookFrames memories={scrapbook} hoveredId={hoveredId} onSelect={inspect} viewer={viewer} />
            <Legend />
          </div>
        )}
        {journey && (
          <div className="atlas-journey-chip" role="status">
            <span>Playing journey · <b>{journey.title}</b></span>
            <button onClick={exitJourney}>Back to all memories</button>
          </div>
        )}
        {!journey && memImport && model.memories.length === 0 && (
          <div className="atlas-journey-chip" role="status">
            <span>That import matched nothing with coordinates. Widen the range or the area.</span>
            <button onClick={clearImport}>Clear import</button>
          </div>
        )}
      </main>
      {(
        focusedPlace ? (
          <PlaceCard place={focusedPlace} onFly={flyToPlace} onClose={closePlace} />
        ) : (
          <MemoryInspector
            memory={focused}
            related={related}
            place={focused ? placeIndex.get(focused.placeId ?? `name:${focused.place ?? ''}`) ?? null : null}
            weather={weather}
            streetView={streetView.shot}
            streetViewStatus={streetView.status}
            onFly={inspect}
            onExpand={() => focused && setLightbox(focused)}
            collected={focused ? collected(focused) : false}
            onCollect={() => focused && toggleCollect(focused)}
          />
        )
      )}
      <TimeMachine
        model={model}
        currentMs={currentMs || model.timeline.startMs}
        playing={playing}
        sunLighting={sunLighting}
        onTogglePlay={togglePlay}
        onToggleSun={toggleSun}
        onScrub={scrub}
        onStep={step}
      />
      <ScrapbookDrawer
        open={sbOpen}
        entries={sbEntries}
        title={sb.draft.title}
        visibility={sb.draft.visibility}
        canSave={!!memory}
        canClear={sb.count > 0}
        saveState={saveState}
        onClose={closeScrapbook}
        onTitle={sb.setTitle}
        onVisibility={sb.setVisibility}
        onRemove={sb.remove}
        onClear={sb.clear}
        onCurate={curate}
        onPlay={playScrapbook}
        onSave={() => void saveScrapbook()}
        onDownload={downloadScrapbook}
      />
      <PeoplePanel open={peopleOpen} groups={peopleGroups} onClose={closePeople} onPlayPerson={playPersonJourney} />
      <CommandPalette
        open={paletteOpen}
        memories={model.memories}
        onClose={closePalette}
        onSelect={(m) => { inspect(m); closePalette(); }}
        // pause() first, for the same reason `inspect` does: the playback
        // fly-through would otherwise yank the camera straight back off the
        // place the user just picked.
        onSelectPlace={(gp) => { pause(); flyToGeoPlace(gp); closePalette(); }}
        // Bias short queries toward what is on screen — "springfield" meaning
        // the one nearby rather than the one in Illinois.
        near={focused?.lat != null && focused?.lon != null
          ? { lat: focused.lat, lon: focused.lon }
          : undefined}
      />
      <Lightbox memory={lightbox} onClose={closeLightbox} />
      <AuthoringToolbar {...draw.toolbarProps} />
      <InteropPanel
        open={interopOpen}
        onClose={closeInterop}
        story={exportStory}
        files={imported.files}
        onImported={imported.add}
        onRemoveFile={imported.removeFile}
        onClearImported={imported.clear}
        onFrameImported={frameAll}
        memory={memory}
        onMemoryImported={onMemoryImported}
        shareUrl={safeShareUrl}
      />
      <Presenter
        story={story}
        open={presenting}
        onExit={exitPresent}
        onSceneEnter={presentScene}
        // Without these the presenter opens empty on any Memory story: the deck
        // is built from scenes, and a Memory archive has none.
        memories={model.memories}
        initialSceneId={focused?.id ?? null}
        reduceMotion={reduceMotion}
      />
      <DropOverlay visible={dragging} />
    </div>
  );
}
