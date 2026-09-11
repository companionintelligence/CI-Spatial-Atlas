/**
 * CI-Portal SPA login — Authorization Code + PKCE (S256).
 *
 * CI-Portal is better-auth `oidcProvider`; the browser flow mirrors the Hub RP
 * (CI-Hub `packages/backend/src/modules/auth/portal-sso.ts`) but public + in the
 * browser. Endpoints hang off the issuer (`<portal-origin>/api/auth`):
 * `${issuer}/oauth2/authorize`, `${issuer}/oauth2/token`. Public PKCE client —
 * no secret. The access token is a JWT the Atlas API verifies (server/src/auth.ts).
 *
 * NOT WIRED — and deliberately so, not by oversight. Nothing in the app calls
 * these functions (only `test/portal-auth.test.ts` imports them, so none of this
 * reaches the bundle): there is no `/auth/callback` handling at boot, no
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
 *
 * Because it is unwired, nothing exercises it by accident — so the failure paths
 * that the first caller will actually hit are covered by `test/portal-auth.test.ts`
 * instead. Dead code that is subtly wrong is worse than dead code: it looks
 * finished, so whoever wires it debugs the wrong subsystem.
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

/**
 * Turn an OAuth error payload — query params on the callback (RFC 6749 §4.1.2.1)
 * or the JSON body of a failed token request (§5.2) — into one readable line.
 *
 * Both places carry the same three fields, and the one that actually names the
 * problem is `error_description`; `error` alone is a small closed vocabulary
 * (`invalid_client`, `unauthorized_client`, `invalid_grant`, …) that says which
 * *kind* of thing went wrong but not which client, redirect URI or code.
 *
 * Every field here is remote text that ends up in a thrown message and, sooner
 * or later, on screen — so each is clipped. A server (or, on the callback, an
 * attacker who got as far as a valid `state`) does not get to hand the UI an
 * unbounded string.
 */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function oauthErrorText(src: { error?: string | null; description?: string | null; uri?: string | null }): string {
  const parts = [clip(src.error || 'error', 64)];
  if (src.description) parts.push(clip(src.description, 200));
  if (src.uri) parts.push(`see ${clip(src.uri, 200)}`);
  return parts.join(' — ');
}

/**
 * Handle the redirect back: validate `state`, exchange `code` for tokens.
 *
 * Two failure-path properties this function is responsible for, both of which
 * it used to get wrong:
 *
 * 1. **The authorization server's own error must survive.** When Portal refuses
 *    the request it redirects back with `?error=…&error_description=…` and NO
 *    `code` (RFC 6749 §4.1.2.1). Reading `code` first and reporting "missing
 *    authorization code" therefore renders every server-side refusal as a
 *    client-side bug and throws away the only text that says what happened.
 *    That is not hypothetical here: the blocker documented at the top of this
 *    file — `companion-atlas` not being in CI-Portal's `PUBLIC_CLIENTS` — comes
 *    back as `error=invalid_client`/`unauthorized_client`, so the first person
 *    to wire this up is exactly the person the old message misdirected. The
 *    token endpoint has the same shape: a 400 with a `{error, error_description}`
 *    body (§5.2) distinguishing "wrong verifier" from "unknown client" from
 *    "code already redeemed", all of which a bare status code flattens to 400.
 *
 *    `state` is still validated before the error is reported, so the message a
 *    user sees is one the real authorization server sent; see the comment at
 *    the check itself.
 *
 * 2. **The verifier and state are single-use, on every path.** They are the
 *    proof that this callback belongs to the authorize request this tab started;
 *    leaving them in `sessionStorage` after a failure lets a second, attacker-
 *    supplied callback into the same tab be validated against them. So both keys
 *    are consumed up front — read once, deleted immediately, then validated —
 *    which also covers the case the old ordering missed entirely: a `fetch()`
 *    that rejects (offline, DNS, CORS) never reached the `removeItem` calls at
 *    all, so a network blip left a live verifier behind.
 *
 * Consuming the keys up front means this function genuinely cannot be called
 * twice for one callback: a second call finds no verifier and throws. Callers
 * must invoke it once per redirect (guard the effect with a ref rather than
 * relying on React StrictMode's double-invoke being harmless).
 */
export async function completeLogin(cfg: PortalAuthConfig, currentUrl: string = window.location.href): Promise<TokenSet> {
  const params = new URL(currentUrl).searchParams;

  // Consume the one-shot values before any throw can skip the cleanup.
  const verifier = sessionStorage.getItem(PKCE_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  sessionStorage.removeItem(STATE_KEY);

  const authError = params.get('error');
  const code = params.get('code');
  const state = params.get('state');

  // `state` is checked first — before both `error` and `code` — because it is
  // the only thing that says this callback came from the request we started.
  // An error response echoes `state` too (RFC 6749 §4.1.2.1), so a genuine
  // refusal still gets past this and is reported below; what does not get past
  // is a hand-crafted `?error=…&error_description=<whatever the attacker wants
  // the user to read>` pasted into a tab that has a login in flight.
  if (!state || !expectedState || state !== expectedState) {
    throw new Error('Portal login: state mismatch');
  }

  // The server's refusal is checked BEFORE `code`, because a refusal is
  // *defined* by the absence of `code`.
  if (authError) {
    throw new Error(`Portal login: authorization failed — ${oauthErrorText({
      error: authError,
      description: params.get('error_description'),
      uri: params.get('error_uri'),
    })}`);
  }

  if (!code) throw new Error('Portal login: missing authorization code');
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
  if (!res.ok) {
    // Read the body defensively: a proxy or gateway between us and Portal can
    // answer with HTML or nothing at all, and a parse failure here would mask
    // the status code, which is the one fact we always have.
    let detail = '';
    try {
      const body = await res.text();
      const parsed = body ? (JSON.parse(body) as { error?: string; error_description?: string; error_uri?: string }) : null;
      if (parsed?.error) {
        detail = ` — ${oauthErrorText({ error: parsed.error, description: parsed.error_description, uri: parsed.error_uri })}`;
      } else if (body.trim()) {
        detail = ` — ${body.trim().slice(0, 200)}`;
      }
    } catch {
      /* non-JSON or unreadable body: the status alone still names the failure */
    }
    throw new Error(`Portal login: token exchange failed (${res.status})${detail}`);
  }
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
