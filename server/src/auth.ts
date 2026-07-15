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
  const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
  return {
    subject: String(payload.sub),
    scopes,
    token,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}

/** Verify an `Authorization: Bearer …` header and return its auth context. */
export async function verifyBearer(authorization?: string): Promise<AuthContext> {
  const cfg = oidcConfigFromEnv();
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';

  if (!cfg) {
    // Auth disabled for local/dev — everything runs as a single dev subject.
    return { subject: process.env.ATLAS_DEV_SUBJECT ?? 'dev-operator', scopes: ['*'], token };
  }
  if (!token) return ANONYMOUS;

  try {
    return await verifyToken(token, cfg, remoteJwks(cfg.jwksUri));
  } catch {
    // Invalid signature, issuer, audience, or expiry → unauthenticated.
    return ANONYMOUS;
  }
}

/** True when the story is readable by the given auth context. */
export function canRead(visibility: string | undefined, owner: string | undefined, ctx: AuthContext): boolean {
  if (visibility === 'public' || visibility === 'unlisted') return true;
  return owner === ctx.subject || ctx.scopes.includes('*');
}
