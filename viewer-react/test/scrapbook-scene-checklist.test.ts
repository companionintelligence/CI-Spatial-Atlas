/**
 * The Scenes section of the scrapbook drawer — where a written scene becomes
 * a journey stop rather than something only ever tacked onto the end of a
 * saved document.
 *
 * Rendered with `react-dom/server`, same as the Scene editor's own suite:
 * this workspace runs in node with no DOM, and static markup answers what
 * matters here — which section is showing, which boxes are checked, and
 * whether Curate/Play can be pressed.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Scene } from '@companion-atlas/story';
import { ScrapbookDrawer } from '../src/ui/ScrapbookDrawer.js';
import type { AtlasMemory } from '../src/model/atlasModel.js';

const noop = () => {};

const MEMORY: AtlasMemory = {
  id: 'm1', title: 'Harbour', timeMs: 0, whenDate: 'Jun 1', whenTime: '1 PM', tod: 'day', gradient: 'g',
};
const SCENES: Scene[] = [
  { id: 's1', title: 'Arrival' } as unknown as Scene,
  { id: 's2', title: 'Departure' } as unknown as Scene,
];

const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(ScrapbookDrawer, {
    open: true, entries: [], title: '', visibility: 'private', canSave: true,
    canClear: false, saveState: { s: 'idle' },
    onClose: noop, onTitle: noop, onVisibility: noop, onRemove: noop, onClear: noop,
    onCurate: noop, onPlay: noop, onSave: noop, onDownload: noop,
    ...over,
  }));

describe('offering the deck as journey stops', () => {
  it('is absent when there are no authored scenes at all', () => {
    const html = render({ scenes: [] });
    expect(html).not.toContain('journey stops');
  });

  it('lists every scene when there are some', () => {
    const html = render({ scenes: SCENES });
    expect(html).toContain('Arrival');
    expect(html).toContain('Departure');
  });

  it('checks the boxes the caller says are selected', () => {
    const checkedHtml = render({ scenes: SCENES, selectedSceneIds: new Set(['s1']) });
    // React SSR emits `checked=""` only for the checked box.
    const checkboxes = checkedHtml.match(/<input type="checkbox"[^>]*>/g) ?? [];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toContain('checked=""');
    expect(checkboxes[1]).not.toContain('checked=""');
  });

  it('says how many scenes are in the journey once some are checked', () => {
    const html = render({ scenes: SCENES, selectedSceneIds: new Set(['s1', 's2']) });
    expect(html).toMatch(/2 scenes will play/);
  });

  it('says an unchecked scene still saves, just not as a journey stop', () => {
    const html = render({ scenes: SCENES, selectedSceneIds: new Set() });
    expect(html).toMatch(/still save.*not.*journey/i);
  });
});

describe('Curate and Play operate on the journey, not only on collected memories', () => {
  it('are disabled with nothing collected and nothing checked in', () => {
    const html = render({ entries: [], scenes: SCENES, selectedSceneIds: new Set() });
    expect(html).toMatch(/Curate with Companion<\/button>/); // sanity: button exists
    const curateBtn = html.match(/<button[^>]*>[^<]*<svg[^>]*>.*?<\/svg>Curate with Companion<\/button>/s)?.[0] ?? '';
    expect(curateBtn).toContain('disabled');
  });

  it('are enabled when a scene is checked in, even with nothing collected', () => {
    // This is the actual gap being closed: a written scene, with no collected
    // memories at all, must be playable/curatable as its own one-stop journey.
    const html = render({ entries: [], scenes: SCENES, selectedSceneIds: new Set(['s1']) });
    const curateBtn = html.match(/<button[^>]*>[^<]*<svg[^>]*>.*?<\/svg>Curate with Companion<\/button>/s)?.[0] ?? '';
    expect(curateBtn).not.toContain('disabled');
  });

  it('are enabled when memories are collected, even with no scene checked in', () => {
    const html = render({ entries: [MEMORY], scenes: SCENES, selectedSceneIds: new Set() });
    const curateBtn = html.match(/<button[^>]*>[^<]*<svg[^>]*>.*?<\/svg>Curate with Companion<\/button>/s)?.[0] ?? '';
    expect(curateBtn).not.toContain('disabled');
  });
});
