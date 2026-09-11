import { useEffect, useRef, type SVGProps } from 'react';

/** The five things a person draws or adds that can crowd the globe, plus
 *  images (a photo/video's billboard — see `CesiumStoryViewer`'s
 *  `showImages`). Reuses `Item['type']`'s own literals for the drawn
 *  categories rather than inventing a parallel vocabulary; `'photo'` stands
 *  in for both photos and videos, since nothing here can tell them apart at a
 *  glance and no user has ever asked to turn one off without the other. */
export type AuthoredCategory = 'note' | 'marker' | 'line' | 'polygon' | 'photo';

const CATEGORIES: ReadonlyArray<{ key: AuthoredCategory; label: string }> = [
  { key: 'note', label: 'Notes' },
  { key: 'marker', label: 'Pins' },
  { key: 'line', label: 'Outlines' },
  { key: 'polygon', label: 'Areas' },
  { key: 'photo', label: 'Images' },
];

/**
 * What's shown on the globe — a checkbox per category, nothing else.
 *
 * Same popover shell as `MapLayers` (icon button + an absolutely-positioned
 * panel with its own Escape/click-outside dismissal), copied rather than
 * shared because the two answer different questions: `MapLayers` is about
 * which *sources* are drawn (a basemap, an imported layer), this is about
 * which *categories of authored content* are. Hidden categories stay in the
 * story — this only ever changes what is drawn, never what is saved.
 */
export function VisibilityToggles({ open, hidden, onToggleCategory, onToggle, onClose }: {
  open: boolean;
  hidden: ReadonlySet<AuthoredCategory>;
  onToggleCategory: (category: AuthoredCategory) => void;
  onToggle: () => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, onClose]);

  return (
    <div className="atlas-vis" ref={popRef}>
      <button
        className="atlas-icon-btn"
        aria-label="What's shown on the globe"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="What's shown on the globe"
        onClick={onToggle}
      >
        <EyeIcon />
      </button>

      {open && (
        <div className="atlas-vis-pop" role="dialog" aria-label="What's shown on the globe">
          <div className="lay-head">On the globe</div>
          {CATEGORIES.map(({ key, label }) => (
            <label className="vis-row" key={key}>
              <input
                type="checkbox"
                checked={!hidden.has(key)}
                onChange={() => onToggleCategory(key)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Local rather than added to `ui/icons.tsx`: exists for this one button, same
// reasoning as `MapLayers.tsx`'s own row icons.
const EyeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}
  >
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);
