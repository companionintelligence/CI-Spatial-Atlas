import { useEffect } from 'react';
import type { Item } from '@companion-atlas/story';

/**
 * The full text of a clicked note — its on-globe label is cropped (see
 * `authoring/entities.ts`'s `cropNoteLabel`), so this is the one place to
 * read the rest of it.
 *
 * Modeled on `PlaceCard`: same shell, same reasoning. A note has no hero
 * image, no visit history, nothing `MemoryInspector` carries — it is a few
 * words someone typed, so the card is just that. Docks in the same slot,
 * shown instead of `PlaceCard`/`MemoryInspector` while a note is focused (see
 * `AtlasApp`).
 */
export function NoteCard({ note, onClose }: {
  note: Item & { type: 'note' };
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="atlas-inspector" aria-label="Note detail">
      <div className="atlas-insp-body">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div className="atlas-insp-title">{note.title ?? 'Note'}</div>
          <button className="atlas-icon-btn" title="Close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--atlas-fg)', whiteSpace: 'pre-wrap' }}>
          {note.text}
        </p>
      </div>
    </aside>
  );
}
