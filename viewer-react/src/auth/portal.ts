/**
 * CI-Portal SPA login — Authorization Code + PKCE (S256).
 *
 * CI-Portal is better-auth `oidcProvider`; the browser flow mirrors the Hub RP
 * (CI-Hub `packages/backend/src/modules/auth/portal-sso.ts`) but public + in the
 * browser. Endpoints hang off the issuer (`<portal-origin>/api/auth`):
 * `${issuer}/oauth2/authorize`, `${issuer}/oauth2/token`. Public PKCE client —
 * no secret. The access token is a JWT the Atlas API verifies (server/src/auth.ts).
 *
 * NOT WIRED — and deliberately so, not by oversight. Nothing in viewer-react
 * calls these functions: there is no `/auth/callback` handling at boot, no
 * sign-in control in the shell, and no consumer for the token if one were
 * obtained. The viewer authenticates to Companion Memory by ambient CI-Server
 * session cookie (`credentials: 'include'` in `memory/client.ts`) or an explicit
 * `?token=<jwt>` / `VITE_MEMORY_TOKEN`; `story/useStory.ts` reads that param and
 * knows nothing about OIDC.
 *
 * Three things block wiring it, and none of them is the code below:
 *   1. `companion-atlas` is not registered in CI-Portal `PUBLIC_CLIENTS` — that
 *      is a PR against another repo. (Local/`.ts.net`/`.local` redirect URIs are
 *      auto-allowed, so dev alone would need no Portal record.)
 *   2. `.env.default` ships `VITE_OIDC_ISSUER` and `VITE_OIDC_REDIRECT_URI`
 *      empty, so `portalConfigFromEnv()` returns null in every configuration
 *      checked into this repo — a sign-in control would render disabled or not
 *      at all until an operator fills those in.
 *   3. `VITE_ATLAS_API` has no reader anywhere in viewer-react, so a completed
 *      login would not change what the viewer can fetch. Wiring sign-in is
 *      worth doing only together with an Atlas-API client that sends the bearer.
 *
 * Kept rather than deleted because the flow itself is correct and the hard part
 * (PKCE S256, state validation, single-use verifier) is done; see
 * `docs/architecture.md` §8, which states this gap rather than implying the
 * `VITE_OIDC_*` variables are live configuration.
 */

export interface PortalAuthConfig {
  /** Issuer, e.g. `https://hub.ci.localhost/api/auth`. */
  issuer: string;
  /** Our client id — `companion-atlas`. */
  clientId: string;
  /** Redirect URI registered/auto-allowed for this client. */
  redirectUri: string;
  /** OAuth scopes; defaults to `openid profile email`. */
  scope?: string;
}

export interface TokenSet {
  access_token: string;
  token_type: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

const PKCE_KEY = 'atlas.pkce.verifier';
const STATE_KEY = 'atlas.pkce.state';

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

/** Redirect the browser to Portal's authorize endpoint (starts the PKCE flow). */
export async function beginLogin(cfg: PortalAuthConfig): Promise<void> {
  const verifier = randomToken();
  const state = randomToken();
  sessionStorage.setItem(PKCE_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const url = new URL(`${cfg.issuer.replace(/\/$/, '')}/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', cfg.scope ?? 'openid profile email');
  url.searchParams.set('code_challenge', await s256(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  window.location.assign(url.toString());
}

/** Handle the redirect back: validate `state`, exchange `code` for tokens. */
export async function completeLogin(cfg: PortalAuthConfig, currentUrl: string = window.location.href): Promise<TokenSet> {
  const params = new URL(currentUrl).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  if (!code) throw new Error('Portal login: missing authorization code');
  if (!state || state !== sessionStorage.getItem(STATE_KEY)) throw new Error('Portal login: state mismatch');
  const verifier = sessionStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error('Portal login: missing PKCE verifier');

  const res = await fetch(`${cfg.issuer.replace(/\/$/, '')}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  sessionStorage.removeItem(PKCE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (!res.ok) throw new Error(`Portal login: token exchange failed (${res.status})`);
  return (await res.json()) as TokenSet;
}

/** Read SPA OIDC config from Vite env (`VITE_OIDC_*`), or null if unset. */
export function portalConfigFromEnv(env: Record<string, string | undefined>): PortalAuthConfig | null {
  const issuer = env.VITE_OIDC_ISSUER;
  const clientId = env.VITE_OIDC_CLIENT_ID;
  const redirectUri = env.VITE_OIDC_REDIRECT_URI;
  if (!issuer || !clientId || !redirectUri) return null;
  return { issuer, clientId, redirectUri };
}
