/**
 * Companion OIDC authentication — CI-Portal relying party.
 *
 * Atlas verifies bearer tokens issued by CI-Portal (better-auth `oidcProvider`).
 * Portal signs access-token JWTs with **EdDSA** and publishes a JWKS at
 * `<portal-origin>/api/auth/jwks`; we verify with `jose.jwtVerify` against
 * `createRemoteJWKSet`, enforcing **signature**, **issuer**, **audience**,
 * **exp** and **nbf**. The verified `sub` scopes every story to its owner.
 *
 * Configure via env (.env.default):
 *   COMPANION_OIDC_ISSUER     Portal issuer, e.g. https://hub.ci.localhost/api/auth
 *                             (better-auth mounts OIDC under /api/auth, and the
 *                             token `iss` is `<portal-origin>/api/auth`)
 *   COMPANION_OIDC_JWKS_URI   optional; derived from the issuer otherwise
 *   COMPANION_OIDC_AUDIENCE   comma-separated allowed client ids (= our client id)
 *   ATLAS_DEV_SUBJECT         dev subject used when the issuer is unset
 *   ATLAS_ALLOW_INSECURE_AUTH escape hatch: run the dev bypass even in a
 *                             deployed environment. Never set this.
 *
 * ## The dev bypass, and why it cannot fire by accident
 *
 * Leaving `COMPANION_OIDC_ISSUER` empty disables auth entirely: every request
 * runs as one dev subject with `*` scope. That is deliberate — Mode A in
 * docs/INTEGRATION.md, so UI/renderer work needs no Portal — but it is also a
 * total authentication bypass, and a container that silently landed in it would
 * serve everyone's private stories to anyone. So `assertAuthStartup()` (called
 * from index.ts before `listen()`) makes the state impossible to reach
 * unnoticed: it **refuses to boot** with no issuer in a deployed environment
 * (`NODE_ENV=production`, which server/Dockerfile sets, or `ATLAS_ENV`/
 * `COMPANION_ENV` = prod/production/staging), and prints a loud banner every
 * time the bypass is genuinely active. `verifyBearer()` additionally warns once
 * per process, so an embedder that never calls `assertAuthStartup()` still gets
 * told.
 *
 * ## What this does NOT cover (residual gaps, stated honestly)
 *
 * - **An invalid token degrades to anonymous, it is not a 401.** A caller with a
 *   forged/expired token gets `ANONYMOUS`, so reads of private stories are
 *   correctly refused (403 via `canRead`) — but the *write* routes in api.ts do
 *   not require an authenticated subject, so such a caller can still create
 *   stories owned by `anonymous`. Making the mutating routes reject `ANONYMOUS`
 *   is a separate api.ts change.
 * - **MCP-over-HTTP (`POST /mcp` in index.ts) is not authenticated at all.** The
 *   preHandler hook populates `req.auth`, but mcp.ts never consults it — every
 *   MCP tool runs unscoped. Fixing that means threading an `AuthContext` through
 *   `AtlasDeps`/tool handlers.
 * - Scope claims are parsed but only `*` is honoured (see `canRead`); Portal's
 *   own scopes are not yet mapped onto Atlas operations.
 */
import { createHash } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';

export interface AuthContext {
  subject: string;
  scopes: string[];
  token: string;
  email?: string;
}

export const ANONYMOUS: AuthContext = { subject: 'anonymous', scopes: [], token: '' };

/**
 * Minimal logger shape. Structurally satisfied by both Fastify's `req.log`
 * (pino) and bare `console`, so callers pass whichever they have without this
 * module taking a dependency on either.
 */
export interface AuthLogger {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

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

/**
 * Signature algorithms we accept. Allowlisted rather than left open because a
 * JWKS is attacker-influenced input in the worst case: if it ever served a
 * symmetric (`oct`) key, an unrestricted verifier would happily accept an HS256
 * token forged with a *public* value as the HMAC secret (classic alg confusion).
 * Portal signs EdDSA; the rest are here so a Portal key rotation to ECDSA/RSA
 * doesn't require an Atlas release.
 */
const ALLOWED_ALGS = ['EdDSA', 'ES256', 'ES384', 'RS256', 'PS256'];

// One remote JWKS per endpoint (jose caches keys + honours cache headers, and
// refetches on an unknown `kid` behind its own cooldown — that is what makes
// Portal key rotation transparent to us, so never construct these per request).
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
    algorithms: ALLOWED_ALGS,
    // `exp`/`nbf` are enforced by jose whenever present; `requiredClaims` is what
    // stops a *non-expiring* token (no `exp` at all) from being accepted forever,
    // and stops a subject-less token from being read as the literal string
    // "undefined" further down. Clock tolerance is left at jose's default of 0:
    // Portal and Atlas run in the same NTP-synced cluster, and any slack here is
    // just extra minutes of life for a revoked token.
    requiredClaims: ['sub', 'exp'],
  });
  // Defensive: `requiredClaims` guarantees presence, this guarantees the type —
  // a numeric or object `sub` must never be coerced into someone's owner string.
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('token has no usable sub claim');
  const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
  return {
    subject: payload.sub,
    scopes,
    token,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}

/**
 * Why a token was rejected. Distinguishable **in the server log only** — every
 * one of these produces the exact same `ANONYMOUS` result for the caller, so a
 * probing client cannot tell "wrong signature" from "expired" from "wrong
 * audience" and use Atlas as an oracle for what a stolen token is missing.
 */
export type AuthFailureReason =
  | 'signature_invalid'
  | 'expired'
  | 'not_yet_valid'
  | 'audience_mismatch'
  | 'issuer_mismatch'
  | 'claim_invalid'
  | 'malformed_token'
  | 'jwks_unavailable'
  | 'unknown';

/**
 * Map a jose error onto a stable reason code. Matched on the `code` string
 * rather than `instanceof`, because jose ships dual CJS/ESM builds and a
 * duplicated copy in the graph would break `instanceof` silently — turning
 * every classification into 'unknown' exactly when the log matters most.
 */
export function classifyAuthFailure(err: unknown): AuthFailureReason {
  const e = err as { code?: unknown; claim?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const claim = typeof e?.claim === 'string' ? e.claim : '';
  switch (code) {
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return 'signature_invalid';
    case 'ERR_JWT_EXPIRED':
      return 'expired';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      if (claim === 'aud') return 'audience_mismatch';
      if (claim === 'iss') return 'issuer_mismatch';
      if (claim === 'nbf') return 'not_yet_valid';
      return 'claim_invalid';
    case 'ERR_JWS_INVALID':
    case 'ERR_JWT_INVALID':
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      return 'malformed_token';
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
    case 'ERR_JWKS_TIMEOUT':
    case 'ERR_JOSE_GENERIC':
      return 'jwks_unavailable';
    default:
      return 'unknown';
  }
}

/**
 * A short, non-reversible fingerprint of the rejected token. Lets an operator
 * correlate a burst of failures (one broken client vs. a spray of forgeries)
 * without the log line itself becoming a usable credential if the token later
 * turns out to have been valid-but-misrouted.
 */
function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

// The dev bypass is loud, but only once per process — a per-request warning on a
// busy dev server buries everything else in the log, and people stop reading it.
let devBypassWarned = false;

function isDeployedEnv(env: NodeJS.ProcessEnv): boolean {
  const markers = [env.NODE_ENV, env.ATLAS_ENV, env.COMPANION_ENV].map((v) => v?.trim().toLowerCase());
  return markers.some((m) => m === 'production' || m === 'prod' || m === 'staging');
}

function insecureAuthAllowed(env: NodeJS.ProcessEnv): boolean {
  const v = env.ATLAS_ALLOW_INSECURE_AUTH?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export interface AuthStartupReport {
  mode: 'oidc' | 'insecure-dev';
  issuer?: string;
  jwksUri?: string;
  audience?: string[];
  subject?: string;
}

/**
 * Startup gate: decide the auth mode, say so loudly, and refuse to run the
 * bypass where it would be a breach rather than a convenience.
 *
 * Called from index.ts before `listen()`. **Throws** when there is no issuer in
 * a deployed environment — a deployment that forgot to inject
 * `COMPANION_OIDC_ISSUER` must fail closed and crash-loop visibly, not come up
 * happily serving every private story to unauthenticated callers. The
 * `ATLAS_ALLOW_INSECURE_AUTH` escape hatch exists only so an operator who
 * genuinely wants that (a throwaway demo box) has to say it out loud in env.
 */
export function assertAuthStartup(
  env: NodeJS.ProcessEnv = process.env,
  log: AuthLogger = console,
): AuthStartupReport {
  const cfg = oidcConfigFromEnv(env);
  if (cfg) {
    // Not a warning — but routed through `warn` so it survives a production log
    // level that drops `info`. Knowing which issuer a box trusts is worth a line.
    log.warn(
      { mode: 'oidc', issuer: cfg.issuer, jwksUri: cfg.jwksUri, audience: cfg.audience },
      'auth: verifying Companion OIDC bearer tokens (signature + iss + aud + exp/nbf)',
    );
    return { mode: 'oidc', issuer: cfg.issuer, jwksUri: cfg.jwksUri, audience: cfg.audience };
  }

  const subject = env.ATLAS_DEV_SUBJECT ?? 'dev-operator';
  if (isDeployedEnv(env) && !insecureAuthAllowed(env)) {
    const message =
      'auth: refusing to start — COMPANION_OIDC_ISSUER is unset in a deployed environment ' +
      `(NODE_ENV=${env.NODE_ENV ?? '<unset>'}). Without it every request would run as ` +
      `"${subject}" with * scope, exposing every private story. Set COMPANION_OIDC_ISSUER ` +
      '(e.g. https://hub.ci.computer/api/auth), or set ATLAS_ALLOW_INSECURE_AUTH=1 if you ' +
      'really intend an unauthenticated box.';
    log.error({ mode: 'insecure-dev', subject }, message);
    throw new Error(message);
  }

  devBypassWarned = true; // the banner below is the once-per-process warning
  log.warn(
    { mode: 'insecure-dev', subject, overridden: insecureAuthAllowed(env) },
    '*** AUTH DISABLED *** COMPANION_OIDC_ISSUER is unset: every request runs as ' +
      `"${subject}" with * scope and NO token is checked. Intended for local development ` +
      'only (docs/INTEGRATION.md Mode A). Never expose this process to a network you do ' +
      'not control.',
  );
  return { mode: 'insecure-dev', subject };
}

/** Verify an `Authorization: Bearer …` header and return its auth context. */
export async function verifyBearer(authorization?: string, log: AuthLogger = console): Promise<AuthContext> {
  const cfg = oidcConfigFromEnv();
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';

  if (!cfg) {
    // Auth disabled for local/dev — everything runs as a single dev subject.
    // `assertAuthStartup()` has normally already banner-warned and, in a deployed
    // environment, refused to boot at all. This second warning is for embedders
    // (tests, scripts, anything calling `buildApi` directly) that skip that gate.
    if (!devBypassWarned && process.env.NODE_ENV !== 'test') {
      devBypassWarned = true;
      log.warn(
        { mode: 'insecure-dev' },
        '*** AUTH DISABLED *** COMPANION_OIDC_ISSUER is unset; serving every request as the dev subject',
      );
    }
    return { subject: process.env.ATLAS_DEV_SUBJECT ?? 'dev-operator', scopes: ['*'], token };
  }
  if (!token) return ANONYMOUS;

  try {
    return await verifyToken(token, cfg, remoteJwks(cfg.jwksUri));
  } catch (err) {
    // Log *why* server-side; hand the caller an undifferentiated anonymous
    // context so it learns nothing about which check failed. Deliberately not
    // logging any claim from the token: the payload is unverified attacker input
    // at this point, and putting it in the log is how log-injection starts.
    const reason = classifyAuthFailure(err);
    log.warn(
      { reason, issuer: cfg.issuer, token: tokenFingerprint(token) },
      `auth: bearer token rejected (${reason})`,
    );
    return ANONYMOUS;
  }
}

/** True when the story is readable by the given auth context. */
export function canRead(visibility: string | undefined, owner: string | undefined, ctx: AuthContext): boolean {
  if (visibility === 'public' || visibility === 'unlisted') return true;
  return owner === ctx.subject || ctx.scopes.includes('*');
}
