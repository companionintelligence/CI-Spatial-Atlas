/**
 * Companion Atlas MCP API.
 *
 * The tool surface that lets any MCP client — OpenClaw, Hermes, the CI agent,
 * or a human in an MCP-capable app — build and publish 4D scrapbook stories,
 * manually or automatically. Each story is a `companion.atlas/story@1` document
 * (see src/atlas/schema.ts) that the web viewer renders.
 *
 * Exposed over two transports (see index.ts / mcp-stdio.ts):
 *   - stdio              — for local agents and `claude mcp add`.
 *   - Streamable HTTP    — for suite services, authenticated with Companion OIDC.
 *
 * Tools:
 *   atlas_create_story      create an empty story
 *   atlas_query_memory      pull geotagged memories from CI-Server to seed one
 *   atlas_ingest_media      ingest image/image-set/video → MediaItems (+ optional 3D reconstruction)
 *   atlas_get_job           poll a reconstruction/ingest job
 *   atlas_add_scene         append a narrative scene (a scrapbook page / keyframe)
 *   atlas_set_timeline      set the playback clock
 *   atlas_add_layer         attach a 3D-tiles / splat / geojson layer
 *   atlas_auto_compose      auto-sequence media into scenes + camera flights (the "automatic" path)
 *   atlas_get_story         fetch the full story document
 *   atlas_list_stories      list stories
 *   atlas_publish_story     publish and return a shareable viewer URL
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { sceneInstantFromTime } from './compose.js';
import type { SuiteConnectors } from './connectors.js';
import { ingest, reconstruct } from './pipeline.js';
import { LayerAttribution, LayerFormat } from './schema.js';
import type { Layer, MediaItem, Scene } from './schema.js';
import type { JobStore, StoryStore } from './store.js';

export interface AtlasDeps {
  store: StoryStore & JobStore;
  connectors: SuiteConnectors;
  /** Base URL of the published viewer, e.g. https://atlas.ci.computer. */
  viewerBaseUrl: string;
  /** Base URL where story JSON is served, e.g. https://atlas.ci.computer/api. */
  apiBaseUrl: string;
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

export function createAtlasMcpServer(deps: AtlasDeps): McpServer {
  const { store, connectors, viewerBaseUrl, apiBaseUrl } = deps;
  const server = new McpServer({ name: 'companion-atlas', version: '0.1.0' });

  server.registerTool(
    'atlas_create_story',
    {
      title: 'Create story',
      description: 'Create a new, empty 4D scrapbook story and return its id.',
      inputSchema: {
        title: z.string().describe('Human-readable story title'),
        description: z.string().optional(),
        author: z.string().optional()
      }
    },
    async ({ title, description, author }) => {
      const story = await store.createStory({ title, description, author });
      return ok({ storyId: story.id, story });
    }
  );

  server.registerTool(
    'atlas_query_memory',
    {
      title: 'Query CI-Server memory',
      description:
        'Search the user\'s CI-Server memory for geotagged media to seed a story. Returns memory references you can pass to atlas_ingest_media.',
      inputSchema: {
        text: z.string().optional(),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
        timeRange: z.object({ start: z.string(), stop: z.string() }).optional(),
        limit: z.number().int().positive().max(500).optional()
      }
    },
    async (q) => {
      const refs = await connectors.memory.query(q);
      return ok({ count: refs.length, memories: refs, configured: connectors.memory.configured });
    }
  );

  server.registerTool(
    'atlas_ingest_media',
    {
      title: 'Ingest media',
      description:
        'Ingest one or more images, an image set, or a video (object-store URLs or ci-memory:// refs). Extracts GPS + capture time and, when reconstruct is set, kicks off a 3D reconstruction job (photogrammetry or gaussian splat).',
      inputSchema: {
        storyId: z.string(),
        sources: z.array(z.string()).min(1).describe('URLs or ci-memory://<id> references'),
        reconstruct: z.enum(['none', 'photogrammetry', 'gaussian-splat', 'auto']).optional(),
        defaultLocation: z.object({ lat: z.number(), lon: z.number() }).optional()
      }
    },
    async ({ storyId, sources, reconstruct: backend, defaultLocation }) => {
      const story = await store.getStory(storyId);
      if (!story) return err(`No such story: ${storyId}`);

      const { media } = await ingest({ sources, hints: { defaultLocation } });
      for (const m of media) await store.addMedia(storyId, m);

      let job: string | undefined;
      if (backend && backend !== 'none') {
        const j = await reconstruct({ mediaIds: media.map((m) => m.id), backend }, store);
        job = j.id;
      }
      return ok({ mediaIds: media.map((m) => m.id), media, reconstructJob: job });
    }
  );

  server.registerTool(
    'atlas_get_job',
    {
      title: 'Get job',
      description: 'Poll the status of an ingest / reconstruction / tiling job.',
      inputSchema: { jobId: z.string() }
    },
    async ({ jobId }) => {
      const job = await store.get(jobId);
      return job ? ok(job) : err(`No such job: ${jobId}`);
    }
  );

  server.registerTool(
    'atlas_add_scene',
    {
      title: 'Add scene',
      description:
        'Append a narrative scene (a scrapbook page / timeline keyframe). Provide a camera target, or reference media whose location frames the shot.',
      inputSchema: {
        storyId: z.string(),
        title: z.string(),
        narrative: z.string().optional(),
        time: z.string().optional().describe('ISO-8601 instant for this scene'),
        camera: z
          .object({
            lat: z.number(),
            lon: z.number(),
            range: z.number().optional(),
            pitch: z.number().optional(),
            heading: z.number().optional()
          })
          .optional(),
        mediaIds: z.array(z.string()).optional()
      }
    },
    async ({ storyId, title, narrative, time, camera, mediaIds }) => {
      const scene: Scene = {
        id: `scene_${Date.now()}`,
        title,
        narrative,
        time,
        camera: camera
          ? { location: { lat: camera.lat, lon: camera.lon }, range: camera.range, pitch: camera.pitch, heading: camera.heading }
          : undefined,
        mediaIds,
        transition: { kind: 'fly', durationMs: 1800 }
      };
      const added = await store.addScene(storyId, scene);
      return added ? ok({ sceneId: added.id, scene: added }) : err(`No such story: ${storyId}`);
    }
  );

  server.registerTool(
    'atlas_set_timeline',
    {
      title: 'Set timeline',
      description: 'Set the story playback clock (start, stop, speed multiplier, loop).',
      inputSchema: {
        storyId: z.string(),
        start: z.string(),
        stop: z.string(),
        multiplier: z.number().optional(),
        loop: z.boolean().optional()
      }
    },
    async ({ storyId, start, stop, multiplier, loop }) => {
      const existing = await store.getStory(storyId);
      if (!existing) return err(`No such story: ${storyId}`);
      // Merge, don't replace. `multiplier`/`loop` are optional, so retiming a
      // story without restating them used to write `undefined` over whatever an
      // earlier tool call authored — an agent that set loop, then adjusted the
      // window, silently lost the loop.
      const updated = await store.updateStory(storyId, {
        timeline: {
          ...existing.timeline,
          start,
          stop,
          ...(multiplier !== undefined ? { multiplier } : {}),
          ...(loop !== undefined ? { loop } : {}),
        },
      });
      return updated ? ok({ timeline: updated.timeline }) : err(`No such story: ${storyId}`);
    }
  );

  server.registerTool(
    'atlas_add_layer',
    {
      title: 'Add layer',
      description:
        'Attach a 3D-tiles, gaussian-splat, terrain, imagery, or geojson layer to the story. Pass `attribution` whenever the source licence requires credit (OpenStreetMap/ODbL, EOX and CARTO/CC BY, OpenSeaMap/CC BY-SA all do) — a layer without it cannot be displayed lawfully.',
      inputSchema: {
        storyId: z.string(),
        kind: z.enum(['imagery', 'terrain', '3d-tiles', 'gaussian-splat', 'geojson', 'model', 'pin']),
        name: z.string().optional().describe('Human-readable label for layer pickers'),
        uri: z.string().optional(),
        format: LayerFormat.optional().describe('Wire format of `uri`, when it is not inferable by convention'),
        attribution: LayerAttribution.optional().describe('Source credit required by the layer\'s licence'),
        availability: z.object({ start: z.string(), stop: z.string() }).optional(),
        opacity: z.number().min(0).max(1).optional(),
        visible: z.boolean().optional().describe('Initial on/off state in the viewer (omitted = shown)'),
        order: z.number().optional().describe('Draw order; lower renders beneath')
      }
    },
    async ({ storyId, kind, name, uri, format, attribution, availability, opacity, visible, order }) => {
      const story = await store.getStory(storyId);
      if (!story) return err(`No such story: ${storyId}`);
      const layer: Layer = {
        id: `layer_${Date.now()}`,
        kind,
        name,
        uri,
        format,
        attribution,
        availability,
        opacity,
        visible,
        order
      };
      const updated = await store.updateStory(storyId, { layers: [...(story.layers ?? []), layer] });
      return ok({ layerId: layer.id, layers: updated?.layers });
    }
  );

  server.registerTool(
    'atlas_auto_compose',
    {
      title: 'Auto-compose story',
      description:
        'Automatically sequence a story\'s geolocated media into time-ordered scenes with camera flights and a fitted timeline. This is the one-shot "turn my media into a scrapbook map" path.',
      inputSchema: { storyId: z.string() }
    },
    async ({ storyId }) => {
      const story = await store.getStory(storyId);
      if (!story) return err(`No such story: ${storyId}`);

      const located = story.media.filter((m): m is MediaItem & { location: NonNullable<MediaItem['location']> } => !!m.location);
      if (located.length === 0) return err('No geolocated media to compose. Ingest media with GPS first.');

      const ordered = [...located].sort(
        (a, b) => sceneInstantFromTime(a.capturedAt) - sceneInstantFromTime(b.capturedAt)
      );

      const scenes: Scene[] = ordered.map((m, i) => ({
        id: `scene_auto_${i}`,
        title: m.caption ?? `Stop ${i + 1}`,
        narrative: m.caption,
        time: m.capturedAt,
        camera: { location: { lat: m.location.lat, lon: m.location.lon }, pitch: -40, range: 2600 },
        mediaIds: [m.id],
        transition: { kind: 'fly', durationMs: 1800 }
      }));

      const times = ordered.map((m) => m.capturedAt).filter((t): t is string => !!t);
      const timeline =
        times.length >= 2 ? { start: times[0], stop: times[times.length - 1], multiplier: 600, loop: true } : story.timeline;

      const updated = await store.updateStory(storyId, { scenes, timeline });
      return ok({ sceneCount: scenes.length, timeline: updated?.timeline, story: updated });
    }
  );

  server.registerTool(
    'atlas_get_story',
    {
      title: 'Get story',
      description: 'Return the full story document.',
      inputSchema: { storyId: z.string() }
    },
    async ({ storyId }) => {
      const story = await store.getStory(storyId);
      return story ? ok(story) : err(`No such story: ${storyId}`);
    }
  );

  server.registerTool(
    'atlas_list_stories',
    { title: 'List stories', description: 'List all stories (id + title + scene count).', inputSchema: {} },
    async () => {
      const stories = await store.listStories();
      return ok(stories.map((s) => ({ id: s.id, title: s.title, scenes: s.scenes.length, updatedAt: s.updatedAt })));
    }
  );

  server.registerTool(
    'atlas_publish_story',
    {
      title: 'Publish story',
      description:
        'Publish a story and return a shareable web viewer URL. Optionally writes the story back to CI-Server memory and notifies OpenClaw/Hermes.',
      inputSchema: {
        storyId: z.string(),
        visibility: z.enum(['private', 'unlisted', 'public']).optional(),
        notify: z.string().optional().describe('Optional Hermes recipient/channel to deliver the link to')
      }
    },
    async ({ storyId, visibility, notify }) => {
      const story = await store.updateStory(storyId, { access: { visibility: visibility ?? 'unlisted' } });
      if (!story) return err(`No such story: ${storyId}`);

      const storyJsonUrl = `${apiBaseUrl}/public/stories/${storyId}`;
      const viewerUrl = `${viewerBaseUrl}/?story=${encodeURIComponent(storyJsonUrl)}`;

      await connectors.memory.saveStory(storyId, viewerUrl);
      await connectors.openclaw.notifyStoryReady(storyId, viewerUrl);
      if (notify) await connectors.hermes.deliver(viewerUrl, notify);

      return ok({ viewerUrl, storyJsonUrl, visibility: story.access?.visibility });
    }
  );

  // Read a story as an MCP resource: story://<id>
  server.registerResource(
    'story',
    'story://{id}',
    { title: 'Atlas story', description: 'A companion.atlas/story@1 document.' },
    async (uri: URL) => {
      const id = uri.pathname.replace(/^\/+/, '') || uri.hostname;
      const story = await store.getStory(id);
      if (!story) throw new Error(`No such story: ${id}`);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(story, null, 2) }] };
    }
  );

  return server;
}
