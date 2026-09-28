/**
 * Companion Atlas — Cloudflare Worker entry point.
 *
 * A parallel deployment target to index.ts (Fastify), not a replacement:
 * this is the "prod env" for the standalone Cloudflare-hosted viewer at
 * atlas.ci.computer, serving the REST surface the viewer actually calls
 * (story CRUD, publish, media upload/download) against D1 + R2 instead of
 * Postgres/Redis/MinIO. Out of scope here, on purpose:
 *
 *   - The MCP tool surface (mcp.ts) — OpenClaw/Hermes/agent clients keep
 *     using the containerized Fastify deployment's /mcp endpoint.
 *   - Real reconstruction (pipeline.ts's `reconstruct()`) — COLMAP,
 *     OpenDroneMap, and Nerfstudio need a GPU worker container that
 *     Cloudflare Workers cannot run. `POST /api/stories/:id/media` still
 *     enqueues a job here (so the API shape matches the Fastify server),
 *     but nothing ever drains it in this deployment; it stays `queued`.
 *     Point reconstruction requests at the containerized stack until a
 *     Workers-reachable queue + GPU worker exists.
 *
 * Static assets (the viewer-react build) are served directly by Cloudflare's
 * assets layer, never through this file — wrangler.toml's `run_worker_first`
 * names only `/api/*` and `/healthz`, so every other request (the SPA shell,
 * JS/CSS, Cesium's static assets) is answered before this fetch handler runs
 * at all. That is also why there is no ASSETS-binding fallback route below.
 *
 * Route-for-route, this mirrors api.ts + media.ts; see those files for why
 * each authorization check exists. What differs is only the runtime seam:
 * Hono's Context instead of Fastify's req/reply, D1/R2 bindings instead of
 * an in-memory Map and a MinIO client, and `env` passed explicitly instead
 * of read from `process.env` (Workers never populates the latter for these
 * variables).
 */

import { Hono, type Context, type Next } from 'hono';

import {
  canRead,
  canWrite,
  devAuthBypassAllowed,
  isAuthenticated,
  oidcConfigFromEnv,
  verifyBearer,
  type AuthContext,
} from './auth.js';
import { sceneInstantFromTime } from './compose.js';
import { CiMemoryConnector, HermesConnector, OpenClawConnector } from './connectors.js';
import {
  corsOriginCheck,
  corsPolicyFromEnv,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSED_HEADERS,
  CORS_METHODS,
} from './cors.js';
import {
  isUploadKey,
  mediaKindFor,
  newObjectKey,
  normaliseContentType,
  uploadLimitsFromEnv,
} from './object-store.js';
import { r2Get, r2Put } from './object-store-r2.js';
import { ingest, reconstruct, type ReconstructBackend } from './pipeline.js';
import type { MediaItem, Scene, Story } from './schema.js';
import { D1Store } from './store-d1.js';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;

  ATLAS_VIEWER_BASE_URL?: string;
  ATLAS_API_BASE_URL?: string;
  ATLAS_CORS_ORIGINS?: string;
  ATLAS_MAX_UPLOAD_BYTES?: string;
  ATLAS_UPLOAD_CONTENT_TYPES?: string;

  COMPANION_OIDC_ISSUER?: string;
  COMPANION_OIDC_JWKS_URI?: string;
  COMPANION_OIDC_AUDIENCE?: string;
  ATLAS_DEV_SUBJECT?: string;
  ATLAS_ALLOW_DEV_AUTH?: string;

  CI_MEMORY_URL?: string;
  CI_MEMORY_TOKEN?: string;
  CI_MEMORY_API_KEY?: string;
  OPENCLAW_URL?: string;
  HERMES_URL?: string;
}

type Vars = { auth: AuthContext };
type AppContext = Context<{ Bindings: Env; Variables: Vars }>;

/** The subset of `env` the shared auth/cors/object-store helpers read —
 *  all plain strings, so functions typed against `NodeJS.ProcessEnv` (they
 *  default to `process.env` for index.ts, the Fastify entry point) can take
 *  this instead, since Workers never populates `process.env` with these. */
function toProcessEnv(env: Env): NodeJS.ProcessEnv {
  return {
    COMPANION_OIDC_ISSUER: env.COMPANION_OIDC_ISSUER,
    COMPANION_OIDC_JWKS_URI: env.COMPANION_OIDC_JWKS_URI,
    COMPANION_OIDC_AUDIENCE: env.COMPANION_OIDC_AUDIENCE,
    ATLAS_DEV_SUBJECT: env.ATLAS_DEV_SUBJECT,
    ATLAS_ALLOW_DEV_AUTH: env.ATLAS_ALLOW_DEV_AUTH,
    ATLAS_CORS_ORIGINS: env.ATLAS_CORS_ORIGINS,
    ATLAS_MAX_UPLOAD_BYTES: env.ATLAS_MAX_UPLOAD_BYTES,
    ATLAS_UPLOAD_CONTENT_TYPES: env.ATLAS_UPLOAD_CONTENT_TYPES,
  };
}

function connectorsFromEnv(env: Env) {
  return {
    memory: new CiMemoryConnector(env.CI_MEMORY_URL ?? '', env.CI_MEMORY_TOKEN ?? '', env.CI_MEMORY_API_KEY ?? ''),
    openclaw: new OpenClawConnector(env.OPENCLAW_URL ?? ''),
    hermes: new HermesConnector(env.HERMES_URL ?? ''),
  };
}

/** Load the story at `id` for a caller who intends to mutate it, or the
 *  right refusal Response to return as-is. Mirrors `writableStory` in
 *  api.ts — see there for why an ownerless story fails closed. */
async function writableStory(
  c: AppContext,
  store: D1Store,
  id: string,
): Promise<{ story: null; refusal: Response } | { story: Story; refusal: null }> {
  const story = await store.getStory(id);
  if (!story) return { story: null, refusal: c.json({ error: 'not_found' }, 404) };
  if (!canWrite(story.access?.oidcSubject, c.get('auth'))) {
    return { story: null, refusal: c.json({ error: 'forbidden' }, 403) };
  }
  return { story, refusal: null };
}

function tooLarge(maxBytes: number) {
  return {
    error: 'file_too_large',
    maxBytes,
    message: `This file is larger than the ${formatBytes(maxBytes)} this server accepts. Nothing was stored.`,
  };
}

/**
 * Duplicated from media.ts (`mediaUrl`/`formatBytes`) rather than imported:
 * media.ts pulls in `fastify` (its `registerMediaRoutes` builds routes
 * against `FastifyInstance`) and relies on the `req.auth` module
 * augmentation api.ts declares — neither belongs in a Workers bundle, and
 * importing just these two pure one-liners would drag the whole file's
 * Fastify types into this program regardless. Two small formatting
 * functions duplicated is a better trade than a Fastify dependency in a
 * Worker that never runs Fastify.
 */
function mediaUrl(apiBaseUrl: string, key: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/media/o/${key}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${round(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 * 1024) return `${round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${round(bytes / 1024)} kB`;
  return `${bytes} bytes`;
}

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── CORS ─────────────────────────────────────────────────────────────────
// Same policy and exact-origin matching as cors.ts; see there for why
// reflection and credentials are both deliberately absent.
app.use('*', async (c, next) => {
  const policy = corsPolicyFromEnv(toProcessEnv(c.env));
  const check = corsOriginCheck(policy);
  const origin = c.req.header('origin');
  let allowed = false;
  check(origin, (_err, ok) => {
    allowed = ok;
  });

  if (c.req.method === 'OPTIONS') {
    const headers = new Headers({
      'access-control-allow-methods': CORS_METHODS.join(', '),
      'access-control-allow-headers': CORS_ALLOWED_HEADERS.join(', '),
      'access-control-max-age': '600',
    });
    if (origin && allowed) {
      headers.set('access-control-allow-origin', origin);
      headers.set('vary', 'origin');
    }
    return new Response(null, { status: 204, headers });
  }

  await next();

  if (origin && allowed && c.res) {
    c.res.headers.set('access-control-allow-origin', origin);
    c.res.headers.set('vary', 'origin');
    c.res.headers.set('access-control-expose-headers', CORS_EXPOSED_HEADERS.join(', '));
  }
});

// ── Refuse to serve the dev-auth bypass in a deployed environment ─────────
// The Fastify entry point (index.ts) enforces this once at process boot via
// `assertAuthSafeToBoot()`; a Worker has no boot phase; a request does, so
// the same rule runs here, per request, for every path except /healthz.
// Reuses `oidcConfigFromEnv`/`devAuthBypassAllowed` directly rather than
// `assertAuthSafeToBoot` itself, since that throws-to-crash-the-process by
// design (see auth.ts) and a Worker should answer 500, not attempt to exit.
app.use('*', async (c, next) => {
  if (c.req.path === '/healthz') return next();
  const env = toProcessEnv(c.env);
  if (!oidcConfigFromEnv(env) && !devAuthBypassAllowed(env)) {
    return c.json(
      {
        error: 'auth_not_configured',
        message:
          'COMPANION_OIDC_ISSUER is not set on this deployment, which would otherwise run every ' +
          'request as the fully-scoped dev subject. Set COMPANION_OIDC_ISSUER (+ COMPANION_OIDC_AUDIENCE) ' +
          'in wrangler.toml, or ATLAS_ALLOW_DEV_AUTH=1 to accept the bypass deliberately.',
      },
      500,
    );
  }
  await next();
});

// ── Auth: attach the verified (or anonymous/dev) context to every request ──
app.use('*', async (c, next) => {
  const auth = await verifyBearer(c.req.header('authorization'), toProcessEnv(c.env));
  c.set('auth', auth);
  await next();
});

async function requireAuth(c: AppContext, next: Next) {
  if (!isAuthenticated(c.get('auth'))) return c.json({ error: 'unauthenticated' }, 401);
  await next();
}

app.get('/healthz', (c) => c.json({ ok: true, service: 'companion-atlas', version: '0.1.0' }));

// ── Media upload ────────────────────────────────────────────────────────
app.get('/api/media/config', requireAuth, (c) => {
  const limits = uploadLimitsFromEnv(toProcessEnv(c.env));
  return c.json({ configured: true, maxBytes: limits.maxBytes, contentTypes: limits.contentTypes });
});

app.post('/api/media', requireAuth, async (c) => {
  const limits = uploadLimitsFromEnv(toProcessEnv(c.env));
  const contentType = normaliseContentType(c.req.header('content-type'));
  if (!contentType || !limits.contentTypes.includes(contentType)) {
    return c.json(
      {
        error: 'unsupported_media_type',
        message: `${contentType ?? 'A missing content type'} cannot be uploaded. Accepted types: ${limits.contentTypes.join(', ')}.`,
        contentTypes: limits.contentTypes,
      },
      415,
    );
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    return c.json({ error: 'empty_upload', message: 'The request carried no bytes. Nothing was stored.' }, 400);
  }
  if (body.byteLength > limits.maxBytes) {
    return c.json(tooLarge(limits.maxBytes), 413);
  }

  const auth = c.get('auth');
  const key = newObjectKey(auth.subject, contentType);
  try {
    await r2Put(c.env.MEDIA, key, body, contentType);
  } catch {
    return c.json(
      { error: 'storage_unavailable', message: 'The object store rejected the upload. Nothing was stored.' },
      502,
    );
  }

  const apiBaseUrl = c.env.ATLAS_API_BASE_URL ?? new URL('/api', c.req.url).toString();
  return c.json(
    { key, url: mediaUrl(apiBaseUrl, key), contentType, kind: mediaKindFor(contentType), bytes: body.byteLength },
    201,
  );
});

app.get('/api/media/o/*', async (c) => {
  const key = c.req.path.replace(/^\/api\/media\/o\//, '');
  if (!isUploadKey(key)) return c.json({ error: 'not_found' }, 404);

  const object = await r2Get(c.env.MEDIA, key);
  if (!object) return c.json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'content-length': String(object.size),
      // Two independent guards against an uploaded file being interpreted
      // as a document on this origin — see media.ts for the full reasoning.
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': 'inline',
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
});

// ── Public, shareable story document the viewer fetches ───────────────────
app.get('/api/public/stories/:id', async (c) => {
  const store = new D1Store(c.env.DB);
  const story = await store.getStory(c.req.param('id')!);
  if (!story) return c.json({ error: 'not_found' }, 404);
  if (!canRead(story.access?.visibility, story.access?.oidcSubject, c.get('auth'))) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return c.json(story);
});

// ── Authenticated story CRUD ───────────────────────────────────────────────
app.get('/api/stories', async (c) => {
  const store = new D1Store(c.env.DB);
  const auth = c.get('auth');
  const stories = await store.listStories();
  return c.json(
    stories
      .filter((s) => canRead(s.access?.visibility, s.access?.oidcSubject, auth))
      .map((s) => ({ id: s.id, title: s.title, scenes: s.scenes.length, updatedAt: s.updatedAt })),
  );
});

app.post('/api/stories', requireAuth, async (c) => {
  const body = await c.req.json<{ title?: string; description?: string }>().catch(() => null);
  if (!body?.title) return c.json({ error: 'title_required' }, 400);
  const auth = c.get('auth');
  const store = new D1Store(c.env.DB);
  const story = await store.createStory({
    title: body.title,
    description: body.description,
    author: auth.subject,
    access: { visibility: 'private', oidcSubject: auth.subject },
  });
  return c.json(story, 201);
});

app.get('/api/stories/:id', async (c) => {
  const store = new D1Store(c.env.DB);
  const story = await store.getStory(c.req.param('id')!);
  if (!story) return c.json({ error: 'not_found' }, 404);
  if (!canRead(story.access?.visibility, story.access?.oidcSubject, c.get('auth'))) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return c.json(story);
});

app.delete('/api/stories/:id', requireAuth, async (c) => {
  const store = new D1Store(c.env.DB);
  const { story, refusal } = await writableStory(c, store, c.req.param('id')!);
  if (!story) return refusal;
  const ok = await store.deleteStory(story.id);
  return c.body(null, ok ? 204 : 404);
});

app.post('/api/stories/:id/media', requireAuth, async (c) => {
  const store = new D1Store(c.env.DB);
  const { story, refusal } = await writableStory(c, store, c.req.param('id')!);
  if (!story) return refusal;

  const body = await c.req.json<{
    sources: string[];
    reconstruct?: string;
    defaultLocation?: { lat: number; lon: number };
  }>();
  const { media } = await ingest({ sources: body.sources, hints: { defaultLocation: body.defaultLocation } });
  for (const m of media) await store.addMedia(story.id, m);

  let job: string | undefined;
  if (body.reconstruct && body.reconstruct !== 'none') {
    const j = await reconstruct(
      { mediaIds: media.map((m) => m.id), backend: body.reconstruct as ReconstructBackend },
      store,
    );
    job = j.id;
  }
  return c.json({ mediaIds: media.map((m) => m.id), reconstructJob: job }, 201);
});

app.post('/api/stories/:id/scenes', requireAuth, async (c) => {
  const store = new D1Store(c.env.DB);
  const { story, refusal } = await writableStory(c, store, c.req.param('id')!);
  if (!story) return refusal;

  const body = await c.req.json<Partial<Scene> & { title: string }>();
  const scene: Scene = {
    id: `scene_${Date.now()}`,
    title: body.title,
    narrative: body.narrative,
    time: body.time,
    camera: body.camera,
    mediaIds: body.mediaIds,
    transition: body.transition ?? { kind: 'fly', durationMs: 1800 },
  };
  const added = await store.addScene(story.id, scene);
  return added ? c.json(added, 201) : c.json({ error: 'not_found' }, 404);
});

app.post('/api/stories/:id/compose', requireAuth, async (c) => {
  const store = new D1Store(c.env.DB);
  const { story, refusal } = await writableStory(c, store, c.req.param('id')!);
  if (!story) return refusal;

  const located = story.media.filter(
    (m): m is MediaItem & { location: NonNullable<MediaItem['location']> } => !!m.location,
  );
  const ordered = [...located].sort((a, b) => sceneInstantFromTime(a.capturedAt) - sceneInstantFromTime(b.capturedAt));
  const scenes: Scene[] = ordered.map((m, i) => ({
    id: `scene_auto_${i}`,
    title: m.caption ?? `Stop ${i + 1}`,
    time: m.capturedAt,
    camera: { location: { lat: m.location.lat, lon: m.location.lon }, pitch: -40, range: 2600 },
    mediaIds: [m.id],
    transition: { kind: 'fly', durationMs: 1800 },
  }));
  const updated = await store.updateStory(story.id, { scenes });
  return c.json(updated);
});

app.post('/api/stories/:id/publish', requireAuth, async (c) => {
  const store = new D1Store(c.env.DB);
  const { story: existing, refusal } = await writableStory(c, store, c.req.param('id')!);
  if (!existing) return refusal;

  const body = await c
    .req.json<{ visibility?: 'private' | 'unlisted' | 'public'; notify?: string }>()
    .catch(() => ({}) as { visibility?: 'private' | 'unlisted' | 'public'; notify?: string });
  const auth = c.get('auth');
  // Keep the original owner — see the matching route in api.ts for why a
  // `*`-scoped caller must not take ownership by publishing someone else's story.
  const story = await store.updateStory(existing.id, {
    access: {
      visibility: body.visibility ?? 'unlisted',
      oidcSubject: existing.access?.oidcSubject ?? auth.subject,
    },
  });
  if (!story) return c.json({ error: 'not_found' }, 404);

  const apiBaseUrl = c.env.ATLAS_API_BASE_URL ?? new URL('/api', c.req.url).toString();
  const viewerBaseUrl = c.env.ATLAS_VIEWER_BASE_URL ?? new URL(c.req.url).origin;
  const storyJsonUrl = `${apiBaseUrl}/public/stories/${story.id}`;
  const viewerUrl = `${viewerBaseUrl}/?story=${encodeURIComponent(storyJsonUrl)}`;

  const connectors = connectorsFromEnv(c.env);
  // Matches api.ts exactly: `saveStory` (not `saveStoryMemory`) is what the
  // Fastify route calls too, and is a documented no-op there — see
  // connectors.ts. Not this port's place to change that behavior.
  await connectors.memory.saveStory(story.id, viewerUrl, auth.token);
  await connectors.openclaw.notifyStoryReady(story.id, viewerUrl);
  if (body.notify) await connectors.hermes.deliver(viewerUrl, body.notify);

  return c.json({ viewerUrl, storyJsonUrl });
});

// Jobs carry a story's reconstruction state, so they are scoped to that
// story's readers rather than served to anyone holding the job id.
app.get('/api/jobs/:id', requireAuth, async (c) => {
  const store = new D1Store(c.env.DB);
  const job = await store.get(c.req.param('id')!);
  if (!job) return c.json({ error: 'not_found' }, 404);
  if (job.storyId) {
    const story = await store.getStory(job.storyId);
    if (story && !canRead(story.access?.visibility, story.access?.oidcSubject, c.get('auth'))) {
      return c.json({ error: 'forbidden' }, 403);
    }
  }
  return c.json(job);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
