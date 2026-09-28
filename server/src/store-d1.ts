/**
 * D1-backed StoryStore + JobStore — the Cloudflare Worker deployment's
 * durable equivalent of `InMemoryStore` (store.ts).
 *
 * One JSON document per row (see migrations/0001_init.sql for why: nothing
 * in this codebase queries into a Story's nested fields today, every filter
 * — ownership, visibility — runs in application code exactly as it does
 * against the in-memory Map, so a relational model of a shape that is still
 * changing would be premature). `updated_at` is denormalized onto the row
 * so `listStories` can sort without deserializing every document first.
 *
 * Not a drop-in swap for `InMemoryStore` at the type level — D1 is
 * network I/O, so this satisfies the same `StoryStore`/`JobStore`
 * interfaces but is constructed with a `D1Database` binding rather than
 * being a bare class with no dependencies.
 */

import { randomUUID } from 'node:crypto';
import type { MediaItem, Scene, Story } from './schema.js';
import type { Job, JobKind, JobStore, StoryStore } from './store.js';

const now = () => new Date().toISOString();

export class D1Store implements StoryStore, JobStore {
  constructor(private readonly db: D1Database) {}

  async createStory(input: Partial<Story> & Pick<Story, 'title'>): Promise<Story> {
    const id = input.id ?? `story_${randomUUID()}`;
    const timestamp = now();
    const story: Story = {
      schema: 'companion.atlas/story@1',
      id,
      title: input.title,
      description: input.description,
      author: input.author,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: timestamp,
      basemap: input.basemap,
      timeline: input.timeline,
      media: input.media ?? [],
      layers: input.layers ?? [],
      scenes: input.scenes ?? [],
      access: input.access ?? { visibility: 'private' },
      provenance: input.provenance,
    };
    await this.db
      .prepare('INSERT INTO stories (id, created_at, updated_at, doc) VALUES (?, ?, ?, ?)')
      .bind(id, story.createdAt, story.updatedAt, JSON.stringify(story))
      .run();
    return story;
  }

  async getStory(id: string): Promise<Story | null> {
    const row = await this.db.prepare('SELECT doc FROM stories WHERE id = ?').bind(id).first<{ doc: string }>();
    return row ? (JSON.parse(row.doc) as Story) : null;
  }

  async listStories(): Promise<Story[]> {
    const { results } = await this.db.prepare('SELECT doc FROM stories ORDER BY updated_at DESC').all<{ doc: string }>();
    return (results ?? []).map((r) => JSON.parse(r.doc) as Story);
  }

  async updateStory(id: string, patch: Partial<Story>): Promise<Story | null> {
    const existing = await this.getStory(id);
    if (!existing) return null;
    const next: Story = { ...existing, ...patch, id, updatedAt: now() };
    await this.db
      .prepare('UPDATE stories SET updated_at = ?, doc = ? WHERE id = ?')
      .bind(next.updatedAt, JSON.stringify(next), id)
      .run();
    return next;
  }

  async deleteStory(id: string): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM stories WHERE id = ?').bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async addMedia(storyId: string, media: MediaItem): Promise<MediaItem | null> {
    const story = await this.getStory(storyId);
    if (!story) return null;
    story.media.push(media);
    story.updatedAt = now();
    await this.db
      .prepare('UPDATE stories SET updated_at = ?, doc = ? WHERE id = ?')
      .bind(story.updatedAt, JSON.stringify(story), storyId)
      .run();
    return media;
  }

  async addScene(storyId: string, scene: Scene): Promise<Scene | null> {
    const story = await this.getStory(storyId);
    if (!story) return null;
    story.scenes.push(scene);
    story.updatedAt = now();
    await this.db
      .prepare('UPDATE stories SET updated_at = ?, doc = ? WHERE id = ?')
      .bind(story.updatedAt, JSON.stringify(story), storyId)
      .run();
    return scene;
  }

  async enqueue(kind: JobKind, storyId?: string): Promise<Job> {
    const id = `job_${randomUUID()}`;
    const timestamp = now();
    const job: Job = {
      id,
      kind,
      state: 'queued',
      storyId,
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db
      .prepare('INSERT INTO jobs (id, story_id, created_at, updated_at, doc) VALUES (?, ?, ?, ?, ?)')
      .bind(id, storyId ?? null, timestamp, timestamp, JSON.stringify(job))
      .run();
    return job;
  }

  async get(id: string): Promise<Job | null> {
    const row = await this.db.prepare('SELECT doc FROM jobs WHERE id = ?').bind(id).first<{ doc: string }>();
    return row ? (JSON.parse(row.doc) as Job) : null;
  }

  async update(id: string, patch: Partial<Job>): Promise<Job | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const next: Job = { ...existing, ...patch, id, updatedAt: now() };
    await this.db
      .prepare('UPDATE jobs SET updated_at = ?, doc = ? WHERE id = ?')
      .bind(next.updatedAt, JSON.stringify(next), id)
      .run();
    return next;
  }
}
