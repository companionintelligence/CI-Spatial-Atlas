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

/** Top bar — wordmark, connection state, ⌘K search, places toggle, share. */
export function TopBar({ onSearch, onShare, live, sample, showPlaces, onTogglePlaces, layers }: {
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
      <button className="atlas-icon-btn" title="Copy link to this view" aria-label="Copy link to this view" onClick={onShare}><ShareIcon /></button>
    </header>
  );
}
