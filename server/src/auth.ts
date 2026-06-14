/**
 * Companion OIDC authentication.
 *
 * Atlas is a relying party of the Companion Intelligence OIDC provider. Both
 * the REST API and the Streamable-HTTP MCP transport authenticate bearer
 * tokens issued by that provider; the verified `subject` scopes every story to
 * its owner (replacing the current ad-hoc `account-name` field in the viewer).
 *
 * Configure via env (.env.default):
 *   COMPANION_OIDC_ISSUER, COMPANION_OIDC_AUDIENCE,
 *   COMPANION_OIDC_CLIENT_ID, COMPANION_OIDC_CLIENT_SECRET
 *
 * Production verifies the JWT signature against the issuer JWKS (via
 * `openid-client` / `jose`). This stub decodes claims without verifying so the
 * scaffold runs locally; DO NOT ship it as-is.
 */

export interface AuthContext {
  subject: string;
  scopes: string[];
  token: string;
}

export const ANONYMOUS: AuthContext = { subject: 'anonymous', scopes: [], token: '' };

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Verify a bearer token and return its auth context.
 *
 * TODO: replace decode-only with real JWKS signature + issuer/audience checks:
 *   const config = await discovery(new URL(issuer), clientId, clientSecret)
 *   const { payload } = await jwtVerify(token, remoteJWKS, { issuer, audience })
 */
export async function verifyBearer(authorization?: string): Promise<AuthContext> {
  const issuer = process.env.COMPANION_OIDC_ISSUER ?? '';
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';

  if (!issuer) {
    // Auth disabled for local/dev — everything runs as a single dev subject.
    return { subject: process.env.ATLAS_DEV_SUBJECT ?? 'dev-operator', scopes: ['*'], token };
  }
  if (!token) return ANONYMOUS;

  const claims = decodeJwtClaims(token);
  if (!claims || typeof claims.sub !== 'string') return ANONYMOUS;

  const scopes = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
  return { subject: claims.sub, scopes, token };
}

/** True when the story is readable by the given auth context. */
export function canRead(visibility: string | undefined, owner: string | undefined, ctx: AuthContext): boolean {
  if (visibility === 'public' || visibility === 'unlisted') return true;
  return owner === ctx.subject || ctx.scopes.includes('*');
}
