/**
 * The scene editor's two new controls: the background picker and the narration
 * field.
 *
 * Rendered with `react-dom/server`, like `scene-ui-editor` and `scene-ui-list`
 * — this workspace's suites run in node with no DOM, and static markup answers
 * everything that matters here: which tile is marked as the one on the slide,
 * that an empty picker *says why* instead of sitting blank, that a refused
 * narration URL is announced rather than stored, and that both fields can be
 * cleared. The behaviour behind the markup lives in `sceneMedia.ts` and is
 * tested next door in `scene-media-candidates`.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { STORY_SCHEMA_ID, type Item, type Scene, type Story } from '@companion-atlas/story';
import {
  SceneEditor,
  backgroundNote,
  unresolvedNote,
  type SceneEditorProps,
} from '../src/scenes/SceneEditor.js';
import { AUDIO_URL_REJECTED, checkAudioUrl } from '../src/scenes/sceneMedia.js';

const noop = () => {};

const render = (props: Partial<SceneEditorProps> & { scene: Scene | null }): string =>
  renderToStaticMarkup(
    createElement(SceneEditor, {
      index: 0,
      count: 1,
      onPatch: noop,
      onRemove: noop,
      onCaptureCamera: () => null,
      ...props,
    }),
  );

const story = (parts: Partial<Story>): Story =>
  ({ schema: STORY_SCHEMA_ID, id: 'story-1', title: 'A story', scenes: [], ...parts }) as Story;

const photo = (id: string, url: string, title?: string): Item =>
  ({ id, type: 'photo', position: { lat: 64.14, lon: -21.94 }, media: { url }, ...(title ? { title } : {}) }) as Item;

const withPhotos = story({
  items: [
    photo('p1', 'https://cdn.example.com/harbour.jpg', 'The harbour'),
    photo('p2', 'https://cdn.example.com/glacier.jpg', 'The glacier'),
  ],
});

describe('the background picker', () => {
  it('shows the story’s pictures rather than a list of ids', () => {
    // The whole reason this is not a text field: `p1` is not a photo, and
    // "attach the harbour photo" is a decision made by looking.
    const html = render({ scene: { id: 's1' }, story: withPhotos });
    expect(html).toContain('src="https://cdn.example.com/harbour.jpg"');
    expect(html).toContain('The harbour');
    expect(html).toContain('The glacier');
  });

  it('marks the attached tiles, and says in words which one is on the slide', () => {
    const html = render({ scene: { id: 's1', itemIds: ['p2', 'p1'] }, story: withPhotos });
    // Scoped to the tiles: the layout picker is also a group of pressed
    // buttons, and counting every `aria-pressed` in the panel would pass for
    // the wrong reason.
    expect(html.match(/class="sc-thumb[^"]*"\s*aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/class="sc-thumb showing"/g)).toBeNull(); // showing implies active
    // Decided by the story's order, not the scene's — see `backgroundCandidate`.
    expect(html).toContain('On the slide');
    expect(html).toContain('“The harbour” is on the slide');
    expect(html).not.toContain('“The glacier” is on the slide');
  });

  it('offers a way back to no background at all', () => {
    expect(render({ scene: { id: 's1', itemIds: ['p1'] }, story: withPhotos })).toContain('Use none');
    // Nothing attached: nothing to clear, and a dead button would be noise.
    expect(render({ scene: { id: 's1' }, story: withPhotos })).not.toContain('Use none');
  });

  it('says which of the three background states the scene is in', () => {
    // The middle one is the one an author cannot diagnose from the slide:
    // ids attached, nothing shown, and the presentation quietly falling back
    // to the story's cover.
    expect(backgroundNote({ label: 'The harbour' } as never, 1)).toContain('is on the slide');
    expect(backgroundNote(null, 2)).toContain('falls back');
    expect(backgroundNote(null, 0)).toContain('Optional');
  });

  it('explains an empty picker instead of showing an empty box', () => {
    // A Companion Memory archive: hundreds of photos, every one at an internal
    // address. "Nothing here" would send the author looking for a bug.
    const unreachable = story({
      items: [photo('p1', 'ci-memory://demo/reykjavik.jpg')],
    });
    const html = render({ scene: { id: 's1' }, story: unreachable });
    expect(html).toContain('ci-memory://');
    expect(html).not.toContain('<img class="sc-thumb-img"');

    // A KML import: places, no pictures, and a different sentence.
    const noPictures = render({ scene: { id: 's1' }, story: story({}) });
    expect(noPictures).toContain('no photos or videos');
  });

  it('mentions attached entities that have no picture to show', () => {
    // `sceneFromMemory` seeds exactly this, so "Use none" must not look like it
    // is clearing something that was never on screen.
    const html = render({ scene: { id: 's1', itemIds: ['p1', 'ghost'] }, story: withPhotos });
    expect(html).toContain('no picture to show (ghost)');
    expect(unresolvedNote([])).toBeNull();
    expect(unresolvedNote(['a', 'b', 'c'])).toContain('3 entities');
    expect(unresolvedNote(['a', 'b', 'c'])).toContain('a, b, …');
  });

  it('renders without a story at all, because the panel must stay mountable', () => {
    const html = render({ scene: { id: 's1' } });
    expect(html).toContain('Background');
    expect(html).toContain('no photos or videos');
  });
});

describe('the narration field', () => {
  it('shows the scene’s track and offers a way to hear it', () => {
    // An author who cannot play back what they attached is guessing.
    const html = render({
      scene: { id: 's1', audioUrl: 'https://cdn.example.com/narration.mp3' },
      story: withPhotos,
    });
    expect(html).toContain('value="https://cdn.example.com/narration.mp3"');
    expect(html).toContain('<audio');
    expect(html).toContain('controls');
    expect(html).toContain('Clear narration');
  });

  it('offers no player and no clear when there is nothing attached', () => {
    const html = render({ scene: { id: 's1' }, story: withPhotos });
    expect(html).not.toContain('<audio');
    expect(html).not.toContain('Clear narration');
  });

  it('never builds a player for a URL the presenter would drop', () => {
    // The scene can carry one — it arrived in a document, or from an older
    // build. Handing it to an <audio> would be a control that plays silence.
    const html = render({ scene: { id: 's1', audioUrl: 'ci-memory://demo/track.mp3' }, story: withPhotos });
    expect(html).not.toContain('<audio');
    expect(checkAudioUrl('ci-memory://demo/track.mp3')).toEqual({ state: 'rejected', reason: AUDIO_URL_REJECTED });
  });

  it('labels the player, so a page of controls is not a page of “audio”', () => {
    const html = render({
      scene: { id: 's1', title: 'Reykjavik', audioUrl: 'https://cdn.example.com/n.mp3' },
      story: withPhotos,
    });
    expect(html).toContain('aria-label="Narration for Reykjavik"');
  });

  it('keeps its help text tied to the input', () => {
    const html = render({ scene: { id: 's1' }, story: withPhotos });
    const described = /aria-describedby="([^"]*audio-help)"/.exec(html);
    expect(described).not.toBeNull();
    expect(html).toContain(`id="${described![1]}"`);
  });
});

describe('problems from the exporter', () => {
  it('shows an itemIds or audioUrl complaint beside the field that caused it', () => {
    const html = render({
      scene: { id: 's1' },
      story: withPhotos,
      problems: [
        { sceneId: 's1', field: 'itemIds.0', message: 'Expected string, received number' },
        { sceneId: 's1', field: 'audioUrl', message: 'Expected string, received number' },
      ],
    });
    // Twice — once under each field — and not a third time in the catch-all
    // list at the bottom of the panel.
    expect(html.match(/Expected string, received number/g)).toHaveLength(2);
  });
});
