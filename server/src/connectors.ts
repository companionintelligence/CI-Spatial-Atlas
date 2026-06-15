/**
 * Companion Intelligence suite connectors.
 *
 * Companion Atlas plugs into the rest of the suite over MCP and Companion OIDC:
 *
 *   - CI-Server memory — the system of record for a user's geotagged media and
 *     life-log. Atlas pulls memories to seed stories and writes finished
 *     stories back as memories. Spoken to as an MCP client (preferred) or REST.
 *   - OpenClaw / Hermes — agent + automation services in the suite. They are
 *     MCP *clients* of Atlas: they call the Atlas MCP tools (create_story,
 *     ingest_media, auto_compose, publish_story) to build views automatically.
 *     Atlas may also call back into them for enrichment.
 *
 * These are typed connector stubs. `CI_MEMORY_URL`, `OPENCLAW_URL`,
 * `HERMES_URL`, and the OIDC settings come from env (.env.default).
 */

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
  bbox?: [number, number, number, number]; // [west, south, east, north]
  timeRange?: { start: string; stop: string };
  limit?: number;
}

/** Connector to CI-Server memory (the suite's media/life-log store). */
export class CiMemoryConnector {
  constructor(private readonly baseUrl = process.env.CI_MEMORY_URL ?? '') {}

  get configured(): boolean {
    return this.baseUrl.length > 0;
  }

  /** Find geotagged memories to seed a story. */
  async query(_q: MemoryQuery, _token?: string): Promise<MemoryRef[]> {
    if (!this.configured) return [];
    // TODO: MCP `tools/call memory.search` or `GET {baseUrl}/memories?...`.
    return [];
  }

  /** Resolve a `ci-memory://<id>` reference into a fetchable media URL. */
  async resolveMedia(_id: string, _token?: string): Promise<MediaItem | null> {
    if (!this.configured) return null;
    return null;
  }

  /** Persist a finished story back into memory as a shareable artifact. */
  async saveStory(_storyId: string, _publicUrl: string, _token?: string): Promise<void> {
    if (!this.configured) return;
    // TODO: write a memory of kind "atlas.story" linking to publicUrl.
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
    hermes: new HermesConnector()
  };
}
