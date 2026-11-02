/**
 * The Portal's code exchange, run on the Atlas server rather than in the viewer's page.
 *
 * The viewer sends back the code it was given, with the PKCE verifier it kept, and this
 * module redeems the code at the Portal. The page never calls the Portal's token endpoint,
 * so it needs no CORS grant there, and the Portal's answer comes back over the Atlas origin.
 *
 * This is the shape the other companion apps use. CI-Server redeems the code in its own
 * backend (`OidcController`, the `oauth2/token` call), and its native app redeems a
 * single-use code. Atlas is a public PKCE client, so the exchange carries no secret. The
 * verifier is the proof that this viewer started the sign-in.
 *
 * Two shared Node and Worker entry points call this function: `worker.ts` for the deployed
 * Worker, and `api.ts` for the local server.
 */

/** Atlas's client id at the Portal. A public PKCE client, so no secret is held anywhere. */
export const ATLAS_OIDC_CLIENT_ID = 'companion-atlas';

/** RFC 7636 §4.1: 43 to 128 characters from the unreserved set. */
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** Longest authorization code accepted. The Portal's codes are far shorter. */
const MAX_CODE_LENGTH = 512;

const PORTAL_TIMEOUT_MS = 10_000;

export interface TokenExchangeEnv {
  COMPANION_OIDC_ISSUER?: string;
  ATLAS_VIEWER_BASE_URL?: string;
}

export interface TokenExchangeResult {
  status: number;
  body: Record<string, unknown>;
}

export type PortalFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The viewer's own URL, which is the only `redirect_uri` the exchange accepts. The Portal
 * checks the same thing when it issued the code, so an exchange for any other URL could only
 * ever fail, and refusing it here keeps this endpoint from redeeming codes for anyone else.
 */
function viewerRedirectUri(env: TokenExchangeEnv): string | null {
  const base = env.ATLAS_VIEWER_BASE_URL?.trim().replace(/\/$/, '');

  return base ? `${base}/` : null;
}

interface ExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

function parseRequest(input: unknown, env: TokenExchangeEnv): ExchangeRequest | null {
  if (!input || typeof input !== 'object') return null;

  const { code, code_verifier: codeVerifier, redirect_uri: redirectUri } = input as Record<string, unknown>;
  const viewer = viewerRedirectUri(env);

  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) return null;
  if (typeof codeVerifier !== 'string' || !CODE_VERIFIER.test(codeVerifier)) return null;
  if (typeof redirectUri !== 'string' || viewer === null || redirectUri !== viewer) return null;

  return { code, codeVerifier, redirectUri };
}

/** The Portal's answer when it is a JSON object, and null for anything else (HTML from a proxy, for one). */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);

    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Redeem an authorization code at the Portal for the viewer that asked.
 *
 * The Portal's answer is passed through unchanged, so the viewer shows the Portal's own
 * OAuth error (`invalid_grant`, say) rather than a generic one. Only the failures Atlas
 * itself causes get a new body: a bad request, a missing issuer, a Portal that cannot be
 * reached, or a Portal that answers something that is not JSON.
 *
 * `fetchImpl` is a parameter so the rules can be tested without a network.
 */
export async function exchangeAuthorizationCode(
  input: unknown,
  env: TokenExchangeEnv,
  fetchImpl: PortalFetch = (url, init) => fetch(url, init),
): Promise<TokenExchangeResult> {
  const request = parseRequest(input, env);

  if (!request) {
    return {
      status: 400,
      body: {
        error: 'invalid_request',
        error_description: 'code, code_verifier and redirect_uri are required, and redirect_uri must be the viewer’s own URL',
      },
    };
  }

  const issuer = env.COMPANION_OIDC_ISSUER?.trim().replace(/\/$/, '');

  if (!issuer) return { status: 503, body: { error: 'portal_not_configured' } };

  let response: Response;

  try {
    response = await fetchImpl(`${issuer}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ATLAS_OIDC_CLIENT_ID,
        redirect_uri: request.redirectUri,
        code: request.code,
        code_verifier: request.codeVerifier,
      }),
      signal: AbortSignal.timeout(PORTAL_TIMEOUT_MS),
    });
  } catch {
    return { status: 502, body: { error: 'portal_unreachable' } };
  }

  const body = parseJsonObject(await response.text());

  if (!body) return { status: 502, body: { error: 'portal_bad_response' } };

  return { status: response.status, body };
}
