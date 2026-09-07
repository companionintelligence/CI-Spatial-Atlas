import type { SceneModeName } from '../renderers/CesiumStoryViewer.js';
import {
  BrandMark, GlobeIcon, PinIcon, PeopleIcon, LayersIcon, SparkIcon,
  SearchIcon, ShareIcon, FlagIcon, ExchangeIcon, SlidesIcon, PlusIcon,
} from './icons.js';


/** Left icon rail. Globe navigates home; Places fits the camera to every memory;
 *  People opens the participants facet; Collections opens the scrapbook drawer;
 *  Search opens ⌘K; Present steps through the story's authored scenes; Import
 *  opens the KML/GeoJSON panel. */
export function Rail({
  onSearch, onFrameAll, onPeople, onCollections, scrapbookCount,
  onPresent, onInterop, canPresent, importedCount, onDraw, drawing,
  onScenes, scenesOpen, sceneCount,
}: {
  onSearch: () => void;
  onFrameAll: () => void;
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
  onScenes: () => void;
  scenesOpen: boolean;
  /** Badge, and the honest signal that a story is being written. */
  sceneCount: number;
  /** Armed state, so the rail shows a tool is active — a drawing mode that
   *  looks identical to browsing is how people lose a click. */
  drawing: boolean;
}) {
  const items = [
    { key: 'globe', label: 'Globe', Icon: GlobeIcon, onClick: onFrameAll, active: true },
    { key: 'places', label: 'Fit all places', Icon: PinIcon, onClick: onFrameAll },
    { key: 'people', label: 'People', Icon: PeopleIcon, onClick: onPeople },
    { key: 'collections', label: 'Scrapbook', Icon: LayersIcon, onClick: onCollections, badge: scrapbookCount },
    { key: 'search', label: 'Search', Icon: SparkIcon, onClick: onSearch },
    { key: 'draw', label: drawing ? 'Stop drawing' : 'Draw', Icon: PlusIcon, onClick: onDraw, active: drawing },
    // Scenes sits beside Draw rather than beside Present: writing the story and
    // drawing on it are both authoring, and Present is what you do afterwards.
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

/** Top bar — wordmark, connection state, ⌘K search, places toggle, share. */
export function TopBar({
  onSearch, onShare, live, sample, showPlaces, onTogglePlaces, layers,
  sceneMode = '3d', onSceneMode,
}: {
  onSearch: () => void;
  onShare: () => void;
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
      <button className="atlas-search" aria-label="Search memories (Command K)" onClick={onSearch}>
        <SearchIcon /><span>Jump to a place, date, person…</span><span className="kbd">⌘K</span>
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
      <button className="atlas-icon-btn" title="Copy link to this view" aria-label="Copy link to this view" onClick={onShare}><ShareIcon /></button>
    </header>
  );
}
