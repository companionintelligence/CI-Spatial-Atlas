import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { buildScrapbookStory, curateJourney, type Camera, type Item, type ScrapbookEntry, type Story, type Place } from '@companion-atlas/story';
import { useStory } from './story/useStory.js';
import { usePlaces } from './story/usePlaces.js';
import { CesiumStoryViewer, type SceneModeName } from './renderers/CesiumStoryViewer.js';
import { deriveModel, memoriesAround, nearestMemory, type AtlasMemory } from './model/atlasModel.js';
import { Rail, TopBar } from './ui/Shell.js';
import { MapLayers } from './ui/MapLayers.js';
import { VisibilityToggles, type AuthoredCategory } from './ui/VisibilityToggles.js';
import { NoteCard } from './ui/NoteCard.js';
import { DEFAULT_BASEMAP } from './renderers/basemaps.js';

const googleMapsAvailable = Boolean(
  (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_GOOGLE_MAPS_API_KEY,
);
// Same derivation `InteropPanel` uses for its own upload section, module-scope
// for the same reason: `import.meta.env` is frozen at build time, so reading it
// per render would hand `useMediaUpload` a new (but equal) object every time.
const ATLAS_API = atlasApiFromEnv(
  (import.meta as unknown as { env: Record<string, string | undefined> }).env,
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
import { atlasApiFromEnv } from './upload/index.js';
import type { ImportedFile } from './interop/importFile.js';
import { useImported, withImported } from './interop/useImported.js';
import { applyMemoryPlaces, type MemoryImport } from './memory/import.js';
import { isFramableBounds, type GeoPlace } from './memory/geocode.js';
import { useFileDrop } from './interop/useFileDrop.js';
import { atlasChrome, restoredView, SharePanel, EmbedBar } from './embed/index.js';
import { useAuthoring } from './authoring/useAuthoring.js';
import { poseFromCamera } from './authoring/camera.js';
import { useScenes, withAuthoredScenes } from './scenes/index.js';
import { SceneList } from './scenes/SceneList.js';
import { SceneEditor, CAPTURE_UNSETTLED } from './scenes/SceneEditor.js';
import { AuthoringToolbar, mergeAuthoredItems } from './authoring/index.js';
import { importFiles } from './interop/importFile.js';
import { ScrapbookDrawer, type SaveState } from './ui/ScrapbookDrawer.js';
import { PeoplePanel, groupByPerson, type PersonGroup } from './ui/PeoplePanel.js';
import { saveStoryToMemory } from './memory/client.js';
import { StoryLoadError } from './ui/StoryLoadError.js';

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
 * The current URL with credentials stripped. `?token=` is a bearer token,
 * `?apiKey=` is a server credential, and `?memory=` is a private server address
 * — none belongs on the clipboard or persisted into a household-visible
 * event's `metadata.shareUrl`.
 */
function safeShareUrl(): string {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('token');
    u.searchParams.delete('memory');
    u.searchParams.delete('apiKey');
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
  // Reading mode. One decision for the whole shell rather than a `&&` per
  // surface — the surface list is an exhaustive union, so adding a panel forces
  // a decision about whether an embed shows it. See embed/embedMode.ts.
  const chrome = useMemo(() => atlasChrome(window.location.search), []);
  /** The camera and moment a shared or embedded link asked to open at. */
  const opened = useMemo(() => restoredView(window.location.search), []);
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
  // Projection. Starts on the globe because that is what Atlas is for; a story
  // that is really a map is one click from being read as one.
  const [sceneMode, setSceneMode] = useState<SceneModeName>('3d');
  const [sunLighting, setSunLighting] = useState(false);
  const [buildings, setBuildings] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  // What's shown on the globe: an independent popover, anchored to its own
  // header icon exactly like `layersOpen`/`MapLayers` — not part of
  // `openDrawer`, which exists to make mutually exclusive same-anchored
  // drawers unrepresentable, and this is neither of those things.
  const [visOpen, setVisOpen] = useState(false);
  // Images are off by default: an uploaded photo used to land on the globe
  // the instant it had no scene, with no way to turn it back off.
  const [hiddenCategories, setHiddenCategories] = useState<ReadonlySet<AuthoredCategory>>(
    () => new Set(['photo']),
  );
  const toggleVisibilityCategory = useCallback((category: AuthoredCategory) => {
    setHiddenCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    });
  }, []);

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
  // A clicked note's full text, docked in the same slot as `focusedPlace` —
  // its label on the globe is cropped (see `cropNoteLabel`), so this is where
  // the rest of it goes. `Item` rather than a plain string: `NoteCard` also
  // wants the title, if the note has one.
  const [focusedNote, setFocusedNote] = useState<(Item & { type: 'note' }) | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(!reduceMotion);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<AtlasMemory | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /**
   * Which of the four right-anchored drawers is open, or none.
   *
   * One state rather than four independent booleans, because all four render
   * at the identical spot (`top:14px; right:14px`, same z-index) — that is
   * what "the left nav buttons do not work cleanly" was: People and Collections
   * closed each other by hand-written pairs of setters, but Scenes and Import &
   * export did not, so opening Scenes over an open Import panel left the import
   * panel state-open and invisible underneath it, and closing Scenes again
   * brought it back looking like it had appeared from nowhere. A single value
   * makes "more than one open" impossible to represent, so that class of bug
   * cannot come back by someone forgetting to add a `setXOpen(false)` at a new
   * call site.
   */
  const [openDrawer, setOpenDrawer] = useState<'scrapbook' | 'people' | 'scenes' | 'interop' | null>(null);
  const sbOpen = openDrawer === 'scrapbook';
  const peopleOpen = openDrawer === 'people';
  const scenesOpen = openDrawer === 'scenes';
  const interopOpen = openDrawer === 'interop';
  /** Toggle: clicking the button for the open drawer closes it; clicking any
   *  other one switches to it. */
  const toggleDrawer = useCallback(
    (id: 'scrapbook' | 'people' | 'scenes' | 'interop') => setOpenDrawer((cur) => (cur === id ? null : id)),
    [],
  );
  /** Close one specific drawer — a no-op if a different one is open (or none),
   *  so an X button never reopens something else by accident. */
  const closeDrawer = useCallback(
    (id: 'scrapbook' | 'people' | 'scenes' | 'interop') => setOpenDrawer((cur) => (cur === id ? null : cur)),
    [],
  );
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCamera, setShareCamera] = useState<Camera | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ s: 'idle' });
  const lastSync = useRef(0);
  const flownToRef = useRef<string | null>(null);
  const introDone = useRef(false);
  /** Whether the URL's `?view=` has been honoured. Deliberately separate from
   *  `introDone`, which is reset every time a journey is played so the new
   *  story gets its own opening flight: a restored view is a fact about *this
   *  page load*, and re-applying it on every journey would fight the journey. */
  const openedDone = useRef(false);
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

  /**
   * Which authored scenes are included as journey stops, alongside collected
   * memories. A working choice like `selectedSceneId`, not a durable draft
   * like the scrapbook's `memoryIds` — it does not survive a reload. Deliberate:
   * unlike collecting a memory (one click, from anywhere, meant to stick), this
   * is made from inside the drawer you are about to act from, and re-checking a
   * few boxes costs less than the schema migration extending the persisted
   * `ScrapbookDraft` shape would have needed.
   */
  const [journeySceneIds, setJourneySceneIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggleJourneyScene = useCallback((id: string) => {
    setJourneySceneIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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

  /**
   * Where the globe is pointed, in degrees, or null if it is pointed at space.
   *
   * `pickEllipsoid` on the centre of the canvas rather than the camera's own
   * ground track: at an oblique pitch those are different places, and the one a
   * person means by "here" is the one in the middle of their screen. Falls back
   * to the camera's own position when the centre ray misses the globe entirely
   * (a horizon-grazing view), and returns null only when even that is
   * unreadable — which the caller reports rather than papering over with 0,0,
   * a spot in the Gulf of Guinea.
   */
  const viewCentre = useCallback((): { lat: number; lon: number } | null => {
    if (!viewer || viewer.isDestroyed()) return null;
    const { scene, camera } = viewer;
    const canvas = scene.canvas;
    const centre = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const hit = camera.pickEllipsoid(centre, scene.globe.ellipsoid);
    const carto = hit
      ? Cesium.Cartographic.fromCartesian(hit)
      : camera.positionCartographic;
    if (!carto || !Number.isFinite(carto.latitude) || !Number.isFinite(carto.longitude)) return null;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  }, [viewer]);

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
  //
  // Unless the URL asked for somewhere else. A shared or embedded link carries
  // `?view=` and `?t=`, and this effect is what they are up against: it runs a
  // beat after the restore and flies to the first memory instead, so without
  // the branch below the parameters are decoration — written by the share
  // panel, parsed on open, and then overridden before anyone sees them. The
  // clock needs the same treatment: `scrub` does not stop playback, so an
  // autoplaying story would walk straight off the requested moment on the next
  // tick.
  useEffect(() => {
    if (!viewer || !model || introDone.current) return;

    // `camera` OR `timeMs` — the two parameters are decoded independently
    // (`restoredView`), and gating the whole restore on the camera meant a
    // `?t=`-only link was parsed and then thrown away. That is not a
    // hypothetical URL: the share panel takes its camera from
    // `draw.captureCamera()`, which is null until the authoring controller
    // mounts, while `timeMs` is essentially always set — so Atlas could hand
    // out a link to a moment that its own reader ignored, and open at the
    // first memory instead.
    if ((opened.camera || opened.timeMs != null) && !openedDone.current) {
      openedDone.current = true;
      introDone.current = true;

      if (opened.timeMs != null) {
        // Clamped into the story's own window. `?t=` is attacker-supplied in an
        // embed and stale in a shared link — a story re-cut to a shorter span
        // still has to open somewhere it can show. Without this the scrubber
        // reads a date the globe is not displaying: `setCurrentMs` would take
        // the out-of-range value while Cesium's CLAMPED clock quietly holds the
        // playhead at the end.
        const { startMs, stopMs } = model.timeline;
        scrub(Math.min(Math.max(opened.timeMs, startMs), stopMs));
        pause();
      }

      // Claim the memory the clock is already standing on. The playback
      // fly-through fires on the very next tick and flies to `lastPassed`,
      // which — on any link that opens mid-story — is a memory somewhere else
      // entirely; it would take the camera off the view the link exists to
      // show, a second after arriving. Claiming it leaves playback free to
      // carry on to the *next* memory, which is what an autoplaying shared
      // link should do.
      const atMs = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();
      flownToRef.current = lastPassed(model.memories, atMs)?.id ?? flownToRef.current;

      // A time-only link still needs an opening shot, or the globe stays on
      // whatever the default view is while the clock sits on the right moment.
      // The first memory is the same answer the no-parameter path gives.
      if (!opened.camera) {
        const first = model.memories[0];
        if (first) { setFocusedId(first.id); flyTo(first); }
        return;
      }

      const pose = poseFromCamera(opened.camera);
      // Flown here rather than through `draw.flyToCamera`, which needs the
      // authoring controller — a thing an embed never mounts, and which arrives
      // a render late even in the full app. The opening shot must not depend on
      // the drawing layer existing.
      if (pose) {
        void viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromRadians(pose.longitude, pose.latitude, pose.height),
          orientation: { heading: pose.heading, pitch: pose.pitch, roll: pose.roll },
          duration: reduceMotion ? 0 : 1.6,
        });
      }
      return;
    }

    const first = model.memories[0];
    if (first) { introDone.current = true; select(first); }
  }, [viewer, model, select, scrub, pause, opened, reduceMotion, flyTo]);

  // ————— the scrapbook loop: collect → curate → play → save —————

  // While a journey plays, its scenes are re-ids of base memories. Map back by
  // membership (built when the journey is constructed) rather than by stripping
  // an `sb-` prefix — the exporter names every scene `sb-<id>`, so a downloaded
  // journey re-opened as the base story would have had its own ids mangled.
  const toBaseId = useCallback((id: string) => journeyMapRef.current.get(id) ?? id, []);
  const collected = useCallback((m: AtlasMemory) => sb.has(toBaseId(m.id)), [sb, toBaseId]);
  /** Whether a journey stop can be collected at all — it can only if its base
   *  id names something the scrapbook could ever resolve back to. A stop built
   *  from a scene checked into the journey (see `journeySceneMemories`) maps
   *  back to that SCENE's own id, which the base story need not contain — the
   *  scene lives in the editable deck, not necessarily in any saved document.
   *  Without this, collecting one would write an id `sbEntries` can never
   *  resolve into the persisted draft: not a crash, just a dead entry that
   *  accumulates in local storage forever with nothing on screen to explain
   *  it. */
  const canCollect = useCallback(
    (m: AtlasMemory) => !!baseModel?.memories.some((bm) => bm.id === toBaseId(m.id)),
    [baseModel, toBaseId],
  );
  const toggleCollect = useCallback((m: AtlasMemory) => {
    const id = toBaseId(m.id);
    if (sb.has(id)) { sb.remove(id); return; }
    if (!baseModel?.memories.some((bm) => bm.id === id)) return;
    sb.add(id);
  }, [sb, toBaseId, baseModel]);

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
    // Only one drawer can be open at once now, so "close whichever of these
    // sent us here" is just "close whatever is open".
    setOpenDrawer(null);
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

  // Authored scenes. Same account bucket as the layer stack and the drawing
  // tools, so two accounts on one browser never inherit each other's narration.
  const sceneControl = useScenes(memory?.url ?? null);

  /**
   * The selected scenes, converted to the same `AtlasMemory` shape a collected
   * memory already has — by actually running them through `deriveModel`,
   * rather than a second, hand-rolled version of its scene→memory mapping
   * (dates, local solar time, gradient, and the by-location join against real
   * media all live there once). Spreading the *base* story rather than
   * building a bare stand-in keeps that join meaningful — a scene camera that
   * happens to sit at a real photo's coordinates picks it up the same way a
   * memory-derived scene already does elsewhere.
   */
  const journeySceneMemories = useMemo(() => {
    if (journeySceneIds.size === 0 || !baseModel) return [];
    // `withImported`, not the bare base story: a photo uploaded straight into
    // a scene (`onScenePhotoUploaded`) lands in `imported.items`, exactly like
    // one uploaded from Import & export, and `deriveModel`'s media join below
    // is by location against `entities` — it has to see that item or an
    // uploaded photo silently would not survive a scene becoming a journey
    // stop, while the same photo shows up everywhere else the story is
    // rendered. Not `story` itself: that also layers the currently-PLAYING
    // journey on top when one is active, and deriving this scene's OWN journey
    // membership from the journey already in progress would be circular.
    const base = withImported(memImport?.story ?? loadedStory, imported.items);
    if (!base) return [];
    const selected = sceneControl.scenes.filter((sc) => journeySceneIds.has(sc.id));
    if (selected.length === 0) return [];
    return deriveModel({ ...base, scenes: selected }).memories;
  }, [journeySceneIds, sceneControl.scenes, baseModel, memImport, loadedStory, imported.items]);

  /**
   * Everything a journey is built from, in the one order that has to match
   * `curateJourney`/`buildScrapbookStory`'s own internal sort — see
   * `playStory`, which builds `journeyMapRef` by pairing `s.scenes[i]` with
   * `journeySources[i]` and silently mispairs the two the moment they disagree
   * about order.
   */
  const journeySources = useMemo(() => {
    // A collected memory and a checked-in scene can name the SAME id: when a
    // story already has scenes, `deriveModel` renders each one as an ordinary
    // pin (this is the primary "scenes become memories" path, unrelated to
    // this feature), so an author can Collect one of those pins from the
    // globe like any other memory — and, separately, check that identical
    // scene into the journey here. Neither route knows about the other, and
    // without de-duplication `curateJourney`/`buildScrapbookStory` would
    // receive the same id twice and write two scenes sharing one id in the
    // saved document. The checked-in scene wins: it is the more deliberate of
    // the two signals, carrying the scene's OWN narrative and camera rather
    // than whatever the pin happened to resolve to.
    const checkedIn = new Set(journeySceneMemories.map((m) => m.id));
    const memories = sbEntries.filter((m) => !checkedIn.has(m.id));
    return [...memories, ...journeySceneMemories].sort((a, b) => a.timeMs - b.timeMs);
  }, [sbEntries, journeySceneMemories]);

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
    // The top-nav visibility popover's "off" checkboxes. `hiddenCategories`
    // also carries 'photo' (the Images checkbox), which no drawn item is ever
    // typed as — harmless to pass through unfiltered.
    hiddenCategories,
    onSelect: (sel) => {
      if (sel?.kind === 'memory') setFocusedId(sel.id);
      else if (sel?.kind === 'place') setFocusedPlace(places.find((p) => p.id === sel.id) ?? null);
      // A note's on-globe label is cropped (see `cropNoteLabel`) — clicking it
      // is how the rest of the text is read. Any other selection (including
      // none) closes the card, the same way picking a different memory or
      // place replaces whichever one of those was showing.
      setFocusedNote(sel?.kind === 'item' && sel.item?.type === 'note' ? (sel.item as Item & { type: 'note' }) : null);
    },
  });

  // Also deselects in the authoring controller, not just the card's own React
  // state — otherwise `selection` stays pointed at the note (still drawn with
  // its "selected" mint styling, still a Delete-key target) and clicking the
  // SAME note again is a no-op: `onSelect` only fires on a kind/id change, and
  // neither would have changed, so the card could never reopen.
  const closeNote = useCallback(() => {
    setFocusedNote(null);
    draw.select(null);
  }, [draw]);

  /**
   * The document built from `journeySources` alone: collected memories and
   * checked-in scenes, chronologically — with layers and drawn shapes folded
   * in exactly as `draftStory` below always has. This is what gets PLAYED.
   *
   * It is deliberately narrower than `draftStory`, which also appends every
   * OTHER authored scene — right for Save, since nothing an author wrote
   * should be silently left out of what gets kept, and wrong for Play: this
   * function used to be the same one `draftStory` is now, so "Play journey"
   * played every authored scene whether it was checked into the journey or
   * not, which is what made checking a box accomplish nothing visible.
   */
  const journeyBase = useCallback(
    (curated: boolean): Story => {
      const entries = journeySources.map(toEntry);
      const opts = { visibility: sb.draft.visibility, title: sb.draft.title || undefined };
      const base = curated ? curateJourney(entries, opts) : buildScrapbookStory(entries, opts);
      const withItems = draw.items.length ? mergeAuthoredItems(base, draw.items) : base;
      // Non-null: `withStoryLayers` (what this wraps) returns null only for a
      // null input, and `base`/`withItems` are never null here.
      return layerControl.toStory(withItems)!;
    },
    [journeySources, sb.draft.visibility, sb.draft.title, draw.items, layerControl.toStory],
  );

  const draftStory = useCallback(
    (curated: boolean): Story | null => {
      // Authored scenes alone are enough to have something worth saving. This
      // used to be `sbEntries.length === 0`, so a user who wrote a five-scene
      // story and collected nothing got a disabled Save button — in the drawer
      // that holds the only Save button they would look for. A scene picked
      // into the journey is still one of `sceneControl.scenes`, so this already
      // covers "nothing collected, but some scenes are journey stops" too.
      if (sbEntries.length === 0 && sceneControl.count === 0) return null;
      // Everything that leaves the app carries everything on the globe.
      //
      // Layers and drawn shapes: see `journeyBase` above, which already folds
      // both in — because "localStorage is a convenience, not custody" applies
      // to a save exactly as much as to a play.
      //
      // And the authored deck — the scenes NOT already woven into the journey
      // as one of `journeySources`. Every scene used to be appended here
      // unconditionally, which is what a scene chosen for the journey would
      // still need if this stayed unfiltered: `buildScrapbookStory` re-ids a
      // journey entry as `sb-<id>`, so the same scene would then appear twice
      // — once in its rightful chronological place, once more tacked on the
      // end under its own id. Filtering by `journeySceneIds` is what keeps
      // each scene appearing exactly once, in the position the author
      // actually chose for it — and is the one place Save still legitimately
      // differs from Play: an unchecked scene is not a journey stop, but it
      // is still the author's work, and Save must not drop it.
      const remainingScenes = sceneControl.scenes.filter((sc) => !journeySceneIds.has(sc.id));
      return withAuthoredScenes(journeyBase(curated), remainingScenes, {
        adoptedFrom: sceneControl.adoptedFrom,
      });
    },
    [
      journeyBase, sbEntries.length, sceneControl.scenes, sceneControl.count,
      sceneControl.adoptedFrom, journeySceneIds,
    ],
  );

  const curate = useCallback(() => {
    // Nothing chosen for the journey — no collected memory, no scene checked
    // in — is nothing to curate, even if there are OTHER authored scenes that
    // would still make `draftStory` (Save) return something.
    if (journeySources.length === 0) return;
    const s = journeyBase(true);
    sb.setTitle(s.title);   // the Companion names the journey
    sb.setCurated(true);    // …and save/download must keep its work
    playStory(s, journeySources);
  }, [journeyBase, journeySources, sb, playStory]);

  const playScrapbook = useCallback(() => {
    if (journeySources.length === 0) return;
    playStory(journeyBase(sb.draft.curated), journeySources);
  }, [journeyBase, journeySources, sb.draft.curated, playStory]);

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
  //
  // Not bound at all in embed mode, and `preventDefault` is why: an iframe that
  // swallows ⌘K takes the shortcut away from the *host page* whenever the
  // pointer happens to be over the map. Whether Atlas would then show a palette
  // is beside the point — the key never reaches the page the reader is on.
  useEffect(() => {
    if (!chrome.commandPalette) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (lightboxRef.current) return;
        setPaletteOpen((o) => !o);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [chrome.commandPalette]);

  // Opens the share panel rather than copying straight to the clipboard. The
  // old handler copied `location.href`, which does not contain the view its
  // label promised, and swallowed every clipboard failure — a button that
  // silently does nothing. The pose is captured at the moment the panel opens,
  // because the camera keeps moving while the panel is up.
  const share = useCallback(() => {
    setShareCamera(draw.captureCamera());
    // Close the drawer the sheet is about to cover. Now that the share button
    // lives *inside* Import & export, the two are anchored to the same
    // top-right corner and the sheet is the wider of the pair — so it hid that
    // panel whole, including the button just pressed, while every control
    // underneath stayed in the tab order and reachable by keyboard. Same
    // one-drawer-at-a-time rule the rail follows for all four right-anchored
    // drawers — see `openDrawer`.
    closeDrawer('interop');
    setShareOpen(true);
  }, [draw, closeDrawer]);
  const closeShare = useCallback(() => setShareOpen(false), []);

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
  const closeScrapbook = useCallback(() => closeDrawer('scrapbook'), [closeDrawer]);
  const closePeople = useCallback(() => closeDrawer('people'), [closeDrawer]);
  const closeInterop = useCallback(() => closeDrawer('interop'), [closeDrawer]);

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
      setOpenDrawer('interop');
      if (result.items.length) frameAll();
    },
    [imported, frameAll],
  );
  const { dragging } = useFileDrop((files) => void takeFiles(files), chrome.interop);
  // Imported items have no scene, so no memory pin represents them — the
  // renderer needs to know not to filter their CZML away.
  const importedIds = useMemo(() => imported.items.map((i) => i.id), [imported.items]);


  // `scenesOpen` lives in `openDrawer`, declared with its three siblings above.
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  /** Feedback for the draw toolbar's own capture button — the created scene's
   *  title, or why nothing was created. Replaces the raw camera-pose readout
   *  that button used to print, which described a value nothing else read. */
  const [sceneCaptureNote, setSceneCaptureNote] = useState<string | null>(null);
  const selectedScene = sceneControl.scenes.find((sc) => sc.id === selectedSceneId) ?? null;
  const selectedSceneIndex = sceneControl.scenes.findIndex((sc) => sc.id === selectedSceneId);

  /**
   * A photo uploaded from inside the Scene editor still has to travel the same
   * road as any other upload — into `imported.items`, merged into the rendered
   * story — or `sceneMediaPool` (built from that story) would have nothing to
   * resolve the new attachment against. Unlike the Import & export panel's own
   * upload, this one does not `frameAll()` afterward: the point of uploading
   * from a scene is to keep working on that scene, not to be flown away from
   * it to survey everything on the globe.
   */
  const onScenePhotoUploaded = useCallback((file: ImportedFile) => { imported.add([file]); }, [imported]);

  /** Where a scene-context upload gets pinned: the scene's own declared view
   *  when it has one — a photo uploaded while writing a scene belongs to that
   *  scene's place even if the live camera has drifted elsewhere — and the
   *  live view centre otherwise, the same fallback the Import panel uses. */
  const sceneUploadPosition = useCallback((): { lat: number; lon: number } | null => {
    const loc = selectedScene?.camera;
    const lat = loc?.location?.lat ?? loc?.lat;
    const lon = loc?.location?.lon ?? loc?.lon;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat: lat as number, lon: lon as number };
    return viewCentre();
  }, [selectedScene, viewCentre]);

  const addScene = useCallback(() => {
    setSelectedSceneId(sceneControl.create().id);
  }, [sceneControl.create]);

  // "Capture this view" finally has somewhere to put the pose it has been
  // producing and discarding. `createFromCamera` returns null for a pose that
  // cannot be flown to — mid-flight, or the first frame — and adds nothing, so
  // the deck never gains a slide that goes nowhere.
  const addSceneFromView = useCallback(() => {
    const scene = sceneControl.createFromCamera(draw.captureCamera());
    if (scene) setSelectedSceneId(scene.id);
    return scene;
  }, [sceneControl.createFromCamera, draw.captureCamera]);

  /**
   * The draw toolbar's OWN "Capture this view" button — a second entry point
   * to the same act, for someone who is drawing rather than sitting in the
   * Scenes panel already.
   *
   * This used to call `useAuthoring`'s internal `captureCamera`, which stored
   * the pose in local state and printed it back as a read-only line nobody
   * consumed — `createFromCamera`'s own doc comment already named the intended
   * destination ("'Capture this view' → a new scene at the end of the deck")
   * for the *other* caller; this button just never reached it. Wired to the
   * same `addSceneFromView` the Scenes panel uses, so a captured view is a
   * scene whichever panel it was captured from, and the Scenes drawer opens
   * (rather than merely toggling) so the result is somewhere to look, not a
   * change that happened off-screen.
   */
  const captureSceneFromDraw = useCallback(() => {
    const scene = addSceneFromView();
    if (scene) {
      // Not reachable today — the two chrome profiles turn `drawing` and
      // `sceneAuthoring` on and off together — but this button is gated only
      // on the former, so it stays correct if a future profile ever lets them
      // diverge: opening a surface the chrome policy hides would wedge it
      // partway visible with no rail button left to close it.
      if (chrome.sceneAuthoring) setOpenDrawer('scenes');
      setSceneCaptureNote(`"${scene.title || 'Untitled scene'}" added to the deck.`);
    } else {
      setSceneCaptureNote(CAPTURE_UNSETTLED);
    }
  }, [addSceneFromView, chrome.sceneAuthoring]);

  const removeScene = useCallback((id: string) => {
    sceneControl.remove(id);
    setSelectedSceneId((cur) => (cur === id ? null : cur));
  }, [sceneControl.remove]);

  /**
   * The deck Present steps through: the authored scenes reconciled with the
   * open document by the same merge the export uses, so a preview and a
   * download cannot disagree about what the story is.
   *
   * Only the scene *array* leaves this memo. The merged `Story` exists for the
   * length of one expression and is never bound to anything the globe can
   * reach: `deriveModel` maps scenes into memories whenever `story.scenes` is
   * non-empty, so a rendered story carrying three authored scenes would
   * collapse a 500-memory archive to three pins, silently and with no error.
   */
  const presentedScenes = useMemo(
    () => sceneControl.toStory(story)?.scenes ?? [],
    [sceneControl.toStory, story],
  );

  /** What leaves the app: everything on the globe — drawn shapes, layers and
   *  the authored deck. The scrapbook's own Save is a different artifact with
   *  its own scenes, so it deliberately does not absorb these (see draftStory). */
  const exportStory = useMemo(
    // `story` is still nullable here — the loading/error guards sit below.
    // `toStory` returns its argument unchanged when the stack is empty, so a
    // user with no layers keeps today's object identity and the viewer does not
    // rebuild its CZML data source for nothing.
    () => sceneControl.toStory(
      layerControl.toStory(story && draw.items.length ? mergeAuthoredItems(story, draw.items) : story),
    ),
    [story, draw.items, layerControl.toStory, sceneControl.toStory],
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
    return <StoryLoadError error={error} memoryUrl={memory?.url} />;
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
    // `.atlas-app` reserves a 60px rail column and a 54px top-bar row in its
    // grid template, so hiding those components without collapsing the tracks
    // would inset an embedded globe inside an empty L-shaped band.
    <div className={`atlas-app${chrome.embedded ? ' is-embed' : ''}`}>
      <Starfield />
      <div className="atlas-aurora" aria-hidden="true" />
      {chrome.rail && (
      <Rail
        onFrameAll={frameAll}
        onDraw={() => setDrawing((d) => !d)}
        drawing={drawing}
        onPeople={() => toggleDrawer('people')}
        peopleOpen={peopleOpen}
        onCollections={() => toggleDrawer('scrapbook')}
        collectionsOpen={sbOpen}
        // Count what the drawer can actually show, so the badge can never claim
        // memories this story can't resolve.
        scrapbookCount={sbEntries.length}
        onPresent={() => setPresenting(true)}
        onScenes={() => toggleDrawer('scenes')}
        scenesOpen={scenesOpen}
        sceneCount={sceneControl.count}
        onInterop={() => toggleDrawer('interop')}
        interopOpen={interopOpen}
        // `memoryToStory` returns `scenes: []`, so gating on scenes hid Present
        // from every real story and left it reachable only from the bundled
        // demo. `buildDeck` now projects memories when a story has no authored
        // scenes, so the honest question is whether there is anything to show.
        canPresent={(story.scenes?.length ?? 0) > 0 || model.memories.length > 0}
        importedCount={imported.items.length}
      />
      )}
      {chrome.topBar && (
      <TopBar
        onSearch={() => setPaletteOpen(true)}
        // Framing sits with the projection control: both are about where you
        // are looking from. Drawing went back to the rail with the other
        // panel-openers.
        onFrameAll={frameAll}
        live={source === 'memory'}
        sample={isSample}
        showPlaces={showPlaces}
        onTogglePlaces={togglePlaces}
        sceneMode={sceneMode}
        onSceneMode={setSceneMode}
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
        visibility={(
          <VisibilityToggles
            open={visOpen}
            hidden={hiddenCategories}
            onToggleCategory={toggleVisibilityCategory}
            onToggle={() => setVisOpen((o) => !o)}
            onClose={() => setVisOpen(false)}
          />
        )}
      />
      )}
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
          sceneMode={sceneMode}
          reduceMotion={reduceMotion}
          timeMs={currentMs || model.timeline.startMs}
          extraItemIds={importedIds}
          hideJourneyRoute={draw.mode === 'note'}
          showImages={!hiddenCategories.has('photo')}
        />
        {(
          <div className="atlas-overlay">
            <StatsRibbon stats={model.stats} />
            <PlaceChip memory={currentPlace} />
            {chrome.scrapbook && (
              <ScrapbookFrames memories={scrapbook} hoveredId={hoveredId} onSelect={inspect} viewer={viewer} />
            )}
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
        focusedNote ? (
          <NoteCard note={focusedNote} onClose={closeNote} />
        ) : focusedPlace ? (
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
            // Offered when the embed policy allows collecting at all, AND
            // (it is already collected — so un-collecting always works — or
            // it could newly become collectible). A stop that resolves to
            // neither gets no button rather than one that silently does
            // nothing when pressed.
            onCollect={
              chrome.collect && focused && (collected(focused) || canCollect(focused))
                ? () => toggleCollect(focused)
                : undefined
            }
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
      {chrome.scrapbook && (
      <ScrapbookDrawer
        open={sbOpen}
        entries={sbEntries}
        title={sb.draft.title}
        visibility={sb.draft.visibility}
        canSave={!!memory}
        scenes={sceneControl.scenes}
        selectedSceneIds={journeySceneIds}
        onToggleScene={toggleJourneyScene}
        canClear={sb.count > 0}
        saveState={saveState}
        onClose={closeScrapbook}
        onTitle={sb.setTitle}
        onVisibility={sb.setVisibility}
        onRemove={sb.remove}
        // Clearing the scrapbook draft while leaving scenes checked into a
        // journey that no longer has a scrapbook draft to go with it would
        // leave the drawer half-reset. Clear resets both.
        onClear={() => { sb.clear(); setJourneySceneIds(new Set()); }}
        onCurate={curate}
        onPlay={playScrapbook}
        onSave={() => void saveScrapbook()}
        onDownload={downloadScrapbook}
      />
      )}
      {chrome.people && (
        <PeoplePanel open={peopleOpen} groups={peopleGroups} onClose={closePeople} onPlayPerson={playPersonJourney} />
      )}
      {chrome.commandPalette && (
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
      )}
      <Lightbox memory={lightbox} onClose={closeLightbox} />
      {chrome.drawing && (
        <AuthoringToolbar
          {...draw.toolbarProps}
          // Overrides the pass-through pair from `useAuthoring`: see
          // `captureSceneFromDraw`.
          onCaptureCamera={captureSceneFromDraw}
          capturedCamera={sceneCaptureNote}
        />
      )}
      {chrome.sceneAuthoring && scenesOpen && (
        <aside className="atlas-scenes" aria-label="Scene authoring">
          <SceneList
            scenes={sceneControl.scenes}
            selectedId={selectedSceneId}
            onSelect={setSelectedSceneId}
            onCreate={addScene}
            // Only offered once a controller is mounted on a live viewer:
            // before that there is no pose to capture and the control would be
            // a lie.
            onCaptureScene={draw.ready ? addSceneFromView : undefined}
            onRemove={removeScene}
            onMove={sceneControl.move}
            onMoveTo={sceneControl.moveTo}
            problems={sceneControl.problems}
            onClose={() => closeDrawer('scenes')}
          />
          <SceneEditor
            scene={selectedScene}
            index={selectedSceneIndex < 0 ? 0 : selectedSceneIndex}
            count={sceneControl.count}
            onPatch={(patch) => { if (selectedSceneId) sceneControl.update(selectedSceneId, patch); }}
            onRemove={() => { if (selectedSceneId) removeScene(selectedSceneId); }}
            onCaptureCamera={draw.captureCamera}
            problems={sceneControl.problems}
            // The *rendered* story, deliberately — the same object Presenter
            // builds its deck from. `sceneBackground` resolves an attached id
            // against this document's `items`/`media`, so offering candidates
            // from `exportStory` would let the author attach an entity the
            // presenter cannot see, and the slide would come back blank.
            story={story}
            uploadApi={ATLAS_API}
            onUploadPhoto={onScenePhotoUploaded}
            uploadPosition={sceneUploadPosition}
          />
        </aside>
      )}
      {chrome.interop && (
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
        // Sharing moved here from the top bar: a link and an iframe snippet are
        // ways of getting a view *out*, which is what this panel is. Passed
        // only when sharing is on, so the button cannot open a panel that the
        // chrome policy has already decided not to mount.
        onShare={chrome.share ? share : undefined}
        shareUrl={safeShareUrl}
        // Where an upload gets pinned: the middle of the view, read at the
        // moment the file is chosen.
        //
        // This was the focused memory, and the panel said "pinned where the
        // camera is looking" beside it — which was not true and diverged on the
        // very first load, with no user error required: the opening flight
        // frames `memories[0]` while `model.focused` defaults to
        // `memories[length - 1]`, so a photo added to a freshly opened story
        // landed on a different memory than the one on screen. Flying somewhere
        // else did not help, because a focused memory does not move with the
        // camera. A getter rather than a value because the camera moves between
        // renders and the answer must be the view at the moment of the pick.
        uploadPosition={viewCentre}
      />
      )}
      <Presenter
        story={story}
        open={presenting}
        onExit={exitPresent}
        onSceneEnter={presentScene}
        // The authored deck, reconciled for export. Kept out of `story` on
        // purpose — see `presentedScenes`.
        authoredScenes={presentedScenes}
        // Without these the presenter opens empty on any Memory story: the deck
        // is built from scenes, and a Memory archive has none.
        memories={model.memories}
        initialSceneId={focused?.id ?? null}
        reduceMotion={reduceMotion}
      />
      {chrome.interop && <DropOverlay visible={dragging} />}
      {chrome.share && (
        <SharePanel
          open={shareOpen}
          onClose={closeShare}
          href={window.location.href}
          camera={shareCamera}
          // The moment on screen, not `model.timeline.startMs` — a link that
          // reopened at the start of the archive would not be a link to "this
          // view" in any sense the button's label claims.
          timeMs={currentMs || null}
          // A memory-backed view cannot honestly be embedded: the credentials
          // are stripped on the way out (they have to be) and the reader would
          // get the bundled sample instead. The panel says so rather than
          // producing a snippet that renders somebody else's demo.
          privateSource={source === 'memory'}
          storyTitle={story.title}
          // The deck lives in local storage until it is saved or downloaded, and
          // a link carries neither. Saying so is the difference between sharing
          // a view and appearing to share a story.
          unsavedScenes={sceneControl.count}
        />
      )}
      {chrome.embedBar && (
        <EmbedBar
          title={story.title}
          // The same data question the rail asks — kept identical on purpose,
          // because a Present button that opens an empty deck is the failure
          // this bar exists to avoid.
          canPresent={(story.scenes?.length ?? 0) > 0 || model.memories.length > 0}
          onPresent={() => setPresenting(true)}
          presenting={presenting}
          href={window.location.href}
        />
      )}
    </div>
  );
}
