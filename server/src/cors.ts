/**
 * Cross-origin access to the API, as an explicit allowlist.
 *
 * The viewer and this API are *always* different origins in every configuration
 * this repo ships: `docker-compose.yml` serves the bundle on :8080 and the API
 * on :8787, and `.env.default` documents `VITE_ATLAS_API=http://localhost:8787/api`
 * against a dev viewer on :4174. Until this module existed there was no
 * `Access-Control-Allow-Origin` anywhere in the server, which meant the media
 * upload the viewer now offers could not have worked from a browser in any
 * deployment: `POST /api/media` sends the file's own content type
 * (`image/jpeg`), which is not a CORS-simple type, so every upload begins with
 * a preflight that had nothing to answer it.
 *
 * The memory client dodges the same problem with a Vite dev proxy
 * (`VITE_DEV_MEMORY_PROXY`). That is a development convenience and not
 * available to a built bundle, so the API has to answer for itself.
 *
 * Three decisions worth stating, because CORS is easy to make permissive by
 * accident:
 *
 *  - **Exact-origin matching, never reflection.** An origin is echoed back only
 *    when it is in the list. A server that reflects whatever `Origin` it is
 *    given has no cross-origin policy at all; it has the appearance of one.
 *  - **Credentials off.** Atlas authenticates with a bearer token that the
 *    caller attaches deliberately, not with a cookie the browser attaches on
 *    its own. Leaving `credentials` off means a hostile page cannot make an
 *    authenticated request just by being open in the same browser — the
 *    property that makes an allowlist mistake survivable rather than fatal.
 *  - **Closed by default.** With `ATLAS_CORS_ORIGINS` unset, no cross-origin
 *    browser request is permitted. A deployment opts in by naming its viewer,
 *    and `NODE_ENV=development` adds the local viewer ports so that a developer
 *    who has just set `VITE_ATLAS_API` does not have to discover this file.
 */

/** The dev viewer's own origins: Vite (4174), `vite preview` (4173), and the
 *  container image's nginx (8080). Added only when NODE_ENV says development. */
const DEV_ORIGINS = [
  'http://localhost:4174',
  'http://127.0.0.1:4174',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

export interface CorsPolicy {
  /** Exact origins that may call the API from a browser. Empty means none. */
  origins: string[];
  /** True when the list came from `ATLAS_CORS_ORIGINS` rather than the dev
   *  defaults — used by the boot log, so an operator can tell which they got. */
  explicit: boolean;
}

/**
 * Read the policy from the environment.
 *
 * `ATLAS_CORS_ORIGINS` is a comma-separated list of origins (scheme, host and
 * port — no path, no wildcard). A `*` is accepted and means what it says, but
 * only as a deliberate spelling: it can never arrive by leaving the variable
 * unset.
 */
export function corsPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): CorsPolicy {
  const raw = env.ATLAS_CORS_ORIGINS?.trim();
  if (raw) {
    const origins = raw.split(',').map((s) => s.trim()).filter(Boolean).map(normaliseOrigin);
    return { origins, explicit: true };
  }
  const dev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  return { origins: dev ? [...DEV_ORIGINS] : [], explicit: false };
}

/**
 * `https://viewer.example/` and `https://viewer.example` are the same origin; a
 * trailing slash in the variable must not silently disable a deployment's CORS.
 * Anything that is not a parseable absolute URL is left alone so it fails the
 * exact match rather than being coerced into matching something.
 */
function normaliseOrigin(value: string): string {
  if (value === '*') return value;
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

/**
 * The `origin` callback `@fastify/cors` takes.
 *
 * A request with no `Origin` header is allowed: that is every non-browser
 * caller (curl, the MCP clients, a server-to-server fetch), and CORS has no
 * opinion about those — it is a browser mechanism and refusing here would break
 * them for no security gain, since a program that sends no Origin can send any.
 */
export function corsOriginCheck(policy: CorsPolicy) {
  const allowAll = policy.origins.includes('*');
  const allowed = new Set(policy.origins);
  return (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void): void => {
    if (!origin) return cb(null, true);
    cb(null, allowAll || allowed.has(origin));
  };
}

/** Headers a browser may send. `Content-Type` carries the uploaded file's own
 *  type, and `Authorization` the bearer token — without both, upload preflight
 *  fails even with the origin allowed. */
export const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization'];

/** `Location` is how `POST /api/media` names the object it just stored, and a
 *  browser cannot read a response header that is not exposed. */
export const CORS_EXPOSED_HEADERS = ['Location'];

export const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
