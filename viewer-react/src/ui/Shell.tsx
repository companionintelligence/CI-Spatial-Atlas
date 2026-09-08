import type { SceneModeName } from '../renderers/CesiumStoryViewer.js';
import {
  BrandMark, GlobeIcon, PeopleIcon, LayersIcon,
  SearchIcon, FlagIcon, ExchangeIcon, SlidesIcon, PencilIcon, PinIcon as FitIcon,
} from './icons.js';


/** Left icon rail. Globe navigates home; Places fits the camera to every memory;
 *  People opens the participants facet; Collections opens the scrapbook drawer;
 *  Scenes opens the deck editor; Present steps through the story's authored
 *  scenes; Import opens the KML/GeoJSON panel.
 *
 *  Search is NOT here — it lives in the top bar. Neither is "Fit all places",
 *  which sits beside the projection control: framing the camera on everything
 *  is the same kind of decision as choosing 3D or 2D — where you are looking
 *  from — rather than which panel is open. */
export function Rail({
  onFrameAll, onPeople, onCollections, scrapbookCount,
  onPresent, onInterop, canPresent, importedCount, onDraw, drawing,
  onScenes, scenesOpen, sceneCount,
}: {
  onPeople: () => void;
  onCollections: () => void;
  scrapbookCount: number;
  onPresent: () => void;
  onInterop: () => void;
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
}) {
  const items = [
    // The globe is home: it frames everything. "Fit all places" was a second
    // button doing exactly this a row below it, and it is the one that moved to
    // the top bar — where framing sits beside the projection control, because
    // both are decisions about where you are looking from.
    { key: 'globe', label: 'Globe — frame everything', Icon: GlobeIcon, onClick: onFrameAll, active: true },
    { key: 'draw', label: drawing ? 'Stop drawing' : 'Draw', Icon: PencilIcon, onClick: onDraw, active: drawing },
    { key: 'people', label: 'People', Icon: PeopleIcon, onClick: onPeople },
    { key: 'collections', label: 'Scrapbook', Icon: LayersIcon, onClick: onCollections, badge: scrapbookCount },
    { key: 'scenes', label: 'Scenes', Icon: FlagIcon, onClick: onScenes, active: scenesOpen, badge: sceneCount },
    ...(canPresent ? [{ key: 'present', label: 'Present', Icon: SlidesIcon, onClick: onPresent }] : []),
    { key: 'interop', label: 'Import & export', Icon: ExchangeIcon, onClick: onInterop, badge: importedCount },
  ];
  return (
    <nav className="atlas-rail" aria-label="Primary">
      <BrandMark className="atlas-mark" />
      {items.map(({ key, label, Icon, onClick, active, badge }) => (
        <button key={key} className={`atlas-rail-btn${active ? ' active' : ''}`} title={label} aria-label={badge ? `${label} (${badge})` : label} aria-current={active ? 'page' : undefined} onClick={onClick}>
          <Icon />
          {badge ? <span className="rail-badge" aria-hidden="true">{badge}</span> : null}
        </button>
      ))}
      <div className="atlas-rail-spacer" />
      {/* A disabled "Settings (coming soon)" button sat here. Chrome that can
          only be clicked to discover it does nothing is worse than absent —
          bring it back when there are settings. */}
      <div className="atlas-rail-avatar" title="Liam Broza">LB</div>
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
  onSearch, onFrameAll, live, sample, showPlaces, onTogglePlaces, layers,
  sceneMode = '3d', onSceneMode,
}: {
  onSearch: () => void;
  /** Frame the camera on every located memory. Beside the projection control
   *  because both answer "where am I looking from", not "what is on the map". */
  onFrameAll?: () => void;
  live?: boolean;
  /** Showing the bundled demo story because no Companion Memory is connected. */
  sample?: boolean;
  /** Named-places layer (CI-Server Places API) — off by default; the memory layer is primary. */
  showPlaces?: boolean;
  onTogglePlaces?: () => void;
  /** Map-layers control, rendered inline in the bar. */
  layers?: React.ReactNode;
  /** Projection. Sits beside the layer control because it is the same kind of
   *  decision — how the world is drawn, not what is on it. */
  sceneMode?: SceneModeName;
  onSceneMode?: (mode: SceneModeName) => void;
}) {
  return (
    <header className="atlas-top">
      <div className="atlas-wordmark"><b>Companion&nbsp;Atlas</b><span>your memories in space &amp; time</span></div>
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
          title="Named places (Companion Memory)"
          aria-label="Toggle named places"
          aria-pressed={!!showPlaces}
          onClick={onTogglePlaces}
        >
          <FlagIcon />
        </button>
      )}
      {layers}
      {onFrameAll && (
        <button
          className="atlas-icon-btn"
          title="Fit all places — frame every located memory"
          aria-label="Fit all places"
          onClick={onFrameAll}
        >
          <FitIcon />
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
          title={sceneMode === '3d' ? 'Switch to the flat map' : 'Switch to the globe'}
          aria-label={sceneMode === '3d' ? 'Switch to the flat map' : 'Switch to the globe'}
          onClick={() => onSceneMode(sceneMode === '3d' ? '2d' : '3d')}
        >
          {sceneMode === '3d' ? '2D' : '3D'}
        </button>
      )}
    </header>
  );
}
