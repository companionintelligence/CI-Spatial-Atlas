import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/store.js';
import type { MediaItem, Scene } from '../src/schema.js';

describe('InMemoryStore', () => {
  let s: InMemoryStore;
  beforeEach(() => {
    s = new InMemoryStore();
  });

  it('creates, gets, lists, updates and deletes a story', async () => {
    const story = await s.createStory({ title: 'T' });
    expect(story.id).toMatch(/^story_/);
    expect(story.schema).toBe('companion.atlas/story@1');
    expect(story.access).toEqual({ visibility: 'private' });
    expect(await s.getStory(story.id)).toEqual(story);
    expect(await s.listStories()).toHaveLength(1);

    const up = await s.updateStory(story.id, { title: 'T2' });
    expect(up?.title).toBe('T2');
    expect(up?.id).toBe(story.id); // id is preserved across update

    expect(await s.deleteStory(story.id)).toBe(true);
    expect(await s.getStory(story.id)).toBeNull();
    expect(await s.updateStory(story.id, { title: 'x' })).toBeNull();
  });

  it('adds media + scenes, and returns null for a missing story', async () => {
    const story = await s.createStory({ title: 'T' });
    const media = { id: 'm', kind: 'image', uri: 'u' } as MediaItem;
    expect((await s.addMedia(story.id, media))?.id).toBe('m');
    expect((await s.getStory(story.id))!.media).toHaveLength(1);

    const scene = { id: 'sc', title: 'a' } as Scene;
    expect((await s.addScene(story.id, scene))?.id).toBe('sc');
    expect((await s.getStory(story.id))!.scenes).toHaveLength(1);

    expect(await s.addMedia('missing', media)).toBeNull();
    expect(await s.addScene('missing', scene)).toBeNull();
  });

  it('enqueues and updates jobs', async () => {
    const job = await s.enqueue('ingest', 'story_x');
    expect(job.state).toBe('queued');
    expect(job.progress).toBe(0);
    const done = await s.update(job.id, { state: 'succeeded', progress: 1 });
    expect(done?.state).toBe('succeeded');
    expect(await s.get(job.id)).toEqual(done);
    expect(await s.update('missing', { state: 'failed' })).toBeNull();
  });
});
