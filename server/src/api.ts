/**
 * Atlas REST API (Fastify).
 *
 * A thin HTTP surface over the same store the MCP server uses, plus the public
 * story endpoint the web viewer fetches (`GET /api/public/stories/:id`). All
 * authenticated routes verify a Companion OIDC bearer token and scope stories
 * to the caller's subject.
 *
 * Authorisation, in two layers (see `auth.ts`):
 *
 *   1. `authenticated` — a route-level preHandler that 401s anything without a
 *      verified subject. Every mutating route carries it, so an unauthenticated
 *      write fails loudly instead of quietly creating a story owned by
 *      `anonymous`.
 *   2. `canRead` / `canWrite` — per-story ownership, checked inside the handler
 *      against `access.oidcSubject`. Reaching a story you don't own is a 403.
 *
 * Media upload lives in `media.ts` and is registered here (`registerMediaRoutes`)
 * so the `authenticated` preHandler below is the *same function* guarding it —
 * a second copy of an auth gate is a gate that eventually differs from the
 * first. See that file for why `GET /api/media/o/*` is the one route whose
 * authorisation is an unguessable key rather than a token.
 *
 * Only `GET /healthz`, `GET /api/public/stories/:id` and `GET /api/media/o/*`
 * are unauthenticated; `GET /api/stories` and `GET /api/stories/:id` are
 * reachable anonymously but return only what `canRead` allows
 * (public/unlisted), which is what lets the viewer load a shared story without
 * a token.
 *
 * Cross-origin access is a third, separate question and lives in `cors.ts`. The
 * viewer is never same-origin with this API in any configuration this repo
 * ships, so without it the browser refuses the upload before the auth layers
 * above ever see the request.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';

import { canRead, canWrite, isAuthenticated, verifyBearer, type AuthContext } from './auth.js';
import {
  CORS_ALLOWED_HEADERS, CORS_EXPOSED_HEADERS, CORS_METHODS,
  corsOriginCheck, corsPolicyFromEnv, type CorsPolicy,
} from './cors.js';
import { sceneInstantFromTime } from './compose.js';
import type { SuiteConnectors } from './connectors.js';
import { registerMediaRoutes } from './media.js';
import { objectStoreConfigFromEnv, uploadLimitsFromEnv, type ObjectStore, type UploadLimits } from './object-store.js';
import { ingest, reconstruct } from './pipeline.js';
import type { MediaItem, Scene } from './schema.js';
import type { JobStore, StoryStore } from './store.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

export interface ApiDeps {
  store: StoryStore & JobStore;
  connectors: SuiteConnectors;
  viewerBaseUrl: string;
  apiBaseUrl: string;
  /**
   * Where uploaded media is stored, or null when this deployment has none.
   *
   * Passed in rather than read from the environment inside `buildApi`, so a
   * test's app is never quietly wired to whatever `S3_*` variables happen to be
   * set on the machine running it. `index.ts` is the one place that reads the
   * env (`objectStoreFromEnv`).
   */
  objectStore?: ObjectStore | null;
  /** Upload size cap + content-type allowlist. Defaults from env. */
  uploadLimits?: UploadLimits;
  /** Fastify logger config. Defaults on; tests pass `false` to stay quiet. */
  logger?: boolean;
  /**
   * Which origins may call this API from a browser. Defaults from the
   * environment (`ATLAS_CORS_ORIGINS`), passed in for the same reason
   * `objectStore` is: a test's app must not inherit whatever the machine
   * running it happens to have set.
   */
  cors?: CorsPolicy;
}

/**
 * Route-level preHandler: reject anything without a verified subject.
 *
 * Runs after the global `preHandler` that populates `req.auth` (Fastify runs
 * instance hooks before route hooks), so `req.auth` is always set here.
 */
async function authenticated(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAuthenticated(req.auth)) {
    await reply.code(401).send({ error: 'unauthenticated' });
  }
}

export function buildApi(deps: ApiDeps): FastifyInstance {
  const { store, connectors, viewerBaseUrl, apiBaseUrl } = deps;
  const app = Fastify({ logger: deps.logger ?? true });

  // Registered before anything else so a preflight is answered even for a route
  // that would 401 — a browser that cannot preflight never gets to send the
  // real request, and the resulting failure names CORS, not authentication.
  const corsPolicy = deps.cors ?? corsPolicyFromEnv();
  void app.register(cors, {
    origin: corsOriginCheck(corsPolicy),
    methods: CORS_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: CORS_EXPOSED_HEADERS,
    // Deliberately absent: `credentials`. See `cors.ts` — Atlas authenticates
    // with a bearer token the caller attaches on purpose, never with an ambient
    // cookie, so no allowlist mistake can turn into a hostile page acting as
    // the signed-in user.
    maxAge: 600,
  });

  // Attach auth to every request (public routes simply ignore it).
  app.addHook('preHandler', async (req) => {
    req.auth = await verifyBearer(req.headers.authorization);
  });

  /**
   * Load a story the caller is allowed to *write*, or send the right refusal.
   * Returns null once a response has been sent.
   */
  async function writableStory(id: string, req: FastifyRequest, reply: FastifyReply) {
    const story = await store.getStory(id);
    if (!story) {
      await reply.code(404).send({ error: 'not_found' });
      return null;
    }
    if (!canWrite(story.access?.oidcSubject, req.auth)) {
      await reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    return story;
  }

  app.get('/healthz', async () => ({ ok: true, service: 'companion-atlas', version: '0.1.0' }));

  // ── Media upload ─────────────────────────────────────────────────────────
  // `storageReason` is read from the environment even when no store was passed,
  // so an unconfigured deployment answers with the variables it is missing
  // instead of a generic refusal.
  const storageConfig = objectStoreConfigFromEnv();
  registerMediaRoutes(
    app,
    {
      objectStore: deps.objectStore ?? null,
      limits: deps.uploadLimits ?? uploadLimitsFromEnv(),
      apiBaseUrl,
      storageReason: storageConfig.configured ? undefined : storageConfig.reason,
    },
    authenticated
  );

  // ── Public, shareable story document the viewer fetches ──────────────────
  app.get<{ Params: { id: string } }>('/api/public/stories/:id', async (req, reply) => {
    const story = await store.getStory(req.params.id);
    if (!story) return reply.code(404).send({ error: 'not_found' });
    if (!canRead(story.access?.visibility, story.access?.oidcSubject, req.auth)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return story;
  });

  // ── Authenticated story CRUD ─────────────────────────────────────────────
  app.get('/api/stories', async (req) => {
    const stories = await store.listStories();
    return stories
      .filter((s) => canRead(s.access?.visibility, s.access?.oidcSubject, req.auth))
      .map((s) => ({ id: s.id, title: s.title, scenes: s.scenes.length, updatedAt: s.updatedAt }));
  });

  app.post<{ Body: { title: string; description?: string } }>(
    '/api/stories',
    { preHandler: authenticated },
    async (req, reply) => {
      if (!req.body?.title) return reply.code(400).send({ error: 'title_required' });
      const story = await store.createStory({
        title: req.body.title,
        description: req.body.description,
        author: req.auth.subject,
        access: { visibility: 'private', oidcSubject: req.auth.subject }
      });
      return reply.code(201).send(story);
    }
  );

  app.get<{ Params: { id: string } }>('/api/stories/:id', async (req, reply) => {
    const story = await store.getStory(req.params.id);
    if (!story) return reply.code(404).send({ error: 'not_found' });
    if (!canRead(story.access?.visibility, story.access?.oidcSubject, req.auth)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return story;
  });

  app.delete<{ Params: { id: string } }>(
    '/api/stories/:id',
    { preHandler: authenticated },
    async (req, reply) => {
      if (!(await writableStory(req.params.id, req, reply))) return reply;
      const ok = await store.deleteStory(req.params.id);
      return reply.code(ok ? 204 : 404).send();
    }
  );

  app.post<{ Params: { id: string }; Body: { sources: string[]; reconstruct?: string; defaultLocation?: { lat: number; lon: number } } }>(
    '/api/stories/:id/media',
    { preHandler: authenticated },
    async (req, reply) => {
      if (!(await writableStory(req.params.id, req, reply))) return reply;
      const { media } = await ingest({ sources: req.body.sources, hints: { defaultLocation: req.body.defaultLocation } });
      for (const m of media) await store.addMedia(req.params.id, m);
      let job: string | undefined;
      if (req.body.reconstruct && req.body.reconstruct !== 'none') {
        const j = await reconstruct(
          { mediaIds: media.map((m) => m.id), backend: req.body.reconstruct as 'photogrammetry' | 'gaussian-splat' | 'auto' },
          store
        );
        job = j.id;
      }
      return reply.code(201).send({ mediaIds: media.map((m) => m.id), reconstructJob: job });
    }
  );

  app.post<{ Params: { id: string }; Body: Partial<Scene> & { title: string } }>(
    '/api/stories/:id/scenes',
    { preHandler: authenticated },
    async (req, reply) => {
      if (!(await writableStory(req.params.id, req, reply))) return reply;
      const scene: Scene = {
        id: `scene_${Date.now()}`,
        title: req.body.title,
        narrative: req.body.narrative,
        time: req.body.time,
        camera: req.body.camera,
        mediaIds: req.body.mediaIds,
        transition: req.body.transition ?? { kind: 'fly', durationMs: 1800 }
      };
      const added = await store.addScene(req.params.id, scene);
      return added ? reply.code(201).send(added) : reply.code(404).send({ error: 'not_found' });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/stories/:id/compose',
    { preHandler: authenticated },
    async (req, reply) => {
      const story = await writableStory(req.params.id, req, reply);
      if (!story) return reply;
      const located = story.media.filter((m): m is MediaItem & { location: NonNullable<MediaItem['location']> } => !!m.location);
      const ordered = [...located].sort((a, b) => sceneInstantFromTime(a.capturedAt) - sceneInstantFromTime(b.capturedAt));
      const scenes: Scene[] = ordered.map((m, i) => ({
        id: `scene_auto_${i}`,
        title: m.caption ?? `Stop ${i + 1}`,
        time: m.capturedAt,
        camera: { location: { lat: m.location.lat, lon: m.location.lon }, pitch: -40, range: 2600 },
        mediaIds: [m.id],
        transition: { kind: 'fly', durationMs: 1800 }
      }));
      const updated = await store.updateStory(req.params.id, { scenes });
      return updated;
    }
  );

  app.post<{ Params: { id: string }; Body: { visibility?: 'private' | 'unlisted' | 'public'; notify?: string } }>(
    '/api/stories/:id/publish',
    { preHandler: authenticated },
    async (req, reply) => {
      const existing = await writableStory(req.params.id, req, reply);
      if (!existing) return reply;
      // Keep the original owner. Writing `req.auth.subject` unconditionally let
      // a `*`-scoped caller take ownership of somebody else's story by
      // publishing it; only an ownerless story adopts the publisher.
      const story = await store.updateStory(req.params.id, {
        access: {
          visibility: req.body.visibility ?? 'unlisted',
          oidcSubject: existing.access?.oidcSubject ?? req.auth.subject
        }
      });
      if (!story) return reply.code(404).send({ error: 'not_found' });
      const storyJsonUrl = `${apiBaseUrl}/public/stories/${story.id}`;
      const viewerUrl = `${viewerBaseUrl}/?story=${encodeURIComponent(storyJsonUrl)}`;
      await connectors.memory.saveStory(story.id, viewerUrl, req.auth.token);
      await connectors.openclaw.notifyStoryReady(story.id, viewerUrl);
      if (req.body.notify) await connectors.hermes.deliver(viewerUrl, req.body.notify);
      return { viewerUrl, storyJsonUrl };
    }
  );

  // Jobs carry a story's reconstruction state and results, so they are scoped
  // to that story's readers rather than served to anyone holding the job id.
  app.get<{ Params: { id: string } }>(
    '/api/jobs/:id',
    { preHandler: authenticated },
    async (req, reply) => {
      const job = await store.get(req.params.id);
      if (!job) return reply.code(404).send({ error: 'not_found' });
      if (job.storyId) {
        const story = await store.getStory(job.storyId);
        if (story && !canRead(story.access?.visibility, story.access?.oidcSubject, req.auth)) {
          return reply.code(403).send({ error: 'forbidden' });
        }
      }
      return job;
    }
  );

  return app;
}
