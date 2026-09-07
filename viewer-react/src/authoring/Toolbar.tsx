import { useId, useState, type SVGProps } from 'react';
import { DRAW_MODES, type AuthoringMode, type DraftSnapshot } from './draft.js';
import { MARKER_ICONS, isUsableCustomIcon } from './icons.js';
import {
  STYLE_SWATCHES,
  WIDTH_STEPS,
  isStyleable,
  type AuthoringStyle,
} from './style.js';
import type { AuthoringSelection } from './store.js';
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

  selection: AuthoringSelection | null;
  onDelete: () => void;

  onCaptureCamera: () => void;
  /** A one-line summary of the last capture, e.g. from `describeCamera`. */
  capturedCamera?: string | null;

  /** Render nothing when false — the app's "authoring off" state. */
  open?: boolean;
}

const MODE_LABEL: Record<AuthoringMode, string> = {
  idle: 'Select',
  marker: 'Place a marker',
  line: 'Draw a line',
  polygon: 'Draw an area',
  note: 'Add a note',
};

const MODE_SHORT: Record<AuthoringMode, string> = {
  idle: 'Select',
  marker: 'Marker',
  line: 'Line',
  polygon: 'Area',
  note: 'Note',
};

export function AuthoringToolbar({
  mode, onMode,
  draft, onFinish, onCancel, onUndoVertex,
  style, onStyle,
  noteText, onNoteText,
  selection, onDelete,
  onCaptureCamera, capturedCamera,
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
  const drawing = mode !== 'idle';

  return (
    <section className="atlas-draw" aria-label="Drawing tools">
      <div className="draw-modes" role="group" aria-label="Drawing mode">
        {(['idle', ...DRAW_MODES] as AuthoringMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`draw-mode${mode === m ? ' active' : ''}`}
            aria-pressed={mode === m}
            aria-label={MODE_LABEL[m]}
            title={MODE_LABEL[m]}
            onClick={() => onMode(m)}
          >
            <ModeIcon mode={m} aria-hidden="true" />
            <span>{MODE_SHORT[m]}</span>
          </button>
        ))}
      </div>

      {/* Capture is not a drawing mode — it reads the camera and belongs to
          whatever the app wants to attach it to (an item, a scene). It sits
          here because this is the panel a person is in when they are building
          a story, and it costs one click. */}
      <div className="draw-row">
        <button type="button" className="draw-action" onClick={onCaptureCamera}>
          <CameraViewIcon aria-hidden="true" />
          <span>Capture this view</span>
        </button>
        {capturedCamera ? (
          <p className="draw-note" role="status">{capturedCamera}</p>
        ) : null}
      </div>

      {drawing ? (
        <div className="draw-status">
          <p className="draw-count" aria-live="polite">
            {draft.vertexCount === 0
              ? `Click the globe to start${mode === 'polygon' ? ' the outline' : ''}.`
              : `${draft.vertexCount} point${draft.vertexCount === 1 ? '' : 's'}${measure(draft)}`}
          </p>
          <div className="draw-row">
            <button
              type="button"
              className="draw-action primary"
              onClick={onFinish}
              disabled={!draft.canFinish}
            >
              Finish
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
            <button type="button" className="draw-action" onClick={onCancel}>
              Cancel
              <kbd>Esc</kbd>
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
 *  is not enough shape to measure. */
function measure(draft: DraftSnapshot): string {
  const parts: string[] = [];
  if (draft.areaMeters > 0) parts.push(formatArea(draft.areaMeters));
  if (draft.lengthMeters > 0) parts.push(formatLength(draft.lengthMeters));
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

export function formatLength(metres: number): string {
  if (!Number.isFinite(metres) || metres <= 0) return '0 m';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 2 : 1)} km`;
}

export function formatArea(squareMetres: number): string {
  if (!Number.isFinite(squareMetres) || squareMetres <= 0) return '0 m²';
  if (squareMetres < 10_000) return `${Math.round(squareMetres)} m²`;
  if (squareMetres < 1_000_000) return `${(squareMetres / 10_000).toFixed(2)} ha`;
  return `${(squareMetres / 1_000_000).toFixed(2)} km²`;
}

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

function ModeIcon({ mode, ...rest }: { mode: AuthoringMode } & P) {
  switch (mode) {
    case 'marker': return <MarkerIcon {...rest} />;
    case 'line': return <LineIcon {...rest} />;
    case 'polygon': return <PolygonIcon {...rest} />;
    case 'note': return <NoteIcon {...rest} />;
    default: return <CursorIcon {...rest} />;
  }
}
