/**
 * Companion Intelligence suite connectors.
 *
 * Companion Atlas plugs into the rest of the suite over HTTP/GraphQL + MCP and
 * Companion OIDC:
 *
 *   - CI-Server memory — the system of record for a user's geotagged media and
 *     life-log. Atlas pulls located memories to seed stories and writes finished
 *     stories back (`createEvent`). Real GraphQL transport lives in
 *     `./ci-memory-client.ts`; this class is the suite-facing facade.
 *   - OpenClaw / Hermes — agent + automation services in the suite. They are
 *     MCP *clients* of Atlas: they call the Atlas MCP tools to build views
 *     automatically. Atlas may also call back into them for enrichment.
 *
 * `CI_MEMORY_URL` (+ optional `CI_MEMORY_TOKEN`, both Hub-injectable), `OPENCLAW_URL`,
 * `HERMES_URL`, and the OIDC settings come from env (.env.default).
 */

import type { Story } from '@companion-atlas/story';
import { queryLocatedMedia, saveStoryMemory, type CiMemoryClientConfig } from './ci-memory-client.js';
import type { MediaItem } from './schema.js';

export interface MemoryRef {
  id: string;
  uri: string;
  capturedAt?: string;
  location?: { lat: number; lon: number; height?: number };
  kind?: string;
}

export interface MemoryQuery {
  /** Free-text or structured query passed to CI-Server memory. */
  text?: string;
  bbox?: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  timeRange?: { start: string; stop: string };
  limit?: number;
}

/** CI_MEMORY_URL may be a full GraphQL endpoint or a base origin. Resolve it to
 *  the GraphQL endpoint (proxy path `/api/graphql`, or a direct `…/graphql`). */
function graphqlEndpoint(base: string): string {
  const b = base.replace(/\/$/, '');
  return /\/graphql$/i.test(b) ? b : `${b}/api/graphql`;
}

/** Connector to CI-Server memory (the suite's media/life-log store). */
export class CiMemoryConnector {
  constructor(
    private readonly baseUrl = process.env.CI_MEMORY_URL ?? '',
    /** Optional service token (Hub-injected). Per-request Portal tokens take precedence. */
    private readonly serviceToken = process.env.CI_MEMORY_TOKEN ?? '',
  ) {}

  get configured(): boolean {
    return this.baseUrl.length > 0;
  }

  private cfg(token?: string): CiMemoryClientConfig {
    const endpoint = graphqlEndpoint(this.baseUrl);
    let origin: string | undefined;
    try {
      origin = new URL(endpoint).origin;
    } catch {
      origin = undefined;
    }
    return { endpoint, origin, token: token || this.serviceToken || undefined };
  }

  /** Find located memories to seed a story (one page). */
  async query(q: MemoryQuery, token?: string): Promise<MemoryRef[]> {
    if (!this.configured) return [];
    const media = await queryLocatedMedia(this.cfg(token), {
      first: q.limit,
      startTime: q.timeRange?.start,
      endTime: q.timeRange?.stop,
      bbox: q.bbox,
    });
    return media.map((m) => ({ id: m.id, uri: m.uri, capturedAt: m.capturedAt, location: m.location, kind: m.kind }));
  }

  /** Resolve a `ci-memory://<id>` reference into a fetchable media URL. */
  async resolveMedia(_id: string, _token?: string): Promise<MediaItem | null> {
    if (!this.configured) return null;
    // A dedicated single-media lookup is a follow-up; the search query already
    // returns absolutized media/thumbnail URLs for the seeded set.
    return null;
  }

  /** Persist a finished story back into memory as an idempotent `createEvent`. */
  async saveStoryMemory(story: Story, shareUrl?: string, token?: string): Promise<{ id: string } | null> {
    if (!this.configured) return null;
    return saveStoryMemory(this.cfg(token), story, shareUrl);
  }

  /** @deprecated Use {@link saveStoryMemory}; kept for existing call sites that
   *  only have the id + url. No-op until they pass the full story. */
  async saveStory(_storyId: string, _publicUrl: string, _token?: string): Promise<void> {
    if (!this.configured) return;
  }
}

/** Connector to OpenClaw (agent orchestration). Atlas is its MCP tool surface. */
export class OpenClawConnector {
  constructor(private readonly baseUrl = process.env.OPENCLAW_URL ?? '') {}
  get configured(): boolean {
    return this.baseUrl.length > 0;
  }
  /** Notify OpenClaw that a story is ready (e.g. to post/share it). */
  async notifyStoryReady(_storyId: string, _publicUrl: string): Promise<void> {
    if (!this.configured) return;
  }
}

/** Connector to Hermes (messaging / delivery). */
export class HermesConnector {
  constructor(private readonly baseUrl = process.env.HERMES_URL ?? '') {}
  get configured(): boolean {
    return this.baseUrl.length > 0;
  }
  /** Deliver a published story link to a channel / recipient. */
  async deliver(_publicUrl: string, _to: string): Promise<void> {
    if (!this.configured) return;
  }
}

export interface SuiteConnectors {
  memory: CiMemoryConnector;
  openclaw: OpenClawConnector;
  hermes: HermesConnector;
}

export function createConnectors(): SuiteConnectors {
  return {
    memory: new CiMemoryConnector(),
    openclaw: new OpenClawConnector(),
    hermes: new HermesConnector(),
  };
}
