import type { SceneModeName } from '../renderers/CesiumStoryViewer.js';
import { NEARBY_RADIUS_METRES } from '../location/logic.js';
import {
  BrandMark, GlobeIcon, PeopleIcon, ImagesIcon, CameraIcon,
  SearchIcon, ExchangeIcon, SlidesIcon, PencilIcon, PinIcon as FitIcon, ARIcon,
  LocateIcon, BellIcon, CloudIcon,
} from './icons.js';

/** Left icon rail. Globe navigates home; Draw arms the drawing tools; People
 *  opens the participants facet; Collections opens the scrapbook drawer; Scenes
 *  opens the deck editor; Present steps through the story's authored scenes;
 *  Import opens the KML/GeoJSON panel.
 *
 *  People, Collections, Scenes and Import are mutually exclusive — the caller
 *  guarantees at most one of their `*Open` props is true at a time (see
 *  `openDrawer` in `AtlasApp`), because all four panels render at the same
 *  anchored spot on screen. Each button's `active` state reflects that flag
 *  directly, rather than the earlier version, which showed no open/closed
 *  state at all for three of the four and showed the Globe button as
 *  permanently "current" regardless of what was actually open.
 *
 *  Search is NOT here — it lives in the top bar. Neither is "Fit all places",
 *  which sits beside the projection control: framing the camera on everything
 *  is the same kind of decision as choosing 3D or 2D — where you are looking
 *  from — rather than which panel is open. */
export function Rail({
  onFrameAll, onPeople, peopleOpen, onCollections, collectionsOpen, scrapbookCount,
  onPresent, onInterop, interopOpen, canPresent, importedCount, onDraw, drawing,
  onScenes, scenesOpen, sceneCount, onMemory, memoryConnected, memoryOpen,
}: {
  onPeople: () => void;
  peopleOpen: boolean;
  onCollections: () => void;
  collectionsOpen: boolean;
  scrapbookCount: number;
  onPresent: () => void;
  onInterop: () => void;
  interopOpen: boolean;
  /** A story with no authored scenes has nothing to present — the control is
   *  hidden rather than shown disabled, for the same reason the old "Settings
   *  (coming soon)" button was removed below. */
  canPresent: boolean;
  importedCount: number;
  onDraw: () => void;
  /** Armed state, so the rail shows a tool is live — a drawing mode that looks
   *  identical to browsing is how people lose a click. */
  drawing: boolean;
  onFrameAll: () => void;
  onScenes: () => void;
  scenesOpen: boolean;
  /** Badge, and the honest signal that a story is being written. */
  sceneCount: number;
  /** Native shell only: opens the connect dialog. Omitted in a browser, which has no Keychain. */
  onMemory?: () => void;
  memoryConnected?: boolean;
  memoryOpen?: boolean;
}) {
  const items = [
    // The globe is home: it frames everything. "Fit all places" was a second
    // button doing exactly this a row below it, and it is the one that moved to
    // the top bar — where framing sits beside the projection control, because
    // both are decisions about where you are looking from. It is an action,
    // not a toggle, so it never shows `active` — it used to, unconditionally,
    // which meant Globe stayed lit the whole session no matter what was
    // actually open, the first thing that made this rail read as unreliable.
    { key: 'globe', label: 'Globe — frame everything', short: 'Globe', Icon: GlobeIcon, onClick: onFrameAll },
    { key: 'draw', label: drawing ? 'Stop drawing' : 'Draw', short: drawing ? 'Stop' : 'Draw', Icon: PencilIcon, onClick: onDraw, active: drawing },
    { key: 'people', label: 'People', short: 'People', Icon: PeopleIcon, onClick: onPeople, active: peopleOpen },
    { key: 'collections', label: 'Scrapbook', short: 'Scrapbook', Icon: ImagesIcon, onClick: onCollections, active: collectionsOpen, badge: scrapbookCount },
    { key: 'scenes', label: 'Scenes', short: 'Scenes', Icon: CameraIcon, onClick: onScenes, active: scenesOpen, badge: sceneCount },
    ...(canPresent ? [{ key: 'present', label: 'Present', short: 'Present', Icon: SlidesIcon, onClick: onPresent }] : []),
    { key: 'interop', label: 'Import & export', short: 'Import', Icon: ExchangeIcon, onClick: onInterop, active: interopOpen, badge: importedCount },
    ...(onMemory ? [{
      key: 'memory',
      label: memoryConnected ? 'Companion Memory: connected' : 'Connect to Companion Memory',
      short: memoryConnected ? 'Memory' : 'Connect',
      Icon: CloudIcon,
      onClick: onMemory,
      active: memoryOpen,
    }] : []),
  ];
  return (
    <nav className="atlas-rail" aria-label="Primary">
      <BrandMark className="atlas-mark" />
      {items.map(({ key, label, short, Icon, onClick, active, badge }) => (
        <button key={key} className={`atlas-rail-btn${active ? ' active' : ''}`} data-label={short} title={label} aria-label={badge ? `${label} (${badge})` : label} aria-current={active ? 'page' : undefined} onClick={onClick}>
          <Icon />
          {badge ? <span className="rail-badge" aria-hidden="true">{badge}</span> : null}
        </button>
      ))}
      <div className="atlas-rail-spacer" />
      {/* A disabled "Settings (coming soon)" button sat here. Chrome that can
          only be clicked to discover it does nothing is worse than absent —
          bring it back when there are settings. The owner's initials sat here
          too, shown to every visitor as if they were signed in; bring an avatar
          back once there is a signed-in user to show. */}
    </nav>
  );
}

const SCENE_MODES: { id: SceneModeName; short: string; label: string }[] = [
  { id: '3d', short: '3D', label: 'Globe — the world as a sphere' },
  { id: 'columbus', short: '2.5D', label: 'Flat map with height — keeps 3D tilesets and raised tracks readable' },
  { id: '2d', short: '2D', label: 'Flat map — best for routes, boundaries and places' },
];

/** Top bar — wordmark, connection state, and the right-hand cluster of things
 *  you can do to the view: search, named places, layers, fit-all, projection.
 *  All icons, all the same size, in one row.
 *
 *  Drawing is NOT here — it went back to the rail, with the other controls that
 *  open a panel. What is left changes where you look or what is drawn over the
 *  world; drawing changes the world itself.
 *
 *  Sharing is NOT here: a link and an `<iframe>` snippet are ways of getting a
 *  view out of Atlas, which is what the Import & export panel is for, and that
 *  panel is where the other three exits already live. */
export function TopBar({
  onSearch, onFrameAll, onViewInAR, live, sample, showPlaces, onTogglePlaces, layers, visibility,
  sceneMode = '3d', onSceneMode,
  locating = false, onToggleLocating, nearby = false, onToggleNearby, deviceNote,
}: {
  onSearch: () => void;
  /** Frame the camera on every located memory. Beside the projection control
   *  because both answer "where am I looking from", not "what is on the map". */
  onFrameAll?: () => void;
  /** Reload into the AR entry. Passed only where the device can start AR and the
   *  page is not in an iOS WebView (see `useViewInAR`); absent means no control. */
  onViewInAR?: () => void;
  /** "Show my location": on while the device position is tracked in the
   *  foreground. Its pressed state is the switch, not the fix. */
  locating?: boolean;
  onToggleLocating?: () => void;
  /** "Nearby memories": on while a located memory within reach raises a local
   *  notification. Turning it on asks for notification access. */
  nearby?: boolean;
  onToggleNearby?: () => void;
  /** A short message about the location or notification controls, when the
   *  user has to act (permission refused, no position, and so on). */
  deviceNote?: string | null;
  live?: boolean;
  /** Showing the bundled demo story because no Companion Memory is connected. */
  sample?: boolean;
  /** Named-places layer (CI-Server Places API) — off by default; the memory layer is primary. */
  showPlaces?: boolean;
  onTogglePlaces?: () => void;
  /** Map-layers control, rendered inline in the bar. */
  layers?: React.ReactNode;
  /** The notes/pins/outlines/areas/images visibility popover, rendered inline
   *  next to `layers` — the same kind of decision (what's drawn), answered by
   *  a different control (see `VisibilityToggles`). */
  visibility?: React.ReactNode;
  /** Projection. Sits beside the layer control because it is the same kind of
   *  decision — how the world is drawn, not what is on it. */
  sceneMode?: SceneModeName;
  onSceneMode?: (mode: SceneModeName) => void;
}) {
  return (
    <header className="atlas-top">
      <div className="atlas-wordmark"><BrandMark className="atlas-top-mark" gradientId="atlas-bm-top" aria-hidden="true" /><b>Companion&nbsp;Atlas</b><span>your memories in space &amp; time</span></div>
      {live && <span className="atlas-live" title="Connected to Companion Memory"><i />Live memory</span>}
      {sample && (
        <span
          className="atlas-sample"
          title="Not connected to Companion Memory. These are bundled demo places, not your memories. Pass ?memory=<ci-server-url> to load real data."
        >
          <i />Demo data — not connected
        </span>
      )}
      <div className="atlas-grow" />
      {/* Search was a 340px box pretending to be a text field — clicking it
          opened a palette that has its own input, so the bar carried a second
          one that could never be typed into. As an icon it costs a fifth of the
          width and stops making a promise the control does not keep; ⌘K is on
          the label, which is where the palette's own hint already lives. */}
      <button
        className="atlas-icon-btn"
        data-label="Search"
        title="Search — ⌘K"
        aria-label="Search memories (Command K)"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={onSearch}
      >
        <SearchIcon />
      </button>
      {onTogglePlaces && (
        <button
          className="atlas-icon-btn"
          data-label="Places"
          title="Named places (Companion Memory)"
          aria-label="Toggle named places"
          aria-pressed={!!showPlaces}
          onClick={onTogglePlaces}
        >
          <FitIcon />
        </button>
      )}
      {layers}
      {visibility}
      {onFrameAll && (
        <button
          className="atlas-icon-btn atlas-fit-all"
          title="Fit all places — frame every located memory"
          aria-label="Fit all places"
          onClick={onFrameAll}
        >
          <FitIcon />
        </button>
      )}
      {onViewInAR && (
        // Beside fit-all: both change where the world is seen from. Activating it
        // reloads the page in the AR entry, so the renderer is never switched
        // under a mounted globe.
        <button
          className="atlas-icon-btn"
          data-label="AR"
          title="View in AR — place the globe in your room"
          aria-label="View in AR"
          onClick={onViewInAR}
        >
          <ARIcon />
        </button>
      )}
      {onToggleLocating && (
        <button
          type="button"
          className="atlas-icon-btn"
          data-label="Locate"
          title="Show my location"
          aria-label="Show my location"
          aria-pressed={locating}
          onClick={onToggleLocating}
        >
          <LocateIcon />
        </button>
      )}
      {onToggleNearby && (
        <button
          type="button"
          className="atlas-icon-btn"
          data-label="Alerts"
          title={`Nearby memories — alert me within ${NEARBY_RADIUS_METRES} m`}
          aria-label="Nearby memories"
          aria-pressed={nearby}
          onClick={onToggleNearby}
        >
          <BellIcon />
        </button>
      )}
      {onSceneMode && (
        // A three-way segmented control rather than a 2D/3D toggle: Columbus is
        // a real third answer — a flat map that still has height, which is
        // where a 3D tileset or a raised track still reads and plain 2D
        // flattens it away. A toggle would have hidden it or dropped it.
        <div className="atlas-scenemode" role="group" aria-label="Projection">
          {SCENE_MODES.map(({ id, short, label }) => (
            <button
              key={id}
              type="button"
              className={`atlas-scenemode-btn${sceneMode === id ? ' active' : ''}`}
              data-mode={id}
              aria-pressed={sceneMode === id}
              title={label}
              aria-label={label}
              onClick={() => onSceneMode(id)}
            >
              {short}
            </button>
          ))}
        </div>
      )}
      {onSceneMode && (
        // The same capability in one button, for a bar too narrow to hold
        // three. Which of the two is shown is a CSS decision (see atlas.css);
        // both are always in the DOM, so nothing here depends on measuring the
        // viewport in JavaScript. A cycle button is a weaker affordance than a
        // segmented control — you cannot see the options — so the label says
        // where it goes, not where it is.
        <button
          type="button"
          className="atlas-scenemode-cycle"
          data-label={sceneMode === '3d' ? 'Flat' : 'Globe'}
          title={sceneMode === '3d' ? 'Switch to the flat map' : 'Switch to the globe'}
          aria-label={sceneMode === '3d' ? 'Switch to the flat map' : 'Switch to the globe'}
          onClick={() => onSceneMode(sceneMode === '3d' ? '2d' : '3d')}
        >
          {sceneMode === '3d' ? '2D' : '3D'}
        </button>
      )}
      {deviceNote && <span className="atlas-device-note" role="status">{deviceNote}</span>}
    </header>
  );
}
