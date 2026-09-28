/**
 * Companion OIDC authentication — CI-Portal relying party.
 *
 * Atlas verifies bearer tokens issued by CI-Portal (better-auth `oidcProvider`).
 * Portal signs access-token JWTs with **EdDSA** and publishes a JWKS at
 * `<portal-origin>/api/auth/jwks`; a relying party verifies with
 * `jose.jwtVerify` against `createRemoteJWKSet`, enforcing **issuer** and
 * **audience** (Portal issues per-client tokens, so `aud === client_id`, our
 * `companion-atlas`). The verified `sub` subject scopes every story to its owner.
 *
 * Configure via env (.env.default):
 *   COMPANION_OIDC_ISSUER     Portal issuer, e.g. https://hub.ci.localhost/api/auth
 *                             (better-auth mounts OIDC under /api/auth, and the
 *                             token `iss` is `<portal-origin>/api/auth`)
 *   COMPANION_OIDC_JWKS_URI   optional; derived from the issuer otherwise
 *   COMPANION_OIDC_AUDIENCE   comma-separated allowed client ids (= our client id)
 *   ATLAS_DEV_SUBJECT         dev subject used when the issuer is unset
 *   ATLAS_ALLOW_DEV_AUTH      `1` to permit the issuer-less dev bypass in an
 *                             environment that is not marked development/test
 *
 * Leaving COMPANION_OIDC_ISSUER empty disables auth for local dev (single dev
 * subject with `*` scope). This is the real verifier — not a decode-only stub.
 * `assertAuthSafeToBoot()` stops that bypass reaching a deployment: the HTTP
 * entry point refuses to start unless the environment says it is development
 * or test, or opts in explicitly.
 *
 * ── Authorisation ─────────────────────────────────────────────────────────
 * Verification answers *who is calling*; these three predicates answer *what
 * they may do*. Ownership is the primitive: a story's owner is
 * `access.oidcSubject`, set from the verified subject at create time.
 *
 *   isAuthenticated(ctx)      ctx is a verified subject, not the ANONYMOUS
 *                             fallback. Every mutating route and MCP tool
 *                             gates on this first → 401 / "unauthenticated".
 *   canRead(vis, owner, ctx)  public/unlisted are world-readable (the viewer
 *                             fetches them unauthenticated); private needs the
 *                             owner or `*`.
 *   canWrite(owner, ctx)      mutate/delete: the owner, or `*`. An *ownerless*
 *                             story (no `access.oidcSubject`) is writable only
 *                             by `*` — fail closed, since we cannot attribute it.
 *
 * `*` is the only scope honoured today. Portal's own scope vocabulary is not
 * yet defined anywhere Atlas can see, so mapping Portal scopes onto Atlas
 * operations is a deliberate follow-up rather than invented here; ownership
 * carries the model in the meantime. See docs/architecture.md §13.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';

export interface AuthContext {
  subject: string;
  scopes: string[];
  token: string;
  email?: string;
}

export const ANONYMOUS: AuthContext = { subject: 'anonymous', scopes: [], token: '' };

export interface OidcConfig {
  /** Canonical issuer (`iss`), e.g. `https://hub.ci.localhost/api/auth`. */
  issuer: string;
  /** JWKS endpoint. Derived from the issuer when not given. */
  jwksUri: string;
  /** Allowed audiences (Portal client ids). `aud` must match one. */
  audience: string[];
}

/** Read OIDC config from env, or `null` when auth is disabled (no issuer). */
export function oidcConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = env.COMPANION_OIDC_ISSUER?.trim();
  if (!issuer) return null;
  const base = issuer.replace(/\/$/, '');
  // better-auth serves JWKS at `<origin>/api/auth/jwks`. The issuer may be given
  // as the origin OR as `<origin>/api/auth` (the actual token `iss`) — handle both.
  const jwksUri =
    env.COMPANION_OIDC_JWKS_URI?.trim() ||
    (base.endsWith('/api/auth') ? `${base}/jwks` : `${base}/api/auth/jwks`);
  const audience = (env.COMPANION_OIDC_AUDIENCE ?? 'companion-atlas')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { issuer: base, jwksUri, audience };
}

// One remote JWKS per endpoint (jose caches keys + honours cache headers).
const jwksCache = new Map<string, JWTVerifyGetKey>();
function remoteJwks(uri: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, jwks);
  }
  return jwks;
}

/**
 * Verify a token against a key source (a JWKS getter or a public key). The key
 * source is a parameter so this is unit-testable with a local keypair — no
 * network. Throws on bad signature / issuer / audience / expiry.
 */
export async function verifyToken(
  token: string,
  cfg: OidcConfig,
  keys: JWTVerifyGetKey | KeyLike | Uint8Array,
): Promise<AuthContext> {
  const { payload } = await jwtVerify(token, keys as JWTVerifyGetKey, {
    issuer: cfg.issuer,
    audience: cfg.audience,
    // Pin the acceptable signature algorithms. `jwtVerify` otherwise accepts
    // whatever the token's own header asks for, so a JWKS that ever served a
    // symmetric (`oct`) key — a misconfiguration, or a compromised key set —
    // would let an attacker sign their own token with the *public* key as an
    // HMAC secret and have it verify. Listing only asymmetric algorithms makes
    // that class of confusion impossible rather than unlikely.
    algorithms: ['EdDSA', 'ES256', 'ES384', 'RS256', 'PS256'],
    // Reject a token that carries no expiry or no subject before any claim is
    // read. Without `exp` a leaked token is valid forever, and the `sub` check
    // below can only run once something has guaranteed the claim is present.
    requiredClaims: ['sub', 'exp'],
  });
  // A token without a usable `sub` cannot be authorised: `String(undefined)`
  // would mint the literal subject "undefined", which could then own stories.
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('token has no subject (sub) claim');
  }
  if (payload.sub === ANONYMOUS.subject) {
    throw new Error(`token subject may not be the reserved "${ANONYMOUS.subject}" name`);
  }
  const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
  return {
    subject: payload.sub,
    scopes,
    token,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}

/**
 * The single, fully-scoped local subject used where the *process* is the trust
 * boundary rather than a bearer token: the dev bypass (no issuer configured)
 * and the stdio MCP transport, which has no HTTP request to carry a token.
 */
export function devSubjectContext(token = '', env: NodeJS.ProcessEnv = process.env): AuthContext {
  return { subject: env.ATLAS_DEV_SUBJECT ?? 'dev-operator', scopes: ['*'], token };
}

/**
 * True when this environment has *positively identified itself* as a developer
 * machine or a test runner, and may therefore run without real auth.
 *
 * Deliberately an allowlist rather than `NODE_ENV === 'production'`. The bug
 * this guards is a deployment booting unconfigured, and the likeliest shape of
 * that mistake is `NODE_ENV` never being set at all — so a check that fires
 * only on an explicit production marker would miss the very case it exists to
 * catch, failing open exactly like the bypass it is guarding. Absence of proof
 * is treated as deployed.
 *
 * `ATLAS_ALLOW_DEV_AUTH=1` is the escape hatch for environments that are not
 * production but cannot say so through `NODE_ENV` — staging, demos, and this
 * repo's own `docker-compose.dev.yml`, whose `atlas-api` builds from
 * `server/Dockerfile` and therefore inherits `ENV NODE_ENV=production` even in
 * MOCK mode (docs/INTEGRATION.md "Mode A").
 */
export function devAuthBypassAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const optIn = env.ATLAS_ALLOW_DEV_AUTH?.trim().toLowerCase();
  if (optIn === '1' || optIn === 'true') return true;
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  return nodeEnv === 'development' || nodeEnv === 'test';
}

/**
 * Refuse to boot into the dev auth bypass in a deployed environment.
 *
 * With no `COMPANION_OIDC_ISSUER`, `verifyBearer()` returns `devSubjectContext()`
 * — `*` scope — for *every* request, token or not. `*` satisfies both `canRead`
 * and `canWrite`, so that configuration hands every anonymous caller full
 * ownership rights over every story and silently voids the per-story
 * authorisation `api.ts` and `mcp.ts` enforce. Intentional locally; a serious
 * incident anywhere else.
 *
 * Called once at startup from `server/src/index.ts`, the HTTP entry point. It is
 * deliberately *not* called by `mcp-stdio.ts`: over stdio the local process is
 * the trust boundary (whoever can spawn it can already read the store) and the
 * store is per-process, so `devSubjectContext()` is correct there by design.
 *
 * @throws Error with an operator-actionable message when the bypass would be
 *         active outside a development or test environment.
 */
export function assertAuthSafeToBoot(env: NodeJS.ProcessEnv = process.env): void {
  // Real auth configured — nothing to guard, whatever NODE_ENV says.
  if (oidcConfigFromEnv(env)) return;
  if (devAuthBypassAllowed(env)) return;

  const subject = devSubjectContext('', env).subject;
  throw new Error(
    [
      'Refusing to start: authentication is disabled but this does not look like a development environment.',
      '',
      `COMPANION_OIDC_ISSUER is unset, so every request — with or without a token — would run as`,
      `"${subject}" holding the "*" scope, giving any anonymous caller read and write access to`,
      'every story. Per-story authorisation would be inert.',
      '',
      `(NODE_ENV=${env.NODE_ENV === undefined ? '<unset>' : JSON.stringify(env.NODE_ENV)})`,
      '',
      'Resolve by one of:',
      '  • Set COMPANION_OIDC_ISSUER (and COMPANION_OIDC_AUDIENCE) to your CI-Portal issuer',
      '    — e.g. COMPANION_OIDC_ISSUER=https://hub.ci.localhost/api/auth',
      '  • Set NODE_ENV=development (or test) for genuine local development',
      '  • Set ATLAS_ALLOW_DEV_AUTH=1 to keep the bypass deliberately — never in production',
    ].join('\n'),
  );
}

/**
 * Verify an `Authorization: Bearer …` header and return its auth context.
 *
 * `env` defaults to `process.env` for the Fastify entry point (index.ts);
 * the Worker entry point (worker.ts) passes its own bindings object instead,
 * since Workers has no populated `process.env` for these variables.
 */
export async function verifyBearer(authorization?: string, env: NodeJS.ProcessEnv = process.env): Promise<AuthContext> {
  const cfg = oidcConfigFromEnv(env);
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';

  if (!cfg) {
    // Auth disabled for local/dev — everything runs as a single dev subject.
    return devSubjectContext(token, env);
  }
  if (!token) return ANONYMOUS;

  try {
    return await verifyToken(token, cfg, remoteJwks(cfg.jwksUri));
  } catch {
    // Invalid signature, issuer, audience, or expiry → unauthenticated.
    return ANONYMOUS;
  }
}

/**
 * True when the context carries a verified subject rather than the ANONYMOUS
 * fallback `verifyBearer` returns for a missing or unverifiable token.
 *
 * Reads may run anonymously (see `canRead`); writes must not. Gate every
 * mutating route and MCP tool on this so an unauthenticated write fails loudly
 * instead of silently succeeding as a story owned by `anonymous`.
 */
export function isAuthenticated(ctx: AuthContext): boolean {
  return ctx.subject.length > 0 && ctx.subject !== ANONYMOUS.subject;
}

/** True when the story is readable by the given auth context. */
export function canRead(visibility: string | undefined, owner: string | undefined, ctx: AuthContext): boolean {
  if (visibility === 'public' || visibility === 'unlisted') return true;
  if (!isAuthenticated(ctx)) return false;
  return owner === ctx.subject || ctx.scopes.includes('*');
}

/**
 * True when the context may mutate or delete a story owned by `owner`.
 *
 * Fails closed on an *ownerless* story (`access.oidcSubject` unset, as stories
 * created before ownership was recorded are): with nobody to compare against,
 * only a `*`-scoped subject may write it.
 */
export function canWrite(owner: string | undefined, ctx: AuthContext): boolean {
  if (!isAuthenticated(ctx)) return false;
  if (ctx.scopes.includes('*')) return true;
  return owner !== undefined && owner === ctx.subject;
}
