import {
  BrandMark, GlobeIcon, PinIcon, PeopleIcon, LayersIcon, SparkIcon, GearIcon,
  ImagesIcon, ClockIcon, GraphIcon, SearchIcon, ShareIcon, MoonIcon,
} from './icons.js';

export type AtlasView = 'globe' | 'gallery' | 'timeline' | 'graph';

/** Left icon rail — Globe / Places / People / Collections / Search + Settings. */
export function Rail() {
  const items = [
    { key: 'globe', label: 'Globe', Icon: GlobeIcon, active: true },
    { key: 'places', label: 'Places', Icon: PinIcon },
    { key: 'people', label: 'People', Icon: PeopleIcon },
    { key: 'collections', label: 'Collections', Icon: LayersIcon },
    { key: 'search', label: 'Search', Icon: SparkIcon },
  ];
  return (
    <nav className="atlas-rail" aria-label="Primary">
      <BrandMark className="atlas-mark" />
      {items.map(({ key, label, Icon, active }) => (
        <button key={key} className={`atlas-rail-btn${active ? ' active' : ''}`} title={label} aria-label={label} aria-current={active ? 'page' : undefined}>
          <Icon />
        </button>
      ))}
      <div className="atlas-rail-spacer" />
      <button className="atlas-rail-btn" title="Settings" aria-label="Settings"><GearIcon /></button>
      <div className="atlas-rail-avatar" title="Liam Broza">LB</div>
    </nav>
  );
}

/** Top bar — wordmark, view switcher, ⌘K search, theme + share. */
export function TopBar({ view, onView }: { view: AtlasView; onView: (v: AtlasView) => void }) {
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
      <div className="atlas-search" role="button" tabIndex={0} aria-label="Search memories">
        <SearchIcon /><span>Jump to a place, date, person…</span><span className="kbd">⌘K</span>
      </div>
      <button className="atlas-icon-btn" title="Share view" aria-label="Share view"><ShareIcon /></button>
      <button className="atlas-icon-btn" title="Theme" aria-label="Toggle theme"><MoonIcon /></button>
    </header>
  );
}
