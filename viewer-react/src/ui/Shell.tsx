import {
  BrandMark, GlobeIcon, PinIcon, PeopleIcon, LayersIcon, SparkIcon, GearIcon,
  ImagesIcon, ClockIcon, GraphIcon, SearchIcon, ShareIcon, MoonIcon,
} from './icons.js';

export type AtlasView = 'globe' | 'gallery' | 'timeline' | 'graph';

/** Left icon rail. Globe navigates home; Places fits the camera to every memory;
 *  Search opens ⌘K. People/Collections are honest placeholders until those
 *  memory facets land. */
export function Rail({ view, onView, onSearch, onFrameAll }: {
  view: AtlasView;
  onView: (v: AtlasView) => void;
  onSearch: () => void;
  onFrameAll: () => void;
}) {
  const items = [
    { key: 'globe', label: 'Globe', Icon: GlobeIcon, onClick: () => onView('globe'), active: view === 'globe' },
    { key: 'places', label: 'Fit all places', Icon: PinIcon, onClick: onFrameAll },
    { key: 'people', label: 'People (coming soon)', Icon: PeopleIcon, disabled: true },
    { key: 'collections', label: 'Collections (coming soon)', Icon: LayersIcon, disabled: true },
    { key: 'search', label: 'Search', Icon: SparkIcon, onClick: onSearch },
  ];
  return (
    <nav className="atlas-rail" aria-label="Primary">
      <BrandMark className="atlas-mark" />
      {items.map(({ key, label, Icon, onClick, active, disabled }) => (
        <button key={key} className={`atlas-rail-btn${active ? ' active' : ''}`} title={label} aria-label={label} aria-current={active ? 'page' : undefined} onClick={onClick} disabled={disabled}>
          <Icon />
        </button>
      ))}
      <div className="atlas-rail-spacer" />
      <button className="atlas-rail-btn" title="Settings (coming soon)" aria-label="Settings" disabled><GearIcon /></button>
      <div className="atlas-rail-avatar" title="Liam Broza">LB</div>
    </nav>
  );
}

/** Top bar — wordmark, view switcher, ⌘K search, share. */
export function TopBar({ view, onView, onSearch, onShare, live }: { view: AtlasView; onView: (v: AtlasView) => void; onSearch: () => void; onShare: () => void; live?: boolean }) {
  const tabs: { key: AtlasView; label: string; Icon: typeof GlobeIcon }[] = [
    { key: 'globe', label: 'Globe', Icon: GlobeIcon },
    { key: 'gallery', label: 'Gallery', Icon: ImagesIcon },
    { key: 'timeline', label: 'Timeline', Icon: ClockIcon },
    { key: 'graph', label: 'Graph', Icon: GraphIcon },
  ];
  return (
    <header className="atlas-top">
      <div className="atlas-wordmark"><b>Companion&nbsp;Atlas</b><span>your memories in space &amp; time</span></div>
      {live && <span className="atlas-live" title="Connected to Companion Memory"><i />Live memory</span>}
      <div className="switch" role="group" aria-label="View">
        {tabs.map(({ key, label, Icon }) => (
          <button key={key} aria-pressed={view === key} className={view === key ? 'active' : ''} onClick={() => onView(key)}>
            <Icon />{label}
          </button>
        ))}
      </div>
      <div className="atlas-grow" />
      <button className="atlas-search" aria-label="Search memories (Command K)" onClick={onSearch}>
        <SearchIcon /><span>Jump to a place, date, person…</span><span className="kbd">⌘K</span>
      </button>
      <button className="atlas-icon-btn" title="Copy link to this view" aria-label="Copy link to this view" onClick={onShare}><ShareIcon /></button>
      <button className="atlas-icon-btn" title="Theme (coming soon)" aria-label="Theme" disabled><MoonIcon /></button>
    </header>
  );
}
