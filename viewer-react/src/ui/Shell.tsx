import {
  BrandMark, GlobeIcon, PinIcon, PeopleIcon, LayersIcon, SparkIcon, GearIcon,
  ImagesIcon, ClockIcon, GraphIcon, SearchIcon, ShareIcon, MoonIcon,
} from './icons.js';

export type AtlasView = 'globe' | 'gallery' | 'timeline' | 'graph';

/** Left icon rail — Globe navigates; Places/People/Collections/Search open the
 *  command palette (the browse/search surface). */
export function Rail({ view, onView, onSearch }: { view: AtlasView; onView: (v: AtlasView) => void; onSearch: () => void }) {
  const items = [
    { key: 'globe', label: 'Globe', Icon: GlobeIcon, onClick: () => onView('globe'), active: view === 'globe' },
    { key: 'places', label: 'Places', Icon: PinIcon, onClick: onSearch },
    { key: 'people', label: 'People', Icon: PeopleIcon, onClick: onSearch },
    { key: 'collections', label: 'Collections', Icon: LayersIcon, onClick: onSearch },
    { key: 'search', label: 'Search', Icon: SparkIcon, onClick: onSearch },
  ];
  return (
    <nav className="atlas-rail" aria-label="Primary">
      <BrandMark className="atlas-mark" />
      {items.map(({ key, label, Icon, onClick, active }) => (
        <button key={key} className={`atlas-rail-btn${active ? ' active' : ''}`} title={label} aria-label={label} aria-current={active ? 'page' : undefined} onClick={onClick}>
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
export function TopBar({ view, onView, onSearch, onShare }: { view: AtlasView; onView: (v: AtlasView) => void; onSearch: () => void; onShare: () => void }) {
  const tabs: { key: AtlasView; label: string; Icon: typeof GlobeIcon }[] = [
    { key: 'globe', label: 'Globe', Icon: GlobeIcon },
    { key: 'gallery', label: 'Gallery', Icon: ImagesIcon },
    { key: 'timeline', label: 'Timeline', Icon: ClockIcon },
    { key: 'graph', label: 'Graph', Icon: GraphIcon },
  ];
  return (
    <header className="atlas-top">
      <div className="atlas-wordmark"><b>Companion&nbsp;Atlas</b><span>your memories in space &amp; time</span></div>
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
