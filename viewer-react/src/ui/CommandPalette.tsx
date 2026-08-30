import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GlobeIcon, ImagesIcon, ClockIcon, GraphIcon, PinIcon, SearchIcon } from './icons.js';
import type { AtlasMemory } from '../model/atlasModel.js';

type Item =
  | { kind: 'memory'; id: string; label: string; sub: string; memory: AtlasMemory };


const LIST_ID = 'atlas-cmdk-list';
const optId = (i: number) => `atlas-cmdk-opt-${i}`;

/** The ⌘K palette — the redesign's replacement for XR SavedSearches: jump to a
 *  memory or place by keyboard. Implemented as an ARIA
 *  combobox+listbox (focus stays on the input; the active option is announced
 *  via aria-activedescendant) inside a focus-trapped modal dialog. */
export function CommandPalette({ open, memories, onClose, onSelect }: {
  open: boolean;
  memories: AtlasMemory[];
  onClose: () => void;
  onSelect: (m: AtlasMemory) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Reset + focus on open (before paint, so no stale-results flash); restore
  // focus to the trigger on close.
  useLayoutEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      setQuery('');
      setActive(0);
      inputRef.current?.focus();
    } else if (restoreRef.current) {
      restoreRef.current.focus?.();
      restoreRef.current = null;
    }
  }, [open]);

  // Keep the highlighted option visible — the list is a fixed-height scroller,
  // so arrowing past the first screenful would otherwise lose the selection.
  useLayoutEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const mem: Item[] = memories
      .filter((m) => !q || `${m.title} ${m.place ?? ''} ${m.narrative ?? ''}`.toLowerCase().includes(q))
      .map((m) => ({ kind: 'memory', id: `m:${m.id}`, label: m.title, sub: `${m.place ?? 'Memory'} · ${m.whenDate}`, memory: m }));
    return mem;
  }, [query, memories]);

  if (!open) return null;

  const run = (it: Item | undefined) => {
    if (!it) return;
    onSelect(it.memory);
  };

  // Handled on the dialog so it works regardless of which descendant has focus.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Tab') { e.preventDefault(); inputRef.current?.focus(); } // trap focus on the input
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (items.length ? Math.min(items.length - 1, a + 1) : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (items.length ? Math.max(0, a - 1) : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
  };

  return (
    <div className="atlas-cmdk-backdrop" onClick={onClose}>
      <div
        className="atlas-cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        // Clicking chrome (the esc badge, an option, the icon) must not blur the
        // input — every key handler lives on this dialog and needs focus inside.
        onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); }}
      >
        <div className="cmdk-input">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            placeholder="Jump to a place, date, memory…"
            aria-label="Search memories and views"
            role="combobox"
            aria-expanded="true"
            aria-controls={LIST_ID}
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? optId(active) : undefined}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          />
          <span className="kbd">esc</span>
        </div>
        <ul className="cmdk-list" id={LIST_ID} role="listbox" aria-label="Results">
          {items.length === 0 && <li className="cmdk-empty">No matches</li>}
          {items.map((it, i) => (
            <li
              key={it.id}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              className={`cmdk-item${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(it)}
            >
              <span className="cmdk-ico"><PinIcon /></span>
              <span className="cmdk-label">{it.label}</span>
              <span className="cmdk-sub">{it.sub}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
