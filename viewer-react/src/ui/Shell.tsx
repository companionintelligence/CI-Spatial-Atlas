import {
  BrandMark, GlobeIcon, PinIcon, PeopleIcon, LayersIcon, SparkIcon, GearIcon,
  SearchIcon, ShareIcon, MoonIcon, FlagIcon,
} from './icons.js';


/** Left icon rail. Globe navigates home; Places fits the camera to every memory;
 *  People opens the participants facet; Collections opens the scrapbook drawer;
 *  Search opens ⌘K. */
export function Rail({ onSearch, onFrameAll, onPeople, onCollections, scrapbookCount }: {
  onSearch: () => void;
  onFrameAll: () => void;
  onPeople: () => void;
  onCollections: () => void;
  scrapbookCount: number;
}) {
  const items = [
    { key: 'globe', label: 'Globe', Icon: GlobeIcon, onClick: onFrameAll, active: true },
    { key: 'places', label: 'Fit all places', Icon: PinIcon, onClick: onFrameAll },
    { key: 'people', label: 'People', Icon: PeopleIcon, onClick: onPeople },
    { key: 'collections', label: 'Scrapbook', Icon: LayersIcon, onClick: onCollections, badge: scrapbookCount },
    { key: 'search', label: 'Search', Icon: SparkIcon, onClick: onSearch },
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
      <button className="atlas-rail-btn" title="Settings (coming soon)" aria-label="Settings" disabled><GearIcon /></button>
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
      <button className="atlas-icon-btn" title="Theme (coming soon)" aria-label="Theme" disabled><MoonIcon /></button>
    </header>
  );
}
