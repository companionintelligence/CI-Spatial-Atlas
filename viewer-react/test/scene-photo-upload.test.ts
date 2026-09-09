/**
 * Uploading a photo directly into a scene.
 *
 * `src/upload/` and `MediaUploadSection` already existed — this is the third
 * caller for both, alongside the Import & export panel. What is new here is
 * narrow and specific to the scene context: the upload has to attach itself
 * (uploading from inside a scene means "use this," not "add this to the
 * story and maybe pick it later"), and it has to be pinned at the scene's own
 * declared view rather than wherever the live camera happens to be.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Scene } from '@companion-atlas/story';
import { SceneEditor, scenePhotoPatch, type SceneEditorProps } from '../src/scenes/SceneEditor.js';
import type { ImportedFile } from '../src/interop/importFile.js';

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

const SCENE: Scene = { id: 's1', title: 'Harbour' } as Scene;

const uploaded = (over: Partial<ImportedFile> = {}): ImportedFile => ({
  fileName: 'photo.jpg',
  format: 'media',
  items: [{ id: 'upload-abc', type: 'photo', position: { lat: 1, lon: 2 }, media: { url: 'https://x/y.jpg' } } as never],
  ...over,
});

describe('what an upload from inside a scene attaches', () => {
  it('attaches the one item it produced', () => {
    const patch = scenePhotoPatch(uploaded(), []);
    expect(patch).toEqual({ itemIds: ['upload-abc'] });
  });

  it('adds to what is already attached, rather than replacing it', () => {
    const patch = scenePhotoPatch(uploaded(), ['existing-1']);
    expect(patch?.itemIds).toEqual(expect.arrayContaining(['existing-1', 'upload-abc']));
  });

  it('attaches nothing for an upload that failed', () => {
    // Already has its own message on screen, in the upload section itself —
    // this must not additionally claim an attachment that does not exist.
    expect(scenePhotoPatch(uploaded({ items: [], error: 'network error' }), [])).toBeNull();
  });

  it('attaches nothing for an upload with nowhere to pin it', () => {
    // `MediaUploadSection`'s "uploaded, but not placed" case: no error, but no
    // item either.
    expect(scenePhotoPatch(uploaded({ items: [] }), [])).toBeNull();
  });
});

describe('the upload control in the panel', () => {
  it('is offered when the caller supplies a handler', () => {
    const html = render({ scene: SCENE, onUploadPhoto: noop });
    expect(html).toContain('Add a new photo');
  });

  it('is absent when the caller does not', () => {
    // The same "mountable with nothing to offer" rule the background picker
    // and the memory-import section already follow.
    const html = render({ scene: SCENE });
    expect(html).not.toContain('Add a new photo');
  });

  it('says what makes it different from the generic upload panel', () => {
    const html = render({ scene: SCENE, onUploadPhoto: noop });
    expect(html).toMatch(/attached to this scene/i);
  });
});
