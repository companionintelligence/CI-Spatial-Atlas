import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type SVGProps } from 'react';
import { BASEMAPS } from '../renderers/basemaps.js';
import { BuildingIcon, LayersIcon, PlusIcon, SearchIcon, SunIcon } from './icons.js';
import {
  describeAvailability,
  FORMAT_META,
  isAvailableAt,
  LAYER_FORMATS,
  matchesQuery,
  searchCatalog,
  type AtlasLayer,
  type CatalogEntry,
  type LayerControl,
  type LayerFormat,
} from '../layers/index.js';
import { LAYER_CATALOG } from '../layers/catalog.js';
import '../layers/layers.css';

/**
 * Basemap picker, sun toggle — and the layer manager.
 *
 * It stays one popover because all of it answers the same question: what is on
 * the globe right now. Three tabs rather than three panels stacked in one
 * scroll, because the stack can be long and the basemap swatches must not
 * disappear off the top of it.
 *
 * **The layer manager is optional.** Everything to do with layers hangs off the
 * single `layers` prop (a `LayerControl`, which `useLayers()` returns). Without
 * it this renders exactly what it always did — one basemap panel, no tabs — so
 * the control can be wired up in `AtlasApp` in its own commit, and so a surface
 * that has no layer stack (a share preview, a screenshot harness) is not forced
 * to invent one.
 */
export function MapLayers({
  open, basemap, sunLighting, buildings, buildingsAvailable,
  onBasemap, onToggleSun, onToggleBuildings, onToggle, onClose,
  layers, catalog = LAYER_CATALOG,
}: {
  open: boolean;
  basemap: string;
  sunLighting: boolean;
  buildings: boolean;
  /** False when no Google key is configured — the control explains itself. */
  buildingsAvailable: boolean;
  onBasemap: (id: string) => void;
  onToggleSun: () => void;
  onToggleBuildings: () => void;
  onToggle: () => void;
  onClose: () => void;
  /** The layer stack. Omit to render the original basemap-only popover. */
  layers?: LayerControl;
  /** Override the built-in catalog (tests, or a deployment with its own set). */
  catalog?: CatalogEntry[];
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<PanelTab>('basemap');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // `pointerdown` on the document also fires for the Cesium canvas, so a click
    // on the globe dismisses the panel the same way clicking off any menu does.
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, onClose]);

  return (
    <div className="atlas-layers" ref={popRef}>
      <button
        className="atlas-icon-btn"
        aria-label="Map layers"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Map layers"
        onClick={onToggle}
      >
        <LayersIcon />
      </button>

      {open && (
        <div className={`atlas-layers-pop${layers ? ' has-manager' : ''}`} role="dialog" aria-label="Map layers">
          {layers && (
            <div className="laym-tabs" role="tablist" aria-label="Layer panels">
              <Tab id="basemap" current={tab} onSelect={setTab}>Basemap</Tab>
              <Tab id="layers" current={tab} onSelect={setTab} count={layers.count}>Layers</Tab>
              <Tab id="catalog" current={tab} onSelect={setTab}>Catalog</Tab>
            </div>
          )}

          {(!layers || tab === 'basemap') && (
            <div role={layers ? 'tabpanel' : undefined} aria-label="Basemap">
              <BasemapPanel
                basemap={basemap}
                sunLighting={sunLighting}
                buildings={buildings}
                buildingsAvailable={buildingsAvailable}
                onBasemap={onBasemap}
                onToggleSun={onToggleSun}
                onToggleBuildings={onToggleBuildings}
              />
            </div>
          )}

          {layers && tab === 'layers' && (
            <div role="tabpanel" aria-label="Layers">
              <LayerStackPanel control={layers} />
            </div>
          )}

          {layers && tab === 'catalog' && (
            <div role="tabpanel" aria-label="Catalog">
              <CatalogPanel control={layers} catalog={catalog} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type PanelTab = 'basemap' | 'layers' | 'catalog';

function Tab({ id, current, onSelect, count, children }: {
  id: PanelTab;
  current: PanelTab;
  onSelect: (t: PanelTab) => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      className="laym-tab"
      role="tab"
      type="button"
      aria-selected={current === id}
      onClick={() => onSelect(id)}
    >
      {children}
      {count ? <span className="laym-count">{count}</span> : null}
    </button>
  );
}

/** The original popover contents, unchanged apart from being lifted into their
 *  own component so the tabs can switch between panels. */
function BasemapPanel({ basemap, sunLighting, buildings, buildingsAvailable, onBasemap, onToggleSun, onToggleBuildings }: {
  basemap: string;
  sunLighting: boolean;
  buildings: boolean;
  buildingsAvailable: boolean;
  onBasemap: (id: string) => void;
  onToggleSun: () => void;
  onToggleBuildings: () => void;
}) {
  return (
    <>
      <div className="lay-head">Basemap</div>
      <div className="lay-grid">
        {BASEMAPS.map((b) => (
          <button
            key={b.id}
            className={`lay-opt${b.id === basemap ? ' active' : ''}`}
            aria-pressed={b.id === basemap}
            onClick={() => onBasemap(b.id)}
          >
            <span className={`lay-swatch lay-${b.id}`} aria-hidden="true" />
            <span className="lay-label">{b.label}</span>
            <span className="lay-hint">{b.hint}</span>
          </button>
        ))}
      </div>

      <div className="lay-head">Terrain</div>
      <button
        className={`lay-row${buildings ? ' active' : ''}`}
        aria-pressed={buildings}
        disabled={!buildingsAvailable}
        onClick={onToggleBuildings}
      >
        <BuildingIcon />
        <span className="lay-label">3D buildings</span>
        <span className="lay-hint">
          {!buildingsAvailable
            ? 'Needs a Google Maps key'
            : buildings
              ? 'Google Photorealistic 3D Tiles'
              : 'Real building geometry'}
        </span>
      </button>

      <div className="lay-head">Lighting</div>
      <button
        className={`lay-row${sunLighting ? ' active' : ''}`}
        aria-pressed={sunLighting}
        onClick={onToggleSun}
      >
        <SunIcon />
        <span className="lay-label">Sun &amp; day/night</span>
        <span className="lay-hint">
          {/* Google's tiles carry their own surface and the renderer hides the
              globe underneath them, so globe lighting draws nothing at all
              while they are on. Say so, rather than leaving a live-looking
              toggle that cannot change the picture. */}
          {buildings
            ? 'Hidden while 3D buildings are on'
            : sunLighting
              ? 'Real terminator — night side is dark'
              : 'Evenly lit globe'}
        </span>
      </button>
    </>
  );
}

// ---- the stack -------------------------------------------------------------

function LayerStackPanel({ control }: { control: LayerControl }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () => control.stack.filter((l) => matchesQuery(l, query)),
    [control.stack, query],
  );

  return (
    <>
      <AddLayerForm control={control} />

      {control.count > 0 && (
        <>
          <div className="lay-head">
            {control.count} layer{control.count === 1 ? '' : 's'}
          </div>
          <label className="laym-search">
            <SearchIcon aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Filter by name or kind"
              aria-label="Filter layers"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </>
      )}

      {control.outsideWindow.length > 0 && (
        <p className="laym-note">
          {control.outsideWindow.length} layer{control.outsideWindow.length === 1 ? '' : 's'} switched on
          {' '}but outside the current time — the globe hides them until the clock reaches their window.
        </p>
      )}

      {control.count === 0 ? (
        <p className="laym-empty">
          No layers yet. Paste a tile, GeoJSON, KML, CZML, 3D Tiles or terrain URL above,
          {' '}or pick something from the catalog.
        </p>
      ) : shown.length === 0 ? (
        <p className="laym-empty">Nothing matches “{query}”.</p>
      ) : (
        <ul className="laym-list">
          {shown.map((layer, i) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              control={control}
              /* The arrows act on the *panel's* order (topmost first), so the
                 first row cannot go up and the last cannot go down — but only
                 when the list is unfiltered, since a filtered list's neighbours
                 are not the stack's neighbours. */
              atTop={i === 0}
              atBottom={i === shown.length - 1}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function LayerRow({ layer, control, atTop, atBottom }: {
  layer: AtlasLayer;
  control: LayerControl;
  atTop: boolean;
  atBottom: boolean;
}) {
  const meta = FORMAT_META[layer.format];
  const outside = !isAvailableAt(layer, control.timeMs);
  const window = describeAvailability(layer.availability);
  const percent = Math.round(layer.opacity * 100);

  return (
    <li className={`laym-row${layer.visible ? '' : ' is-hidden'}${outside && layer.visible ? ' is-outside' : ''}`}>
      <button
        className="laym-eye"
        type="button"
        aria-pressed={layer.visible}
        aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
        title={layer.visible ? 'Hide' : 'Show'}
        onClick={() => control.toggle(layer.id)}
      >
        {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>

      <span className="laym-name" title={layer.url}>{layer.name}</span>

      <span className="laym-meta">
        <span className="laym-pill">{meta.label}</span>
        {window && <span className={`laym-pill is-time${outside ? ' is-outside' : ''}`}>{window}</span>}
        {outside && layer.visible && <span className="laym-pill is-outside">Outside the current time</span>}
        {layer.attribution?.text && (
          <span className="laym-credit">
            {layer.attribution.url
              ? <a href={layer.attribution.url} target="_blank" rel="noreferrer noopener">{layer.attribution.text}</a>
              : layer.attribution.text}
            {layer.attribution.licence && <> · <span className="laym-licence">{layer.attribution.licence}</span></>}
          </span>
        )}
      </span>

      <span className="laym-actions">
        {/* Reordering is buttons rather than drag: buttons are keyboard- and
            screen-reader-operable for free, and `control.moveTo` is there for a
            pointer drag to call when one is added. */}
        <button
          className="laym-btn" type="button" disabled={atTop}
          aria-label={`Move ${layer.name} up — draw it in front`}
          title="Move up (in front)"
          onClick={() => control.raise(layer.id)}
        ><ChevronUpIcon /></button>
        <button
          className="laym-btn" type="button" disabled={atBottom}
          aria-label={`Move ${layer.name} down — draw it behind`}
          title="Move down (behind)"
          onClick={() => control.lower(layer.id)}
        ><ChevronDownIcon /></button>
        <button
          className="laym-btn is-danger" type="button"
          aria-label={`Remove ${layer.name}`}
          title="Remove"
          onClick={() => control.remove(layer.id)}
        ><TrashIcon /></button>
      </span>

      <span className="laym-slider">
        <input
          type="range" min={0} max={100} step={1} value={percent}
          aria-label={`Opacity of ${layer.name}`}
          onChange={(e) => control.setOpacity(layer.id, Number(e.target.value) / 100)}
        />
        <span>{percent}%</span>
      </span>
    </li>
  );
}

// ---- add by URL ------------------------------------------------------------

function AddLayerForm({ control }: { control: LayerControl }) {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<LayerFormat | 'auto'>('auto');
  const [error, setError] = useState<{ problem: string; suggestion: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const submit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setWarnings([]);
    const result = await control.addByUrl(url, { format });
    if (!result.ok) { setError({ problem: result.problem, suggestion: result.suggestion }); return; }
    // Clear the field on success only: a rejected URL is usually one edit away
    // from a good one, and retyping it is the last thing the user wants to do.
    setUrl('');
    setFormat('auto');
    setWarnings(result.warnings);
  }, [control, url, format]);

  return (
    <form className="laym-form" onSubmit={submit}>
      <div className="lay-head">Add a layer</div>
      <input
        type="url"
        value={url}
        placeholder="https://…/{z}/{x}/{y}.png, tileset.json, .geojson…"
        aria-label="Layer URL"
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="laym-form-row">
        <select
          value={format}
          aria-label="Layer kind"
          onChange={(e) => setFormat(e.target.value as LayerFormat | 'auto')}
        >
          <option value="auto">Detect the kind from the URL</option>
          {LAYER_FORMATS.map((f) => (
            <option key={f} value={f}>{FORMAT_META[f].label} — {FORMAT_META[f].hint}</option>
          ))}
        </select>
        <button className="laym-add" type="submit" disabled={control.busy || !url.trim()}>
          <PlusIcon aria-hidden="true" /> {control.busy ? 'Checking…' : 'Add'}
        </button>
      </div>

      {error && (
        <p className="laym-error" role="alert">
          <b>{error.problem}</b>
          <span>{error.suggestion}</span>
        </p>
      )}
      {warnings.map((w) => (
        <p className="laym-warning" key={w} role="status">
          <b>Added, with a caveat</b>
          <span>{w}</span>
        </p>
      ))}
    </form>
  );
}

// ---- catalog ---------------------------------------------------------------

function CatalogPanel({ control, catalog }: { control: LayerControl; catalog: CatalogEntry[] }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchCatalog(query, catalog), [query, catalog]);
  const added = useMemo(
    () => new Set(control.layers.map((l) => l.catalogId).filter((id): id is string => Boolean(id))),
    [control.layers],
  );

  return (
    <>
      <label className="laym-search">
        <SearchIcon aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search open data — satellite, topo, night, NASA…"
          aria-label="Search the layer catalog"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {results.length === 0 ? (
        <p className="laym-empty">
          Nothing in the catalog matches “{query}”.
          {' '}Any tile, GeoJSON, KML, CZML, 3D Tiles or terrain URL can be added by hand from the Layers tab.
        </p>
      ) : (
        <ul className="laym-cat">
          {results.map((entry) => (
            <li key={entry.id} className={`laym-cat-row${added.has(entry.id) ? ' is-added' : ''}`}>
              <span className="laym-name">{entry.name}</span>
              <span className="laym-desc">{entry.description}</span>
              <span className="laym-credit">
                {entry.attribution.url
                  ? <a href={entry.attribution.url} target="_blank" rel="noreferrer noopener">{entry.attribution.text}</a>
                  : entry.attribution.text}
                {entry.attribution.licence && <> · <span className="laym-licence">{entry.attribution.licence}</span></>}
              </span>
              <button
                className="laym-add"
                type="button"
                aria-label={`Add ${entry.name}`}
                onClick={() => control.addFromCatalog(entry)}
              >
                {added.has(entry.id) ? 'Added' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- icons -----------------------------------------------------------------
// Local rather than added to `ui/icons.tsx`: they exist for this panel's row
// controls and nothing else uses them yet. Same 24-box, same stroke weight, so
// they sit with the shared set if they ever earn a place in it.

type P = SVGProps<SVGSVGElement>;
const S = (props: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

const EyeIcon = (p: P) => (
  <svg {...S(p)}><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></svg>
);
const EyeOffIcon = (p: P) => (
  <svg {...S(p)}><path d="M3 3l18 18" /><path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.2 8.3A17 17 0 0 0 2 12s3.6 6 10 6a10 10 0 0 0 3.3-.5" /></svg>
);
const ChevronUpIcon = (p: P) => <svg {...S(p)}><path d="m6 14 6-6 6 6" /></svg>;
const ChevronDownIcon = (p: P) => <svg {...S(p)}><path d="m6 10 6 6 6-6" /></svg>;
const TrashIcon = (p: P) => (
  <svg {...S(p)}><path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12" /></svg>
);
