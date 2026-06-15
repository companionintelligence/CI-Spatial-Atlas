/**
 * Story + job persistence.
 *
 * The scaffold ships an in-memory implementation so the API and MCP server run
 * with zero infrastructure. Production swaps this for Postgres (stories,
 * scenes, media) + Redis/BullMQ (jobs) + S3/MinIO (media + generated tiles),
 * all wired in docker-compose.yml. Keep callers behind these interfaces.
 */

import { randomUUID } from 'node:crypto';
import type { MediaItem, Scene, Story } from './schema.js';

export type JobKind = 'ingest' | 'reconstruct' | 'tile' | 'compose' | 'publish';
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Job {
  id: string;
  kind: JobKind;
  state: JobState;
  storyId?: string;
  progress: number; // 0..1
  detail?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryStore {
  createStory(input: Partial<Story> & Pick<Story, 'title'>): Promise<Story>;
  getStory(id: string): Promise<Story | null>;
  listStories(): Promise<Story[]>;
  updateStory(id: string, patch: Partial<Story>): Promise<Story | null>;
  deleteStory(id: string): Promise<boolean>;
  addMedia(storyId: string, media: MediaItem): Promise<MediaItem | null>;
  addScene(storyId: string, scene: Scene): Promise<Scene | null>;
}

export interface JobStore {
  enqueue(kind: JobKind, storyId?: string): Promise<Job>;
  get(id: string): Promise<Job | null>;
  update(id: string, patch: Partial<Job>): Promise<Job | null>;
}

const now = () => new Date().toISOString();

export class InMemoryStore implements StoryStore, JobStore {
  private stories = new Map<string, Story>();
  private jobs = new Map<string, Job>();

  async createStory(input: Partial<Story> & Pick<Story, 'title'>): Promise<Story> {
    const id = input.id ?? `story_${randomUUID()}`;
    const story: Story = {
      schema: 'companion.atlas/story@1',
      id,
      title: input.title,
      description: input.description,
      author: input.author,
      createdAt: input.createdAt ?? now(),
      updatedAt: now(),
      basemap: input.basemap,
      timeline: input.timeline,
      media: input.media ?? [],
      layers: input.layers ?? [],
      scenes: input.scenes ?? [],
      access: input.access ?? { visibility: 'private' },
      provenance: input.provenance
    };
    this.stories.set(id, story);
    return story;
  }

  async getStory(id: string): Promise<Story | null> {
    return this.stories.get(id) ?? null;
  }

  async listStories(): Promise<Story[]> {
    return [...this.stories.values()];
  }

  async updateStory(id: string, patch: Partial<Story>): Promise<Story | null> {
    const story = this.stories.get(id);
    if (!story) return null;
    const next = { ...story, ...patch, id, updatedAt: now() };
    this.stories.set(id, next);
    return next;
  }

  async deleteStory(id: string): Promise<boolean> {
    return this.stories.delete(id);
  }

  async addMedia(storyId: string, media: MediaItem): Promise<MediaItem | null> {
    const story = this.stories.get(storyId);
    if (!story) return null;
    story.media.push(media);
    story.updatedAt = now();
    return media;
  }

  async addScene(storyId: string, scene: Scene): Promise<Scene | null> {
    const story = this.stories.get(storyId);
    if (!story) return null;
    story.scenes.push(scene);
    story.updatedAt = now();
    return scene;
  }

  async enqueue(kind: JobKind, storyId?: string): Promise<Job> {
    const id = `job_${randomUUID()}`;
    const job: Job = {
      id,
      kind,
      state: 'queued',
      storyId,
      progress: 0,
      createdAt: now(),
      updatedAt: now()
    };
    this.jobs.set(id, job);
    return job;
  }

  async get(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  async update(id: string, patch: Partial<Job>): Promise<Job | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    const next = { ...job, ...patch, id, updatedAt: now() };
    this.jobs.set(id, next);
    return next;
  }
}
