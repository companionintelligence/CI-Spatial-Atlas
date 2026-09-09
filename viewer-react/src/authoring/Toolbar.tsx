import { useId, useState, type FormEvent, type SVGProps } from 'react';
import { TOOL_MODES, type AuthoringMode, type DraftSnapshot } from './draft.js';
import { MARKER_ICONS, isUsableCustomIcon } from './icons.js';
import {
  describeMeasurement,
  formatArea,
  formatLength,
  MEASURE_UNITS,
  UNIT_LABEL,
  UNIT_SHORT,
  type Measurement,
  type MeasureUnits,
} from './measure.js';
import {
  STYLE_SWATCHES,
  WIDTH_STEPS,
  isStyleable,
  type AuthoringStyle,
} from './style.js';
import type { AuthoringSelection } from './store.js';
import type { GeoPlace } from '../memory/geocode.js';
import '../theme/authoring.css';

/**
 * The drawing toolbar.
 *
 * Presentational and fully controlled: every value comes down as a prop and
 * every interaction goes back up as a callback. It holds exactly one piece of
 * state of its own — the half-typed custom icon URL — because a controlled
 * input that rejects invalid values as you type is unusable (you cannot get
 * past `h` on the way to `https://`).
 *
 * ## Which controls exist depends on what is armed
 *
 * A style row over a `note` would be four dead controls, since the schema gives
 * a note no style fields at all (`isStyleable`). An icon gallery over a polygon
 * is the same. So the panel grows and shrinks with the tool, and it says why
 * the shape it is about to draw needs what it is showing.
 *
 * ## Keyboard
 *
 * Plain, Tab-navigable buttons — deliberately NOT the ARIA toolbar's roving
 * tabindex. Roving tabindex is right for a strip of homogeneous buttons; this
 * panel mixes buttons with a text field, a colour input and two sliders, and
 * roving focus through those means Tab escapes the panel from the first control
 * and the arrow keys are stolen from the slider that needs them. The panel is a
 * labelled region containing labelled groups instead, which is the pattern the
 * rest of the shell already uses (`.switch`, `.lay-grid`).
 *
 * The gestures that matter are on the globe, not in here, and the controller
 * owns them: click to add, double-click or Enter to finish, Escape to cancel,
 * Backspace to undo the last point. They are printed on the panel because a
 * drawing tool whose gestures are undiscoverable is a drawing tool nobody uses.
 */

export interface AuthoringToolbarProps {
  mode: AuthoringMode;
  onMode: (mode: AuthoringMode) => void;

  draft: DraftSnapshot;
  onFinish: () => void;
  onCancel: () => void;
  onUndoVertex: () => void;

  style: AuthoringStyle;
  /** Applies to the tool, and to the selected shape when there is one. */
  onStyle: (patch: Partial<AuthoringStyle>) => void;

  /** Text the next placed note will carry. */
  noteText: string;
  onNoteText: (text: string) => void;

  /** The address of the staged pin, and what the lookup is doing. */
  placeLabel?: string;
  placeState?: 'idle' | 'looking' | 'found' | 'none';
  onPlaceLabel?: (label: string) => void;
  /** Address search: rows to offer, and whether a query is in flight. */
  addressResults?: GeoPlace[];
  addressBusy?: boolean;
  onSearchAddress?: (query: string) => void;
  onUseAddress?: (place: GeoPlace) => void;

  selection: AuthoringSelection | null;
  onDelete: () => void;

  onCaptureCamera: () => void;
  /** A one-line summary of the last capture, e.g. from `describeCamera`. */
  capturedCamera?: string | null;

  /** The retained measurement, or null. Never an `Item` — see `measure.ts`. */
  measurement?: Measurement | null;
  onClearMeasurement?: () => void;
  /** The one units setting for the whole feature. */
  units?: MeasureUnits;
  onUnits?: (units: MeasureUnits) => void;

  /** Undo/redo over committed authoring actions — NOT `onUndoVertex`, which
   *  works on the shape in progress. Both are offered, because they are two
   *  different gestures and a user in the middle of a polygon needs the one
   *  that does not reach back into finished work. */
  canUndo?: boolean;
  canRedo?: boolean;
  /** What the next press would take back, e.g. `"delete area"`. Rendered into
   *  the button's title and accessible name, so a screen reader hears which
   *  action is about to be reversed rather than a bare "Undo". */
  undoLabel?: string | null;
  redoLabel?: string | null;
  onUndo?: () => void;
  onRedo?: () => void;

  /** Render nothing when false — the app's "authoring off" state. */
  open?: boolean;
}

/**
 * Degrees with a hemisphere letter, which is how a coordinate is read aloud and
 * how every other readout in this app spells one (`PlaceChip`, the inspector).
 * Four decimals is about 11 m — finer than a pin is placed and shorter than the
 * six that would imply survey precision the click never had.
 */
export function formatLatLon(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${ns} ${Math.abs(lon).toFixed(4)}°${ew}`;
}

/**
 * Type an address, get somewhere to put the pin.
 *
 * A form rather than search-as-you-type: this is a public geocoder being asked
 * a question, and a request per keystroke is both slow and rude. Results are
 * offered rather than placed — picking the wrong Springfield should cost a
 * click, not a mystery pin — and the list clears once one is taken.
 */
function AddressBox({
  busy, results, onSearch, onUse,
}: {
  busy: boolean;
  results: GeoPlace[];
  onSearch?: (query: string) => void;
  onUse?: (place: GeoPlace) => void;
}) {
  const [query, setQuery] = useState('');
  if (!onSearch || !onUse) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <div className="draw-address">
      <form className="draw-address-row" onSubmit={submit}>
        <input
          className="draw-input"
          type="search"
          value={query}
          placeholder="Type an address, or click the globe"
          aria-label="Find an address"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="draw-action" disabled={busy || query.trim().length < 2}>
          {busy ? 'Finding…' : 'Find'}
        </button>
      </form>
      {results.length > 0 && (
        <ul className="draw-address-results">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="draw-address-hit" onClick={() => { onUse(r); setQuery(''); }}>
                <b>{r.name}</b>
                {r.detail ? <span>{r.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MODE_LABEL: Record<AuthoringMode, string> = {
  idle: 'Select',
  marker: 'Place a marker',
  line: 'Draw a line',
  polygon: 'Draw an area',
  note: 'Add a note',
  // Says what it does NOT do, because that is the surprising half: every other
  // tool in this row leaves something behind.
  measure: 'Measure distance and area — nothing is saved',
};

export function AuthoringToolbar({
  mode, onMode,
  draft, onFinish, onCancel, onUndoVertex,
  placeLabel = '', placeState = 'idle', onPlaceLabel,
  addressResults = [], addressBusy = false, onSearchAddress, onUseAddress,
  style, onStyle,
  noteText, onNoteText,
  selection, onDelete,
  onCaptureCamera, capturedCamera,
  measurement = null, onClearMeasurement,
  units = 'metric', onUnits,
  canUndo = false, canRedo = false, undoLabel = null, redoLabel = null,
  onUndo, onRedo,
  open = true,
}: AuthoringToolbarProps) {
  const ids = useId();
  const [customIcon, setCustomIcon] = useState('');

  if (!open) return null;

  const selectedItem = selection?.kind === 'item' ? selection.item : undefined;
  // The style row serves whichever is live: the shape being edited, or the tool
  // about to draw one. Without this, restyling a selected polygon would need a
  // second, near-identical panel somewhere else.
  const styleTarget: AuthoringMode | 'idle' = selectedItem
    ? (selectedItem.type as AuthoringMode)
    : mode;
  const showStyle = isStyleable(styleTarget);
  const showFill = styleTarget === 'polygon';
  const showWidth = styleTarget === 'line' || styleTarget === 'polygon';
  const showIcons = styleTarget === 'marker';
  const showNoteText = mode === 'note' || selectedItem?.type === 'note';
  const measuring = mode === 'measure';
  // The draw status block belongs to the shape tools. Measuring gets its own,
  // because its buttons mean different things: there is nothing to "Finish"
  // into the story, and "Cancel" abandons a reading rather than a shape.
  const drawing = mode !== 'idle' && !measuring;
  // Wherever a number is printed, the control that chooses its units is
  // reachable — and nowhere else, because a Units row over the select tool
  // governs nothing on screen.
  const showUnits = measuring || drawing || !!measurement;

  return (
    <section className="atlas-draw" aria-label="Drawing tools">
      <div className="draw-modes" role="group" aria-label="Drawing mode">
        {TOOL_MODES.map((m) => (
          <button
            key={m}
            type="button"
            /* The mode is a class as well as a state, so the stylesheet can
               give the measure tool its own active colour — it is the one tool
               in this row that produces nothing. */
            className={`draw-mode ${m}${mode === m ? ' active' : ''}`}
            aria-pressed={mode === m}
            aria-label={MODE_LABEL[m]}
            title={MODE_LABEL[m]}
            onClick={() => onMode(m)}
          >
            {/* Icon alone. The name lived under it in a 9px font that was the
                first thing to be squeezed as tools were added — six of them no
                longer fitted, and "Measure" was rendering clipped. `title` and
                `aria-label` already carried the full sentence, so dropping the
                caption loses nothing a pointer or a screen reader could reach,
                and the label they get is the longer, more useful one. */}
            <ModeIcon mode={m} aria-hidden="true" />
          </button>
        ))}
      </div>

      {/* Undo/redo, immediately under the tools they act on.
          Both are always rendered and disabled when unavailable, rather than
          being hidden until there is history: a control that appears and
          disappears cannot be found by muscle memory, and its absence reads as
          "this app has no undo" rather than "there is nothing to undo yet". */}
      <div className="draw-row draw-history" role="group" aria-label="Undo and redo">
        <button
          type="button"
          className="draw-action"
          onClick={onUndo}
          disabled={!canUndo}
          aria-keyshortcuts="Control+Z Meta+Z"
          aria-label={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
          title={undoLabel ? `Undo ${undoLabel}` : 'Nothing to undo'}
        >
          <UndoIcon aria-hidden="true" />
          <span>Undo</span>
          <kbd>{'\u2318/Ctrl Z'}</kbd>
        </button>
        <button
          type="button"
          className="draw-action"
          onClick={onRedo}
          disabled={!canRedo}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
          aria-label={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
          title={redoLabel ? `Redo ${redoLabel}` : 'Nothing to redo'}
        >
          <RedoIcon aria-hidden="true" />
          <span>Redo</span>
        </button>
      </div>

      {/* Capture is not a drawing mode — it reads the camera and creates a
          scene from it (`AtlasApp.captureSceneFromDraw`), the same act as the
          Scenes panel's own "Scene from this view" button. It sits here
          because this is the panel a person is in when they are building a
          story, and it costs one click without switching panels. */}
      <div className="draw-row">
        <button type="button" className="draw-action" onClick={onCaptureCamera}>
          <CameraViewIcon aria-hidden="true" />
          <span>Capture this view</span>
        </button>
        {capturedCamera ? (
          <p className="draw-note" role="status">{capturedCamera}</p>
        ) : null}
      </div>

      {measuring || measurement ? (
        <div className="draw-status draw-measure">
          {measuring ? (
            <p className="draw-count" aria-live="polite">
              {draft.vertexCount === 0
                ? 'Click two or more points to measure.'
                : `${draft.vertexCount} point${draft.vertexCount === 1 ? '' : 's'}${draftMeasure(draft, units)}`}
            </p>
          ) : null}

          {/* Said plainly, and said every time the tool is armed. The single
              most likely misunderstanding of this feature is that a
              measurement is a shape that got saved — and the cost of that
              misunderstanding is a story that silently lacks something the
              author believed was in it. */}
          {measuring ? (
            <p className="draw-note">Measurements are not saved with the story.</p>
          ) : null}

          {measuring ? (
            <div className="draw-row">
              <button
                type="button"
                className="draw-action primary"
                onClick={onFinish}
                disabled={draft.vertexCount < 2}
              >
                Take reading
                <kbd>Enter</kbd>
              </button>
              <button
                type="button"
                className="draw-action"
                onClick={onUndoVertex}
                disabled={draft.vertexCount === 0}
              >
                Undo point
                <kbd>Backspace</kbd>
              </button>
            </div>
          ) : null}

          {/* Labelled, not just a bare number. The block can be on screen with
              the area tool armed, where an unlabelled "111.2 km" would read as
              something about the shape being drawn. */}
          {measurement ? (
            <p className="draw-count" role="status">
              Measured <b>{describeMeasurement(measurement, units)}</b>
            </p>
          ) : null}

          {measurement ? (
            <div className="draw-row">
              <button type="button" className="draw-action" onClick={onClearMeasurement}>
                <TrashIcon aria-hidden="true" />
                <span>Clear measurement</span>
              </button>
            </div>
          ) : null}

          {draft.warning && measuring ? (
            <p className="draw-warning" role="alert">
              <WarnIcon aria-hidden="true" />
              <span>{draft.warning}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The units setting sits outside the measure block on purpose.
          It governs EVERY number the panel prints — the polygon tool's running
          perimeter as much as a measurement — so hiding it inside the measure
          block would leave a user who had switched to feet reading feet under
          the area tool with no control anywhere to switch back. One setting,
          reachable wherever it has an effect. */}
      {showUnits ? (
        <div className="draw-field">
          <span className="draw-label" id={`${ids}-units`}>Units</span>
          <div className="draw-units" role="group" aria-labelledby={`${ids}-units`}>
            {MEASURE_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                className={`draw-unit${units === u ? ' active' : ''}`}
                aria-pressed={units === u}
                aria-label={UNIT_LABEL[u]}
                title={UNIT_LABEL[u]}
                onClick={() => onUnits?.(u)}
              >
                {UNIT_SHORT[u]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {drawing ? (
        <div className="draw-status">
          {mode === 'marker' && (
            <AddressBox
              busy={addressBusy}
              results={addressResults}
              onSearch={onSearchAddress}
              onUse={onUseAddress}
            />
          )}
          <p className="draw-count" aria-live="polite">
            {draft.vertexCount === 0
              ? `Click the globe to start${mode === 'polygon' ? ' the outline' : ''}.`
              : `${draft.vertexCount} point${draft.vertexCount === 1 ? '' : 's'}${draftMeasure(draft, units)}`}
          </p>

          {/* Where the pin actually is, next to the button that commits it —
              so "Finish" is a decision about something the author can see,
              rather than a leap. Coordinates always; the address when the
              lookup found one, and an honest word when it did not. */}
          {draft.point && (
            <div className="draw-place">
              <p className="draw-coords">
                {formatLatLon(draft.point.lat, draft.point.lon)}
              </p>
              {placeState === 'looking' && <p className="draw-place-name dim">Looking up the address…</p>}
              {placeState === 'found' && placeLabel && (
                <input
                  className="draw-input"
                  value={placeLabel}
                  aria-label="Name for this pin"
                  onChange={(e) => onPlaceLabel?.(e.target.value)}
                />
              )}
              {placeState === 'none' && (
                <p className="draw-place-name dim">No address here — the pin keeps its coordinates.</p>
              )}
            </div>
          )}

          <div className="draw-row">
            <button
              type="button"
              className="draw-action primary"
              onClick={onFinish}
              disabled={!draft.canFinish}
            >
              Finish
            </button>
            <button
              type="button"
              className="draw-action"
              onClick={onUndoVertex}
              disabled={draft.vertexCount === 0}
            >
              {mode === 'marker' ? 'Remove pin' : 'Undo point'}
            </button>
            <button type="button" className="draw-action" onClick={onCancel}>
              Cancel
            </button>
          </div>
          {draft.warning ? (
            <p className="draw-warning" role="alert">
              <WarnIcon aria-hidden="true" />
              <span>{draft.warning}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {selection?.kind === 'item' ? (
        <div className="draw-status">
          <p className="draw-count">
            Selected <b>{selectedItem?.title ?? selection.id}</b>
            {selectedItem ? ` · ${selectedItem.type}` : ''}
          </p>
          <p className="draw-note">Drag a point to reshape it, or the middle handle to move it.</p>
          <div className="draw-row">
            <button type="button" className="draw-action danger" onClick={onDelete}>
              <TrashIcon aria-hidden="true" />
              <span>Delete</span>
              <kbd>Del</kbd>
            </button>
          </div>
        </div>
      ) : null}

      {showNoteText ? (
        <div className="draw-field">
          <label htmlFor={`${ids}-note`}>Note text</label>
          <input
            id={`${ids}-note`}
            className="draw-input"
            type="text"
            value={noteText}
            placeholder="What happened here?"
            onChange={(e) => onNoteText(e.target.value)}
          />
        </div>
      ) : null}

      {showStyle ? (
        <div className="draw-style" role="group" aria-label="Style">
          <div className="draw-field">
            <span className="draw-label" id={`${ids}-colour`}>
              {showFill ? 'Fill colour' : 'Colour'}
            </span>
            <div className="draw-swatches" role="group" aria-labelledby={`${ids}-colour`}>
              {STYLE_SWATCHES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`draw-swatch${sameColour(style.color, s.hex) ? ' active' : ''}`}
                  aria-pressed={sameColour(style.color, s.hex)}
                  aria-label={s.label}
                  title={s.label}
                  /* The one place an inline colour is right: this is the value
                     itself, not chrome. Everything structural is a token in
                     theme/authoring.css. */
                  style={{ background: s.hex }}
                  onClick={() => onStyle({ color: s.hex })}
                />
              ))}
              <label className="draw-swatch draw-swatch-custom" title="Custom colour">
                <span className="draw-sr">Custom colour</span>
                <input
                  type="color"
                  value={hexOrDefault(style.color)}
                  onChange={(e) => onStyle({ color: e.target.value })}
                />
              </label>
            </div>
          </div>

          {showWidth ? (
            <div className="draw-field">
              <span className="draw-label" id={`${ids}-width`}>
                {showFill ? 'Outline width' : 'Line width'}
              </span>
              <div className="draw-widths" role="group" aria-labelledby={`${ids}-width`}>
                {WIDTH_STEPS.map((w) => {
                  const current = showFill ? style.outlineWidth : style.width;
                  return (
                    <button
                      key={w}
                      type="button"
                      className={`draw-width${current === w ? ' active' : ''}`}
                      aria-pressed={current === w}
                      aria-label={`${w} pixel${w === 1 ? '' : 's'}`}
                      title={`${w} px`}
                      onClick={() => onStyle(showFill ? { outlineWidth: w } : { width: w })}
                    >
                      <i style={{ height: `${w}px` }} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {showFill ? (
            <>
              <div className="draw-field">
                <label htmlFor={`${ids}-opacity`}>
                  Fill opacity <span className="draw-value">{Math.round(style.fillOpacity * 100)}%</span>
                </label>
                <input
                  id={`${ids}-opacity`}
                  className="draw-range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={style.fillOpacity}
                  onChange={(e) => onStyle({ fillOpacity: Number(e.target.value) })}
                />
                {/* 0 is not "off by accident" — it is how an outline-only area
                    is expressed, and how KML's <fill>0</fill> arrives. */}
                {style.fillOpacity === 0 ? <p className="draw-note">Outline only.</p> : null}
              </div>
              <div className="draw-field">
                <span className="draw-label" id={`${ids}-outline`}>Outline colour</span>
                <div className="draw-swatches" role="group" aria-labelledby={`${ids}-outline`}>
                  {STYLE_SWATCHES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`draw-swatch${sameColour(style.outlineColor, s.hex) ? ' active' : ''}`}
                      aria-pressed={sameColour(style.outlineColor, s.hex)}
                      aria-label={`${s.label} outline`}
                      title={s.label}
                      style={{ background: s.hex }}
                      onClick={() => onStyle({ outlineColor: s.hex })}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {showIcons ? (
            <div className="draw-field">
              <span className="draw-label" id={`${ids}-icon`}>Icon</span>
              <div className="draw-icons" role="group" aria-labelledby={`${ids}-icon`}>
                {MARKER_ICONS.map((icon) => (
                  <button
                    key={icon.id}
                    type="button"
                    className={`draw-icon${style.icon === icon.id ? ' active' : ''}`}
                    aria-pressed={style.icon === icon.id}
                    aria-label={icon.label}
                    title={icon.label}
                    onClick={() => onStyle({ icon: icon.id })}
                  >
                    <svg viewBox="0 0 15 15" aria-hidden="true">
                      <path d={icon.path} fill="currentColor" fillRule="evenodd" />
                    </svg>
                  </button>
                ))}
                <button
                  type="button"
                  className={`draw-icon${!style.icon ? ' active' : ''}`}
                  aria-pressed={!style.icon}
                  aria-label="No icon — plain dot"
                  title="Plain dot"
                  onClick={() => onStyle({ icon: undefined })}
                >
                  <svg viewBox="0 0 15 15" aria-hidden="true">
                    <circle cx="7.5" cy="7.5" r="3.5" fill="currentColor" />
                  </svg>
                </button>
              </div>
              <label htmlFor={`${ids}-custom`} className="draw-label">Custom icon URL</label>
              <input
                id={`${ids}-custom`}
                className="draw-input"
                type="url"
                inputMode="url"
                placeholder="https://…/pin.svg"
                value={customIcon}
                aria-describedby={customIcon && !isUsableCustomIcon(customIcon) ? `${ids}-custom-err` : undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  setCustomIcon(next);
                  // Only commit a URL that will actually load. Committing on
                  // every keystroke would set `icon` to `h`, then `ht`, …
                  if (isUsableCustomIcon(next)) onStyle({ icon: next });
                }}
              />
              {customIcon && !isUsableCustomIcon(customIcon) ? (
                <p className="draw-warning" id={`${ids}-custom-err`} role="alert">
                  <WarnIcon aria-hidden="true" />
                  <span>Needs an http:// or https:// address.</span>
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="draw-check">
            <input
              type="checkbox"
              checked={style.clampToGround !== false}
              onChange={(e) => onStyle({ clampToGround: e.target.checked })}
            />
            <span>
              Drape on terrain
              <small>Follows hills at every zoom. Off keeps the elevations as drawn.</small>
            </span>
          </label>
        </div>
      ) : null}
    </section>
  );
}

/** " · 1.2 km" / " · 3.4 ha" — the running measurement, or nothing when there
 *  is not enough shape to measure. Serves the shape tools AND the measure tool,
 *  so a distance reads identically whichever one produced it. */
function draftMeasure(draft: DraftSnapshot, units: MeasureUnits): string {
  const parts: string[] = [];
  if (draft.areaMeters > 0) parts.push(formatArea(draft.areaMeters, units));
  if (draft.lengthMeters > 0) parts.push(formatLength(draft.lengthMeters, units));
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/** Re-exported from `measure.ts`, where the unit conversions live. Kept
 *  importable from here because that is where they were first written and the
 *  existing suite imports them from this module — moving the implementation was
 *  worth it, breaking the import path for a rename was not. */
export { formatArea, formatLength } from './measure.js';

/** Case-insensitive hex compare, so `#72DDD4` from a colour input still lights
 *  up the `#72ddd4` swatch it came from. */
function sameColour(a: string | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

/** `<input type="color">` accepts only `#rrggbb`. Anything else — a shorthand,
 *  an `#rrggbbaa` from an import — makes it silently fall back to black, which
 *  reads as "the app forgot my colour". */
function hexOrDefault(value: string | undefined): string {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value;
  if (typeof value === 'string' && /^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value.slice(1).split('').map((c) => c + c).join('')}`;
  }
  return '#72ddd4';
}

// ---------------------------------------------------------------------------
// Icons — local to the toolbar rather than added to `ui/icons.tsx`, which the
// shell owns. Same 24×24 stroked grid, so they sit beside the rail's icons
// without looking imported from somewhere else.
// ---------------------------------------------------------------------------

type P = SVGProps<SVGSVGElement>;
const S = (props: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

const CursorIcon = (p: P) => (
  <svg {...S(p)}><path d="m5 3 6.5 17 2.4-6.6 6.6-2.4z" /></svg>
);
const MarkerIcon = (p: P) => (
  <svg {...S(p)}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
const LineIcon = (p: P) => (
  <svg {...S(p)}><path d="m4 18 5.5-8L14 14l6-9" /><circle cx="4" cy="18" r="1.8" /><circle cx="20" cy="5" r="1.8" /></svg>
);
const PolygonIcon = (p: P) => (
  <svg {...S(p)}><path d="M12 3.5 20 9l-3 10H7L4 9z" /><circle cx="12" cy="3.5" r="1.6" /><circle cx="20" cy="9" r="1.6" /><circle cx="4" cy="9" r="1.6" /></svg>
);
const NoteIcon = (p: P) => (
  <svg {...S(p)}><path d="M5 4h14v11l-4 5H5z" /><path d="M15 20v-5h4M8.5 8.5h7M8.5 12h5" /></svg>
);
const CameraViewIcon = (p: P) => (
  <svg {...S(p)}><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 7l1.5-2.5h5L16 7" /><circle cx="12" cy="13.5" r="3.4" /></svg>
);
const TrashIcon = (p: P) => (
  <svg {...S(p)}><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10.5 11v5M13.5 11v5" /></svg>
);
const WarnIcon = (p: P) => (
  <svg {...S(p)}><path d="M12 4 2.6 20h18.8z" /><path d="M12 10v4M12 17v.01" /></svg>
);
/* A ruler laid on the diagonal, with tick marks — the one shape in this set
   that is an instrument rather than a mark on the map, which is the whole
   distinction the measure tool is trying to make visible. */
const RulerIcon = (p: P) => (
  <svg {...S(p)}>
    <rect x="1.6" y="8.6" width="20.8" height="6.8" rx="1.6" transform="rotate(-30 12 12)" />
    <path d="M8.1 7.6l1.1 1.9M11.1 5.9l1.6 2.8M14.1 4.2l1.1 1.9" />
  </svg>
);
const UndoIcon = (p: P) => (
  <svg {...S(p)}><path d="M4 9h9.5a5 5 0 0 1 0 10H8" /><path d="m8 5-4 4 4 4" /></svg>
);
const RedoIcon = (p: P) => (
  <svg {...S(p)}><path d="M20 9h-9.5a5 5 0 0 0 0 10H16" /><path d="m16 5 4 4-4 4" /></svg>
);

function ModeIcon({ mode, ...rest }: { mode: AuthoringMode } & P) {
  switch (mode) {
    case 'marker': return <MarkerIcon {...rest} />;
    case 'line': return <LineIcon {...rest} />;
    case 'polygon': return <PolygonIcon {...rest} />;
    case 'note': return <NoteIcon {...rest} />;
    case 'measure': return <RulerIcon {...rest} />;
    default: return <CursorIcon {...rest} />;
  }
}
