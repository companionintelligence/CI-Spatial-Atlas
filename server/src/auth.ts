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
 *
 * Leaving COMPANION_OIDC_ISSUER empty disables auth for local dev (single dev
 * subject with `*` scope). This is the real verifier — not a decode-only stub.
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

/** Verify an `Authorization: Bearer …` header and return its auth context. */
export async function verifyBearer(authorization?: string): Promise<AuthContext> {
  const cfg = oidcConfigFromEnv();
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';

  if (!cfg) {
    // Auth disabled for local/dev — everything runs as a single dev subject.
    return devSubjectContext(token);
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
