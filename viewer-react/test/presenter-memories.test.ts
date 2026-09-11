/**
 * The regression these exist for: Present was reachable only from the bundled
 * demo story.
 *
 * `memoryToStory` returns `scenes: []` — a Companion Memory archive is located
 * media and markers, not an authored narrative — and the rail gated the Present
 * button on `story.scenes.length > 0`. So the entire presentation layer, which
 * is complete and works, was invisible on every real story. `deriveModel`
 * already solves the same problem for the globe by projecting located entities
 * into memories when a story has no scenes; `buildDeck` now does the same.
 */
import { describe, expect, it } from 'vitest';
import { buildDeck, type DeckMemory } from '../src/ui/sceneDeck.js';
import type { Story } from '@companion-atlas/story';

const memoryStory = (): Story =>
  ({
    schema: 'companion.atlas/story@1',
    id: 'companion-memory',
    title: 'Companion Memory',
    scenes: [],
  }) as unknown as Story;

const authoredStory = (): Story =>
  ({
    schema: 'companion.atlas/story@1',
    id: 'authored',
    title: 'Authored',
    scenes: [
      { id: 'sc-2', title: 'Second', time: '2019-06-18T09:00:00Z' },
      { id: 'sc-1', title: 'First', time: '2019-06-17T09:00:00Z' },
    ],
  }) as unknown as Story;

const MEMORIES: DeckMemory[] = [
  { id: 'm-b', title: 'Harbour at dusk', timeMs: Date.parse('2019-06-18T19:00:00Z'), lat: 64.15, lon: -21.93, narrative: 'The light went orange.' },
  { id: 'm-a', title: 'Morning at the ridge', timeMs: Date.parse('2019-06-17T07:00:00Z'), lat: 64.1, lon: -21.8 },
  { id: 'm-c', title: 'Undated note', timeMs: Date.parse('2019-06-19T12:00:00Z') },
];

describe('buildDeck with no authored scenes', () => {
  it('projects memories into a deck, so Present works on a Memory story', () => {
    const deck = buildDeck(memoryStory(), { memories: MEMORIES });
    expect(deck).toHaveLength(3);
    expect(deck.map((s) => s.title)).toEqual([
      'Morning at the ridge',
      'Harbour at dusk',
      'Undated note',
    ]);
  });

  it('orders projected slides by time', () => {
    const deck = buildDeck(memoryStory(), { memories: MEMORIES });
    const times = deck.map((s) => s.timeMs ?? 0);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('gives a located memory a camera, because a slide that does not move is not a presentation', () => {
    const deck = buildDeck(memoryStory(), { memories: MEMORIES });
    const located = deck.find((s) => s.id === 'm-b');
    expect(located?.camera).toMatchObject({ lat: 64.15, lon: -21.93 });
  });

  it('still produces a slide for a memory with no position', () => {
    const deck = buildDeck(memoryStory(), { memories: MEMORIES });
    const unlocated = deck.find((s) => s.id === 'm-c');
    expect(unlocated).toBeDefined();
    expect(unlocated?.camera).toBeNull();
  });

  it('carries the narrative through as the slide body', () => {
    const deck = buildDeck(memoryStory(), { memories: MEMORIES });
    expect(deck.find((s) => s.id === 'm-b')?.summary).toContain('light went orange');
  });

  it('is empty when there is nothing to present at all', () => {
    expect(buildDeck(memoryStory(), { memories: [] })).toEqual([]);
    expect(buildDeck(memoryStory())).toEqual([]);
  });
});

describe('authored scenes always win', () => {
  it('does not let projected memories replace a deck someone wrote', () => {
    const deck = buildDeck(authoredStory(), { memories: MEMORIES });
    expect(deck.map((s) => s.id)).toEqual(['sc-2', 'sc-1']);
  });

  it('preserves authored order rather than sorting it by time', () => {
    // sc-2 is later than sc-1 but written first. Sorting would turn a
    // flashback into a prologue, which is why buildDeck does not sort.
    const deck = buildDeck(authoredStory(), { memories: MEMORIES });
    expect(deck[0]!.id).toBe('sc-2');
  });
});
