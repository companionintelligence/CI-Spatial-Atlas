/**
 * Cross-origin access, and why the media upload could not have worked without
 * it.
 *
 * There was no `Access-Control-Allow-Origin` anywhere in this server, and the
 * viewer is never same-origin with it: `docker-compose.yml` puts the bundle on
 * :8080 and the API on :8787, and `.env.default` documents
 * `VITE_ATLAS_API=http://localhost:8787/api` against a dev viewer on :4174.
 * `POST /api/media` sends the file's own content type, which is not a
 * CORS-simple type, so every upload starts with a preflight — and a preflight
 * with no answer fails before authentication is ever consulted. The failure
 * would have read as "uploads are broken" with a green server log.
 *
 * The security half is the reason this is an allowlist and not a reflector:
 * echoing back whatever `Origin` arrives is not a policy, it is the appearance
 * of one.
 */
import { describe, expect, it } from 'vitest';
import { buildApi } from '../src/api.js';
import { InMemoryStore } from '../src/store.js';
import { createConnectors } from '../src/connectors.js';
import { corsPolicyFromEnv } from '../src/cors.js';

const VIEWER = 'https://atlas.example';

const app = (origins: string[]) =>
  buildApi({
    store: new InMemoryStore(),
    connectors: createConnectors(),
    viewerBaseUrl: VIEWER,
    apiBaseUrl: 'https://api.example/api',
    logger: false,
    cors: { origins, explicit: true },
  });

const preflight = (origins: string[], origin: string, method = 'POST') =>
  app(origins).inject({
    method: 'OPTIONS',
    url: '/api/media',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'content-type,authorization',
    },
  });

describe('the upload preflight', () => {
  it('is answered for an allowed origin, with the headers an upload needs', async () => {
    const res = await preflight([VIEWER], VIEWER);
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(VIEWER);
    const allowed = String(res.headers['access-control-allow-headers'] ?? '').toLowerCase();
    // Content-Type carries the file's own type; Authorization carries the
    // bearer token. Missing either fails the preflight with the origin allowed.
    expect(allowed).toContain('content-type');
    expect(allowed).toContain('authorization');
    expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
  });

  it('does not name an origin that is not on the list', async () => {
    const res = await preflight([VIEWER], 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never reflects an arbitrary origin back', async () => {
    const res = await preflight([VIEWER], 'https://atlas.example.evil.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('the response to a real request', () => {
  it('names an allowed origin', async () => {
    const res = await app([VIEWER]).inject({ method: 'GET', url: '/healthz', headers: { origin: VIEWER } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(VIEWER);
  });

  it('exposes Location, which is how an upload names what it stored', async () => {
    const res = await app([VIEWER]).inject({ method: 'GET', url: '/healthz', headers: { origin: VIEWER } });
    expect(String(res.headers['access-control-expose-headers'])).toContain('Location');
  });

  it('never turns on credentials — an ambient cookie must not authenticate', async () => {
    // This is what keeps an allowlist mistake survivable: a hostile page cannot
    // make an authenticated request merely by being open in the same browser.
    const res = await app([VIEWER]).inject({ method: 'GET', url: '/healthz', headers: { origin: VIEWER } });
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('still serves a caller that sends no Origin at all', async () => {
    // curl, the MCP clients, server-to-server. CORS is a browser mechanism and
    // has no opinion about these; refusing them would break them for no gain.
    const res = await app([]).inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });
});

describe('the policy read from the environment', () => {
  it('is closed when nothing is set and this is not development', () => {
    expect(corsPolicyFromEnv({ NODE_ENV: 'production' })).toEqual({ origins: [], explicit: false });
  });

  it('opens the local viewer ports in development, so VITE_ATLAS_API just works', () => {
    const policy = corsPolicyFromEnv({ NODE_ENV: 'development' });
    expect(policy.explicit).toBe(false);
    expect(policy.origins).toContain('http://localhost:4174');
    expect(policy.origins).toContain('http://localhost:8080');
  });

  it('takes an explicit list over the dev defaults', () => {
    const policy = corsPolicyFromEnv({ NODE_ENV: 'development', ATLAS_CORS_ORIGINS: VIEWER });
    expect(policy).toEqual({ origins: [VIEWER], explicit: true });
  });

  it('reads a comma-separated list, trimming as it goes', () => {
    const policy = corsPolicyFromEnv({ ATLAS_CORS_ORIGINS: ` ${VIEWER} , https://other.example ` });
    expect(policy.origins).toEqual([VIEWER, 'https://other.example']);
  });

  it('tolerates a trailing slash rather than silently matching nothing', async () => {
    const policy = corsPolicyFromEnv({ ATLAS_CORS_ORIGINS: `${VIEWER}/` });
    expect(policy.origins).toEqual([VIEWER]);
    const res = await preflight(policy.origins, VIEWER);
    expect(res.headers['access-control-allow-origin']).toBe(VIEWER);
  });

  it('cannot become a wildcard by omission — only by spelling one', () => {
    expect(corsPolicyFromEnv({}).origins).not.toContain('*');
    expect(corsPolicyFromEnv({ ATLAS_CORS_ORIGINS: '*' }).origins).toEqual(['*']);
  });
});
