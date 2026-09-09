/**
 * The full-text popup a cropped note expands into.
 *
 * `NoteCard` exists because the on-globe label is deliberately lossy (see
 * `cropNoteLabel`) — this is the one place the full text is guaranteed to be
 * on screen, so the only property worth checking is that it actually is,
 * untruncated, regardless of length.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '@companion-atlas/story';
import { NoteCard } from '../src/ui/NoteCard.js';

const note = (over: Partial<Item> = {}): Item & { type: 'note' } =>
  ({ id: 'n1', type: 'note', position: { lon: 0, lat: 0 }, text: 'Found the old trailhead marker here.', ...over }) as Item & { type: 'note' };

describe('NoteCard', () => {
  it('shows the full text, not the cropped globe label', () => {
    const longText = 'This is a much longer note than the twenty characters shown on the globe pin.';
    const html = renderToStaticMarkup(createElement(NoteCard, { note: note({ text: longText }), onClose: () => {} }));
    expect(html).toContain(longText);
  });

  it('falls back to a generic heading when the note has no title', () => {
    const html = renderToStaticMarkup(createElement(NoteCard, { note: note({ title: undefined }), onClose: () => {} }));
    expect(html).toContain('>Note<');
  });

  it('uses the note\'s own title when it has one', () => {
    const html = renderToStaticMarkup(createElement(NoteCard, { note: note({ title: 'Trailhead' }), onClose: () => {} }));
    expect(html).toContain('>Trailhead<');
  });

  it('docks in the same inspector shell as PlaceCard, for the same slot', () => {
    const html = renderToStaticMarkup(createElement(NoteCard, { note: note(), onClose: () => {} }));
    expect(html).toContain('atlas-inspector');
  });
});
