/**
 * Present mode's rules, tested away from React.
 *
 * Three schema fields — `Scene.layout`, `Scene.transition`, `Scene.audioUrl` —
 * have been carried by the canonical `Story` since the two data models were
 * consolidated and read by nothing. Making them real means making a pile of
 * small decisions that are invisible in a screenshot and expensive to get
 * wrong: which layout an unknown value falls back to, which of the two legacy
 * transition spellings wins, whether the stepper wraps at the ends, whether a
 * `ci-memory://` URL is allowed near an `<img>`, and what happens when the
 * browser refuses to autoplay a narration. All of that lives in
 * `sceneDeck.ts` / `sceneAudio.ts` precisely so it can be argued about here
 * rather than in a headset — the same split the `xr-*` suites use.
 *
 * The fixture is a real-shaped story: five scenes with the mix of authored and
 * legacy fields a document actually arrives with.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Scene, Story } from '@companion-atlas/story';
import {
  buildDeck,
  canStep,
  clampIndex,
  DEFAULT_FLY_MS,
  DEFAULT_LAYOUT,
  indexOfScene,
  isTypingTarget,
  keyToCommand,
  layoutHidesGlobe,
  MAX_FLY_MS,
  positionLabel,
  sceneBackground,
  sceneLayout,
  sceneTimeMs,
  sceneTransition,
  slideCamera,
  stepIndex,
} from '../src/ui/sceneDeck.js';
import { createSceneAudio, type AudioElementLike } from '../src/ui/sceneAudio.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/**
 * "Pacific Crossing" as a *presentation*: the bundled sample story's route,
 * annotated with the presentation fields a story author would add. Scene order
 * is deliberately not chronological — the coda is dated before the Singapore
 * scene it follows, which is how a flashback reaches the viewer.
 */
const PACIFIC: Story = {
  schema: 'companion.atlas/story@1',
  id: 'story-pacific-journey',
  title: 'Pacific Crossing, Spring 2026',
  description: 'Three geotagged memories sequenced into a 4D timeline.',
  cover: 'https://cdn.example/pacific/cover.jpg',
  timeline: { start: '2026-03-14T08:00:00Z', stop: '2026-03-14T09:10:00Z' },
  media: [
    {
      id: 'media-reykjavik',
      kind: 'image',
      uri: 'https://cdn.example/pacific/reykjavik.jpg',
      caption: 'North Atlantic checkpoint at dawn.',
      capturedAt: '2026-03-14T08:00:00Z',
      location: { lat: 64.1466, lon: -21.9426 },
    },
    {
      id: 'media-accra',
      kind: 'video',
      // The address the pipeline resolves, not one an <img> can load — exactly
      // what the bundled sample carries today.
      uri: 'ci-memory://demo/accra.mp4',
      thumbnailUri: 'https://cdn.example/pacific/accra-poster.jpg',
      capturedAt: '2026-03-14T08:35:00Z',
      location: { lat: 5.6037, lon: -0.187 },
    },
    {
      id: 'media-singapore',
      kind: 'image-set',
      uri: 'ci-memory://demo/singapore/',
      capturedAt: '2026-03-14T09:10:00Z',
      location: { lat: 1.3521, lon: 103.8198 },
    },
  ],
  scenes: [
    {
      id: 'scene-title',
      title: 'Pacific Crossing',
      narrative: 'Eleven hours, three continents, and one very long afternoon.\n\nRecorded by **earth-operator**.',
      layout: 'fullscreen',
      transition: { kind: 'cut' },
    },
    {
      id: 'scene-reykjavik',
      title: 'North Atlantic Checkpoint',
      narrative: 'The journey opens over *Reykjavik* at first light.',
      time: '2026-03-14T08:00:00Z',
      camera: { location: { lat: 64.1466, lon: -21.9426 }, pitch: -35, range: 4200 },
      mediaIds: ['media-reykjavik'],
      transition: { kind: 'fly', durationMs: 1600 },
      layout: 'card-left',
      audioUrl: 'https://cdn.example/pacific/reykjavik.m4a',
    },
    {
      id: 'scene-accra',
      title: 'Equatorial Corridor',
      narrative: 'A splat reconstruction drops in over the coast of Accra.',
      time: '2026-03-14T08:35:00Z',
      camera: { location: { lat: 5.6037, lon: -0.187 }, pitch: -40, range: 2600 },
      mediaIds: ['media-accra'],
      // The Earth-2 spelling. Both survive in stored documents.
      transition: { type: 'flyTo' },
      layout: 'card-right',
    },
    {
      id: 'scene-singapore',
      title: 'Strait Relay',
      // The legacy field name; `sceneNarrative` folds it into `narrative`.
      caption: 'Reconstructed from 42 photos, stitched over the strait.',
      time: '2026-03-14T09:10:00Z',
      // The Earth-2 free camera form: lon/lat at the top level, no `location`.
      camera: { lon: 103.8198, lat: 1.3521, height: 2400, heading: 118, pitch: -28 },
      itemIds: ['media-singapore'],
      transition: { kind: 'fly', durationMs: 45_000 },
      layout: 'split',
      // A pipeline-internal address: must not reach an <audio> element.
      audioUrl: 'ci-memory://demo/singapore-narration.m4a',
    },
    {
      id: 'scene-coda',
      // No title, no layout, no transition, and dated *before* the scene above.
      narrative: 'Six weeks earlier, none of this was planned.',
      time: '2026-01-30T21:04:00Z',
      camera: { location: { lat: 41.5236, lon: -90.5776 } },
    },
  ],
};

const deck = buildDeck(PACIFIC);

// ---------------------------------------------------------------------------

describe('sceneLayout', () => {
  it('honours every value the schema defines', () => {
    expect(deck.map((s) => s.layout)).toEqual([
      'fullscreen', 'card-left', 'card-right', 'split', DEFAULT_LAYOUT,
    ]);
  });

  it('falls back for an absent layout', () => {
    expect(sceneLayout({ layout: undefined })).toBe('card-left');
    expect(sceneLayout(null)).toBe('card-left');
  });

  it('falls back for a value the schema does not define', () => {
    // Reachable: stories load through paths that normalise without a full Zod
    // pass, and an unknown string here would render an unstyled slide.
    expect(sceneLayout({ layout: 'card-top' as Scene['layout'] })).toBe('card-left');
    expect(sceneLayout({ layout: '' as Scene['layout'] })).toBe('card-left');
  });

  it('knows which layout takes the globe away', () => {
    expect(layoutHidesGlobe('fullscreen')).toBe(true);
    for (const l of ['card-left', 'card-right', 'card-bottom', 'split'] as const) {
      expect(layoutHidesGlobe(l), l).toBe(false);
    }
  });
});

describe('sceneTransition', () => {
  it('reads the Atlas spelling', () => {
    expect(deck[1]!.transition).toEqual({ kind: 'fly', durationMs: 1600 });
  });

  it('reads the Earth-2 spelling and defaults its duration', () => {
    expect(deck[2]!.transition).toEqual({ kind: 'fly', durationMs: DEFAULT_FLY_MS });
  });

  it('collapses a cut to a zero duration, so a caller needs no second branch', () => {
    expect(deck[0]!.transition).toEqual({ kind: 'cut', durationMs: 0 });
  });

  it('clamps a flight nobody would sit through', () => {
    expect(deck[3]!.transition).toEqual({ kind: 'fly', durationMs: MAX_FLY_MS });
  });

  it('falls back to the older Camera.durationMs when the scene only sets that', () => {
    expect(sceneTransition({ camera: { location: { lat: 1, lon: 2 }, durationMs: 900 } }))
      .toEqual({ kind: 'fly', durationMs: 900 });
  });

  it('ignores a nonsense duration rather than passing NaN to the camera', () => {
    expect(sceneTransition({ transition: { durationMs: Number.NaN } }).durationMs).toBe(DEFAULT_FLY_MS);
    expect(sceneTransition({ transition: { durationMs: -400 } }).durationMs).toBe(DEFAULT_FLY_MS);
  });

  it('turns every transition into a cut under reduced motion', () => {
    for (const scene of PACIFIC.scenes) {
      expect(sceneTransition(scene, true), scene.id).toEqual({ kind: 'cut', durationMs: 0 });
    }
    expect(buildDeck(PACIFIC, { reduceMotion: true }).every((s) => s.transition.kind === 'cut')).toBe(true);
  });
});

describe('buildDeck', () => {
  it('keeps the author’s order, not the clock’s', () => {
    // `deriveModel` sorts by time because a clock has one direction. A
    // presentation does not: sorting the coda to the front rewrites a flashback
    // into a prologue, which is a different story from the one that was
    // written.
    expect(deck.map((s) => s.id)).toEqual([
      'scene-title', 'scene-reykjavik', 'scene-accra', 'scene-singapore', 'scene-coda',
    ]);
    expect(deck[4]!.timeMs!).toBeLessThan(deck[3]!.timeMs!);
  });

  it('names an untitled scene by its position', () => {
    expect(deck[4]!.title).toBe('Scene 5');
  });

  it('parses the narrative as Markdown and keeps a plain-text summary', () => {
    const title = deck[0]!;
    expect(title.body.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
    expect(title.summary).toBe(
      'Eleven hours, three continents, and one very long afternoon. Recorded by earth-operator.',
    );
    // The legacy `caption` is folded in, so an Earth-2 document still narrates.
    expect(deck[3]!.summary).toBe('Reconstructed from 42 photos, stitched over the strait.');
  });

  it('resolves a background image from the entities the scene already highlights', () => {
    expect(deck[1]!.backgroundUrl).toBe('https://cdn.example/pacific/reykjavik.jpg');
    // A video contributes its poster, never its `uri`.
    expect(deck[2]!.backgroundUrl).toBe('https://cdn.example/pacific/accra-poster.jpg');
  });

  it('falls back to the story cover rather than to a broken-image glyph', () => {
    // `media-singapore` is a `ci-memory://` address with no thumbnail.
    expect(deck[3]!.backgroundUrl).toBe('https://cdn.example/pacific/cover.jpg');
  });

  it('drops a scene audio URL that is not fetchable', () => {
    expect(deck[1]!.audioUrl).toBe('https://cdn.example/pacific/reykjavik.m4a');
    expect(deck[3]!.audioUrl).toBeUndefined();
    expect(deck[0]!.audioUrl).toBeUndefined();
  });

  it('cycles the fallback tint so neighbouring slides never share one', () => {
    expect(deck.map((s) => s.tintClass)).toEqual(['pr-tint-0', 'pr-tint-1', 'pr-tint-2', 'pr-tint-3', 'pr-tint-4']);
  });

  it('labels the time in local solar hours at the scene, not in the reader’s timezone', () => {
    // 08:00 UTC over Reykjavik (lon -21.94) is 06:32 in the sky the slide shows.
    // Reading the browser's timezone instead would put a "night" slide over a
    // sunlit globe, which is the contradiction the rest of the shell avoids.
    expect(deck[1]!.when).toEqual({ date: 'Mar 14, 2026', time: '6:32 AM' });
    // 09:10 UTC over Singapore (lon 103.82) is late afternoon.
    expect(deck[3]!.when).toEqual({ date: 'Mar 14, 2026', time: '4:05 PM' });
    expect(deck[0]!.when).toBeNull(); // the title card has no time
  });

  it('survives a story with no scenes', () => {
    expect(buildDeck({ ...PACIFIC, scenes: [] })).toEqual([]);
  });
});

describe('sceneTimeMs / slideCamera', () => {
  it('reads both time forms and refuses an unparseable one', () => {
    expect(sceneTimeMs('2026-03-14T08:00:00Z')).toBe(Date.parse('2026-03-14T08:00:00Z'));
    expect(sceneTimeMs({ start: '2026-03-14T08:00:00Z', end: '2026-03-14T09:10:00Z' }))
      .toBe(Date.parse('2026-03-14T08:00:00Z'));
    expect(sceneTimeMs({ at: '2026-03-14T08:00:00Z' })).toBe(Date.parse('2026-03-14T08:00:00Z'));
    expect(sceneTimeMs(undefined)).toBeNull();
    expect(sceneTimeMs('one afternoon in March')).toBeNull();
  });

  it('collapses both camera forms into one pose the caller can fly to', () => {
    // Atlas orbit form.
    expect(deck[1]!.camera).toEqual({
      lon: -21.9426, lat: 64.1466, height: undefined,
      heading: undefined, pitch: -35, roll: undefined, range: 4200,
    });
    // Earth-2 free form.
    expect(deck[3]!.camera).toMatchObject({ lon: 103.8198, lat: 1.3521, height: 2400, heading: 118, pitch: -28 });
  });

  it('reports no camera rather than a half-resolved one', () => {
    expect(deck[0]!.camera).toBeNull();
    expect(slideCamera(undefined)).toBeNull();
  });
});

describe('the stepper', () => {
  const count = deck.length; // 5

  it('advances and retreats one scene at a time', () => {
    expect(stepIndex(0, 1, count)).toBe(1);
    expect(stepIndex(3, 1, count)).toBe(4);
    expect(stepIndex(3, -1, count)).toBe(2);
  });

  it('stops at both ends instead of wrapping', () => {
    // Wrapping past the last scene restarts the story without saying so: the
    // reader who pressed Right once too often is looking at the opening slide
    // with nothing on screen admitting anything ended.
    expect(stepIndex(4, 1, count)).toBe(4);
    expect(stepIndex(0, -1, count)).toBe(0);
    expect(canStep(4, 1, count)).toBe(false);
    expect(canStep(0, -1, count)).toBe(false);
    expect(canStep(4, -1, count)).toBe(true);
    expect(canStep(0, 1, count)).toBe(true);
  });

  it('has no live control in an empty deck', () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
    expect(canStep(0, 1, 0)).toBe(false);
    expect(canStep(0, -1, 0)).toBe(false);
  });

  it('clamps an index that came from somewhere else', () => {
    // The deck can shrink under a live presentation when the story is swapped —
    // playing a curated scrapbook journey does exactly that.
    expect(clampIndex(9, count)).toBe(4);
    expect(clampIndex(-3, count)).toBe(0);
    expect(clampIndex(Number.NaN, count)).toBe(0);
    expect(clampIndex(2.7, count)).toBe(2);
    expect(clampIndex(3, 0)).toBe(0);
  });

  it('finds the scene a presentation should open on', () => {
    expect(indexOfScene(deck, 'scene-singapore')).toBe(3);
    expect(indexOfScene(deck, 'scene-that-left')).toBe(-1);
    expect(indexOfScene(deck, null)).toBe(-1);
    expect(indexOfScene(deck, undefined)).toBe(-1);
  });

  it('states the position in words for the announcement', () => {
    expect(positionLabel(0, count)).toBe('Scene 1 of 5');
    expect(positionLabel(4, count)).toBe('Scene 5 of 5');
    expect(positionLabel(99, count)).toBe('Scene 5 of 5');
    expect(positionLabel(0, 0)).toBe('No scenes');
  });
});

describe('keyToCommand', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
    keyToCommand({ key: k, ...mods });

  it('maps the keys a reader reaches for', () => {
    for (const k of ['ArrowRight', 'ArrowDown', 'PageDown', 'n', 'N', ' ']) expect(key(k), k).toBe('next');
    for (const k of ['ArrowLeft', 'ArrowUp', 'PageUp', 'p', 'P']) expect(key(k), k).toBe('prev');
    expect(key('Home')).toBe('first');
    expect(key('End')).toBe('last');
    expect(key('Escape')).toBe('exit');
    expect(key('c')).toBe('contents');
    expect(key('m')).toBe('audio');
  });

  it('pages back with Shift+Space, forward without', () => {
    expect(key(' ', { shiftKey: true })).toBe('prev');
    expect(key(' ')).toBe('next');
  });

  it('lets every modified keystroke through', () => {
    // The presenter listens at the document, so a key it claims is a key the
    // app has lost. ⌘K must still open the command palette while presenting.
    expect(key('k', { metaKey: true })).toBeNull();
    expect(key('k', { ctrlKey: true })).toBeNull();
    expect(key('ArrowRight', { metaKey: true })).toBeNull();
    expect(key('ArrowLeft', { altKey: true })).toBeNull();
  });

  it('claims nothing it does not use', () => {
    for (const k of ['a', 'Tab', 'Enter', 'F5', 'Shift']) expect(key(k), k).toBeNull();
  });

  it('leaves keystrokes aimed at a text field alone', () => {
    // Typing "no" into the scrapbook title while presenting must not advance
    // two slides.
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('sceneBackground', () => {
  it('ignores entities the scene does not highlight', () => {
    const scene: Scene = { id: 'scene-x', mediaIds: ['media-that-left'] };
    // Falls through to the story cover rather than borrowing another scene's photo.
    expect(sceneBackground(PACIFIC, scene)).toBe('https://cdn.example/pacific/cover.jpg');
  });

  it('returns nothing when the story has no loadable image at all', () => {
    const bare: Story = { ...PACIFIC, cover: 'ci-memory://demo/cover.jpg' };
    expect(sceneBackground(bare, { id: 'scene-x' })).toBeUndefined();
  });

  it('reads a typed photo item as well as an Atlas media record', () => {
    const withItems: Story = {
      ...PACIFIC,
      items: [{
        id: 'item-harbour',
        type: 'photo',
        position: { lat: 64.1466, lon: -21.9426 },
        media: { url: 'https://cdn.example/pacific/harbour.jpg' },
      }],
    };
    expect(sceneBackground(withItems, { id: 'scene-x', itemIds: ['item-harbour'] }))
      .toBe('https://cdn.example/pacific/harbour.jpg');
  });
});

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------

/** A stand-in for `HTMLAudioElement` whose `play()` outcome the test chooses —
 *  which is the only way to exercise an autoplay refusal without a browser. */
function fakeAudio(outcome: 'resolve' | { reject: string } = 'resolve') {
  const el = {
    src: '',
    currentTime: 0,
    plays: 0,
    pauses: 0,
    play() {
      el.plays++;
      if (outcome === 'resolve') return Promise.resolve();
      const err = new Error('refused');
      err.name = outcome.reject;
      return Promise.reject(err);
    },
    pause() { el.pauses++; },
  };
  return el;
}

/** Let the `play()` promise settle. */
const settle = () => new Promise((r) => { setTimeout(r, 0); });

describe('createSceneAudio', () => {
  it('reports "none" for a scene with no narration', () => {
    const audio = createSceneAudio({ create: () => fakeAudio() });
    audio.enter(undefined);
    expect(audio.state()).toEqual({ url: null, status: 'none' });
    audio.enter('');
    expect(audio.state().status).toBe('none');
  });

  it('plays a scene’s narration when the browser allows it', async () => {
    const el = fakeAudio();
    const changes: string[] = [];
    const audio = createSceneAudio({ create: () => el, onChange: (s) => changes.push(s.status) });

    audio.enter('https://cdn.example/pacific/reykjavik.m4a');
    expect(el.plays).toBe(1);
    await settle();
    expect(audio.state()).toEqual({ url: 'https://cdn.example/pacific/reykjavik.m4a', status: 'playing' });
    expect(changes).toEqual(['idle', 'playing']);
  });

  it('records a refusal as "blocked" and stops trying on its own', async () => {
    // This is the normal first-visit outcome in Chrome and Safari, not an
    // error: the UI has to offer a gesture rather than claim it is narrating
    // into silence.
    const el = fakeAudio({ reject: 'NotAllowedError' });
    const audio = createSceneAudio({ create: () => el });

    audio.enter('https://cdn.example/pacific/reykjavik.m4a');
    await settle();
    expect(audio.state().status).toBe('blocked');
    expect(audio.autoplayArmed()).toBe(false);

    // …and the next scene does not try again unprompted.
    audio.enter('https://cdn.example/pacific/accra.m4a');
    await settle();
    expect(audio.state().status).toBe('paused');
  });

  it('separates "the browser said no" from "this file will not play"', async () => {
    const audio = createSceneAudio({ create: () => fakeAudio({ reject: 'NotSupportedError' }) });
    audio.enter('https://cdn.example/pacific/reykjavik.aiff');
    await settle();
    // 'error' rather than 'blocked': a play button that can never work is worse
    // than an honest line saying the narration could not be loaded.
    expect(audio.state().status).toBe('error');
  });

  it('plays again from a user gesture, and re-arms the scenes after it', async () => {
    const el = fakeAudio({ reject: 'NotAllowedError' });
    const audio = createSceneAudio({ create: () => el });
    audio.enter('https://cdn.example/pacific/reykjavik.m4a');
    await settle();
    expect(audio.state().status).toBe('blocked');

    // The reader presses play; from here the element resolves.
    el.play = () => { el.plays++; return Promise.resolve(); };
    audio.resume();
    await settle();
    expect(audio.state().status).toBe('playing');
    expect(audio.autoplayArmed()).toBe(true);
  });

  it('treats a pause as "not now, and not on the next scene either"', async () => {
    const el = fakeAudio();
    const audio = createSceneAudio({ create: () => el });
    audio.enter('https://cdn.example/pacific/reykjavik.m4a');
    await settle();

    audio.pause();
    expect(el.pauses).toBe(1);
    expect(audio.state().status).toBe('paused');
    expect(audio.autoplayArmed()).toBe(false);

    audio.enter('https://cdn.example/pacific/accra.m4a');
    await settle();
    expect(audio.state().status).toBe('paused');
    expect(el.plays).toBe(1); // the second scene never called play()
  });

  it('stops the previous scene’s narration when the next one starts', async () => {
    const first = fakeAudio();
    const second = fakeAudio();
    let n = 0;
    const audio = createSceneAudio({ create: () => (n++ === 0 ? first : second) });

    audio.enter('https://cdn.example/pacific/reykjavik.m4a');
    await settle();
    audio.enter('https://cdn.example/pacific/accra.m4a');
    await settle();

    expect(first.pauses).toBe(1);
    expect(second.plays).toBe(1);
    expect(audio.state().url).toBe('https://cdn.example/pacific/accra.m4a');
  });

  it('ignores a rejection that arrives after the reader has moved on', async () => {
    // A play() promise settles a turn later. Without a generation guard, scene
    // 2's 404 lands on scene 4 and the slide claims its narration was blocked.
    let rejectFirst: ((e: Error) => void) | undefined;
    const first: AudioElementLike & { pauses: number } = {
      src: '', currentTime: 0, pauses: 0,
      play: () => new Promise<void>((_res, rej) => { rejectFirst = rej; }),
      pause() { this.pauses++; },
    };
    const second = fakeAudio();
    let n = 0;
    const audio = createSceneAudio({ create: () => (n++ === 0 ? first : second) });

    audio.enter('https://cdn.example/pacific/reykjavik.m4a');
    audio.enter('https://cdn.example/pacific/accra.m4a');
    await settle();
    expect(audio.state().status).toBe('playing');

    const stale = new Error('too late');
    stale.name = 'NotAllowedError';
    rejectFirst?.(stale);
    await settle();
    expect(audio.state().status).toBe('playing');
  });

  it('goes quiet when the presentation closes', async () => {
    const el = fakeAudio();
    const audio = createSceneAudio({ create: () => el });
    audio.enter('https://cdn.example/pacific/reykjavik.m4a');
    await settle();

    audio.stop();
    expect(el.pauses).toBe(1);
    expect(audio.state()).toEqual({ url: null, status: 'none' });
    // Nothing left to resume — the controls have nothing to act on.
    audio.resume();
    expect(el.plays).toBe(1);
  });

  it('does not throw when the element cannot even be constructed', () => {
    const boom = vi.fn(() => { throw new Error('no Audio in this environment'); });
    const audio = createSceneAudio({ create: boom });
    expect(() => audio.enter('https://cdn.example/pacific/reykjavik.m4a')).not.toThrow();
    expect(audio.state().status).toBe('error');
  });
});
