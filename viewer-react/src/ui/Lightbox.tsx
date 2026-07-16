import { useEffect, useLayoutEffect, useRef } from 'react';
import { mediaFull, type AtlasMemory } from '../model/atlasModel.js';

/** Full-bleed media view for a memory. Shows the real full-resolution image when
 *  the story carries a loadable URL, otherwise the memory's tint hero. Focus is
 *  moved into the dialog on open, trapped, and restored to the trigger on close. */
export function Lightbox({ memory, onClose }: { memory: AtlasMemory | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (memory) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      closeRef.current?.focus();
    } else if (restoreRef.current) {
      restoreRef.current.focus?.();
      restoreRef.current = null;
    }
  }, [memory]);

  // Escape at the document level: clicking the photo blurs the close button, and
  // a dialog-scoped handler would go dead once focus falls back to <body>.
  useEffect(() => {
    if (!memory) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [memory, onClose]);

  if (!memory) return null;
  const url = mediaFull(memory);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Tab') { e.preventDefault(); closeRef.current?.focus(); } // trap
  };

  return (
    <div className="atlas-lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={memory.title} onKeyDown={onKeyDown}>
      <button ref={closeRef} className="lb-close" aria-label="Close" onClick={onClose}>✕</button>
      <figure className="lb-figure" onClick={(e) => e.stopPropagation()}>
        {url
          ? <img src={url} alt={memory.title} className="lb-media" />
          : <div className="lb-media lb-tint" style={{ background: memory.gradient }} aria-hidden="true" />}
        <figcaption className="lb-cap">
          <b>{memory.title}</b>
          {memory.narrative && <p>{memory.narrative}</p>}
          <span>{memory.place ? `${memory.place} · ` : ''}{memory.whenDate} · {memory.whenTime}</span>
        </figcaption>
      </figure>
    </div>
  );
}
