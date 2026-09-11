/**
 * The authored deck's rules.
 *
 * Two of them are the reason this file exists rather than being covered by a
 * screenshot. **Order is authorial** — a deck that silently re-sorted by time
 * would turn a flashback into a prologue and look completely normal — and
 * **a scene must survive `Story.parse`**, because the alternative is a save
 * that throws after the work is done and takes the drawn shapes, the layers and
 * the scrapbook down with it.
 */
import { describe, expect, it } from 'vitest';
import { Scene as SceneSchema, type Camera, type Scene } from '@companion-atlas/story';
import {
  createScene,
  dedupeScenes,
  exportableScenes,
  findScene,
  hasUsableLocation,
  indexOfSceneId,
  isAuthoredSceneId,
  makeSceneId,
  MEMORY_SCENE_PITCH_DEG,
  MEMORY_SCENE_RANGE_M,
  moveScene,
  moveSceneToIndex,
  patchScene,
  removeScene,
  sceneFromCamera,
  sceneFromMemory,
  updateScene,
  upsertScene,
  validateScene,
  validateScenes,
} from '../src/scenes/model.js';

const pose: Camera = { lon: -21.94, lat: 64.14, height: 800, heading: 12, pitch: -35, roll: 0 };

const deck = (...ids: string[]): Scene[] => ids.map((id) => ({ id, title: id }));
const ids = (scenes: readonly Scene[]): string[] => scenes.map((s) => s.id);

describe('ids', () => {
  it('mints namespaced ids that never collide with what is already taken', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = makeSceneId(taken);
      expect(taken.has(id)).toBe(false);
      expect(isAuthoredSceneId(id)).toBe(true);
      taken.add(id);
    }
  });

  it('terminates even when the generator keeps repeating itself', () => {
    // `randomSuffix` falls back to `Math.random` where there is no `crypto`, and
    // a stubbed or poorly seeded one can repeat. The loop must lengthen rather
    // than spin.
    const seen = new Set(['x']);
    const first = makeSceneId(seen);
    expect(makeSceneId([...seen, first])).not.toBe(first);
  });

  it('does not claim a document\'s own scene id as ours', () => {
    // An adopted scene keeps the document's id so the export merge replaces it
    // in place; `isAuthoredSceneId` must not be used to gate editing.
    expect(isAuthoredSceneId('scene-1')).toBe(false);
    expect(isAuthoredSceneId(undefined)).toBe(false);
  });
});

describe('creating', () => {
  it('leaves unset fields absent rather than empty', () => {
    // `title: ''` in an export is a scene claiming a title and showing nothing.
    const scene = createScene({ title: '   ', narrative: '' });
    expect('title' in scene).toBe(false);
    expect('narrative' in scene).toBe(false);
    expect(SceneSchema.safeParse(scene).success).toBe(true);
  });

  it('keeps what it is given, and parses', () => {
    const scene = createScene({ title: ' Reykjavik ', narrative: '# Hello', layout: 'split', camera: pose });
    expect(scene.title).toBe('Reykjavik');
    expect(scene.layout).toBe('split');
    expect(scene.camera).toEqual(pose);
    expect(validateScene(scene)).toEqual([]);
  });

  it('drops a layout no renderer knows', () => {
    // `sceneLayout` already falls back, so storing it would stay invisible right
    // up until the export met a stricter reader.
    const scene = createScene({ layout: 'card-diagonal' as never });
    expect('layout' in scene).toBe(false);
  });
});

describe('sceneFromCamera', () => {
  it('turns a captured pose into an exportable scene', () => {
    const scene = sceneFromCamera(pose, { title: 'This view' });
    expect(scene?.camera).toEqual(pose);
    expect(validateScene(scene)).toEqual([]);
  });

  it('refuses a pose the globe has not resolved yet', () => {
    // Cesium reports NaN during the first frame and mid-flyTo. `Camera`'s own
    // refine only checks that lon/lat are *present*, and NaN is present — a
    // scene holding it presents as a black screen.
    expect(sceneFromCamera({ lon: Number.NaN, lat: 64.14 })).toBeNull();
    expect(sceneFromCamera(null)).toBeNull();
    expect(sceneFromCamera({ lat: 64.14 } as Camera)).toBeNull();
  });
});

describe('sceneFromMemory', () => {
  const memory = {
    id: 'mem-7',
    title: 'Adler Theater',
    narrative: 'The night of the storm.',
    timeMs: Date.UTC(2019, 5, 17, 19, 41),
    lat: 41.52,
    lon: -90.57,
    place: 'Davenport',
  };

  it('pre-fills title, time and a camera, and highlights the memory', () => {
    const scene = sceneFromMemory(memory);
    expect(scene.title).toBe('Adler Theater');
    expect(scene.time).toBe(new Date(memory.timeMs).toISOString());
    expect(scene.itemIds).toEqual(['mem-7']);
    expect(scene.camera).toMatchObject({
      lon: -90.57,
      lat: 41.52,
      range: MEMORY_SCENE_RANGE_M,
      pitch: MEMORY_SCENE_PITCH_DEG,
    });
    expect(validateScene(scene)).toEqual([]);
  });

  it('prefers the live view when the caller captured one', () => {
    // "Add a scene here" from the globe means *this* view, not a computed
    // overhead shot of the pin.
    expect(sceneFromMemory(memory, { camera: pose }).camera).toEqual(pose);
  });

  it('survives a memory with no position and no time', () => {
    const scene = sceneFromMemory({ id: 'mem-8' });
    expect('camera' in scene).toBe(false);
    expect('time' in scene).toBe(false);
    // A scene with no camera is a legitimate title card, not an error.
    expect(validateScene(scene)).toEqual([]);
  });

  it('falls back to the place name when the memory is untitled', () => {
    expect(sceneFromMemory({ id: 'm', place: 'Keflavik' }).title).toBe('Keflavik');
  });
});

describe('patching', () => {
  const base = createScene({ id: 's1', title: 'One', narrative: 'Body', layout: 'split', camera: pose });

  it('null clears a field; absent leaves it alone', () => {
    const next = patchScene(base, { title: null });
    expect('title' in next).toBe(false);
    expect(next.narrative).toBe('Body');
    expect(next.layout).toBe('split');
  });

  it('treats an emptied text field as cleared, not as whitespace', () => {
    // Otherwise `buildDeck`'s `title?.trim() || 'Scene N'` never fires: three
    // spaces are truthy before the trim happens.
    expect('title' in patchScene(base, { title: '   ' })).toBe(false);
  });

  it('returns the same object when nothing moved', () => {
    // A new scene object per keystroke rebuilds every slide's parsed Markdown.
    expect(patchScene(base, { title: 'One' })).toBe(base);
    expect(patchScene(base, {})).toBe(base);
  });

  it('drops the legacy caption when the narrative is edited', () => {
    // `sceneNarrative` reads `narrative ?? caption`, so a surviving caption
    // would make the field look uneditable with nothing to explain it.
    const legacy = { id: 's', caption: 'old' } as Scene;
    const next = patchScene(legacy, { narrative: 'new' });
    expect(next.narrative).toBe('new');
    expect('caption' in next).toBe(false);
  });

  it('drops the legacy items spelling when itemIds are set', () => {
    const legacy = { id: 's', items: ['a'] } as Scene;
    const next = patchScene(legacy, { itemIds: ['b'] });
    expect(next.itemIds).toEqual(['b']);
    expect('items' in next).toBe(false);
  });

  it('clears itemIds when the list empties', () => {
    const with2 = patchScene(base, { itemIds: ['a', 'b'] });
    expect('itemIds' in patchScene(with2, { itemIds: [] })).toBe(false);
  });

  it('updateScene leaves the deck alone for an unknown id or a no-op', () => {
    const list = [base];
    expect(updateScene(list, 'nope', { title: 'x' })).toBe(list);
    expect(updateScene(list, 's1', { title: 'One' })).toBe(list);
  });
});

describe('ordering', () => {
  it('upsert replaces in place and never moves the scene', () => {
    const list = deck('a', 'b', 'c');
    const next = upsertScene(list, { id: 'b', title: 'edited' });
    expect(ids(next)).toEqual(['a', 'b', 'c']);
    expect(next[1].title).toBe('edited');
  });

  it('upsert appends an unknown id', () => {
    expect(ids(upsertScene(deck('a'), { id: 'b' }))).toEqual(['a', 'b']);
  });

  it('moves one step, and clamps rather than wrapping at both ends', () => {
    const list = deck('a', 'b', 'c');
    expect(ids(moveScene(list, 'b', 1))).toEqual(['a', 'c', 'b']);
    expect(ids(moveScene(list, 'b', -1))).toEqual(['b', 'a', 'c']);
    // Wrapping would be indistinguishable from the button not working.
    expect(moveScene(list, 'c', 1)).toBe(list);
    expect(moveScene(list, 'a', -1)).toBe(list);
    expect(moveScene(list, 'nope', 1)).toBe(list);
  });

  it('drops at an explicit index, counted in the final list', () => {
    const list = deck('a', 'b', 'c', 'd');
    expect(ids(moveSceneToIndex(list, 'a', 2))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(moveSceneToIndex(list, 'd', 0))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('clamps a drop past the ends instead of refusing it', () => {
    const list = deck('a', 'b', 'c');
    expect(ids(moveSceneToIndex(list, 'a', 99))).toEqual(['b', 'c', 'a']);
    expect(ids(moveSceneToIndex(list, 'c', -4))).toEqual(['c', 'a', 'b']);
    expect(moveSceneToIndex(list, 'b', Number.NaN)).toEqual(deck('b', 'a', 'c'));
    expect(moveSceneToIndex(list, 'b', 1)).toBe(list);
  });

  it('never re-sorts by time', () => {
    // The flashback test: an opening scene dated after the one that follows it
    // is the author's decision, and `buildDeck` reads the array as written.
    const list: Scene[] = [
      { id: 'end', time: '2024-06-01T00:00:00Z' },
      { id: 'flashback', time: '2018-01-01T00:00:00Z' },
      { id: 'now', time: '2025-01-01T00:00:00Z' },
    ];
    expect(ids(upsertScene(list, { id: 'flashback', title: 'six years earlier' })))
      .toEqual(['end', 'flashback', 'now']);
    expect(ids(removeScene(list, 'now'))).toEqual(['end', 'flashback']);
    expect(ids(exportableScenes(list))).toEqual(['end', 'flashback', 'now']);
  });

  it('removes, finds and indexes', () => {
    const list = deck('a', 'b');
    expect(ids(removeScene(list, 'a'))).toEqual(['b']);
    expect(removeScene(list, 'nope')).toBe(list);
    expect(findScene(list, 'b')?.id).toBe('b');
    expect(findScene(list, null)).toBeNull();
    expect(indexOfSceneId(list, 'b')).toBe(1);
    expect(indexOfSceneId(list, 'zz')).toBe(-1);
  });

  it('dedupes on first occurrence, so the survivor keeps its position', () => {
    const list = [{ id: 'a', title: 'first' }, { id: 'b' }, { id: 'a', title: 'second' }];
    const out = dedupeScenes(list);
    expect(ids(out)).toEqual(['a', 'b']);
    expect(out[0].title).toBe('first');
  });
});

describe('validation', () => {
  it('accepts a scene with nothing but an id', () => {
    expect(validateScene({ id: 's' })).toEqual([]);
  });

  it('rejects what Story.parse would reject, with the field that caused it', () => {
    const problems = validateScene({ id: 's', time: 'last Tuesday' });
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe('time');
    // The honest test is the schema's own, because that is what a save runs.
    expect(SceneSchema.safeParse({ id: 's', time: 'last Tuesday' }).success).toBe(false);
  });

  it('names a missing id in plain words, once', () => {
    const problems = validateScene({ title: 'orphan' });
    expect(problems.filter((p) => p.field === 'id')).toHaveLength(1);
  });

  it('catches an out-of-range camera the schema is happy with', () => {
    // `lat: 500` is a perfectly good `z.number()` and a place that does not
    // exist. Cesium accepts it and shows a black screen with nothing logged.
    const offWorld = { id: 's', camera: { lon: 10, lat: 500 } };
    expect(SceneSchema.safeParse(offWorld).success).toBe(true);
    expect(validateScene(offWorld)[0]?.field).toBe('camera');

    expect(hasUsableLocation({ lon: 0, lat: 91 })).toBe(false);
    expect(hasUsableLocation({ location: { lon: 10, lat: 20 } })).toBe(true);
    // NaN the schema does reject — but only at export, long after the user
    // wrote a scene around it, which is why `sceneFromCamera` refuses it first.
    expect(hasUsableLocation({ lon: Number.NaN, lat: 64 })).toBe(false);
    expect(SceneSchema.safeParse({ id: 's', camera: { lon: Number.NaN, lat: 64 } }).success).toBe(false);
  });

  it('reports a duplicate id, which no single scene can see', () => {
    const problems = validateScenes([{ id: 'a' }, { id: 'a' }]);
    expect(problems.some((p) => p.field === 'id' && p.message.includes('share'))).toBe(true);
  });

  it('exportableScenes keeps the good ones and drops the rest', () => {
    // A save carries the drawn shapes, the layers and the scrapbook too; one
    // malformed scene must not take all of that down with it.
    const list = [
      { id: 'ok' },
      { id: 'broken', time: 'whenever' },
      { id: 'ok' },
      { id: 'fine', camera: pose },
    ] as Scene[];
    expect(ids(exportableScenes(list))).toEqual(['ok', 'fine']);
  });
});
