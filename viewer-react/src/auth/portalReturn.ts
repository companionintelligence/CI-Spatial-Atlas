/**
 * Companion sign-on from the viewer, through the Portal (OIDC, PKCE).
 *
 * The same account signs in to the Hub, to Companion Memory and to this viewer.
 * The Portal flow runs only when the build sets VITE_OIDC_ISSUER,
 * VITE_OIDC_CLIENT_ID and VITE_OIDC_REDIRECT_URI, and the Portal must list this
 * client (docs/DISCOVERY.md, "Sign-on"). Without them the email and password form
 * stays the only sign-in, as before.
 */
import { beginLogin, completeLogin, portalConfigFromEnv, type TokenSet } from './portal.js';
import { storeMemoryToken } from '../memory/auth.js';

/** Where the token belongs when the browser comes back from the Portal. */
const RETURN_KEY = 'atlas.oidc.memory';

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** True when this build can start a Portal sign-in. */
export function portalSignInAvailable(env: Record<string, string | undefined>): boolean {
  return portalConfigFromEnv(env) !== null;
}

/**
 * Send the browser to the Portal. The Memory URL is kept so the token can be filed
 * under it when the browser comes back.
 */
export async function startPortalSignIn(env: Record<string, string | undefined>, memoryUrl: string): Promise<void> {
  const cfg = portalConfigFromEnv(env);
  if (!cfg) throw new Error('Companion sign-in is not set up for this build.');
  session()?.setItem(RETURN_KEY, memoryUrl);
  await beginLogin(cfg);
}

/** Remove the OAuth parameters from the address bar without a reload. */
function stripOAuthParams(href: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('iss');
  window.history.replaceState(window.history.state, '', url.toString());
}

/** The return being finished. StrictMode runs an effect twice, so the second call shares the first's result. */
let finishing: { href: string; done: Promise<string | null> } | null = null;

/**
 * Finish a Portal sign-in that started on this page. Returns the Memory URL the
 * token was filed under, or null when this load is not a return from the Portal.
 * A refused sign-in and a failed exchange both throw, after the OAuth parameters
 * are removed from the URL, so the Portal's own reason reaches the load screen.
 *
 * The second call for the same return must wait for the first exchange rather than
 * race it. The verifier is single-use, so a read that found nothing would send the
 * Memory request out without the token, and React StrictMode makes exactly that call.
 */
export function finishPortalSignIn(
  env: Record<string, string | undefined>,
  href: string = typeof window === 'undefined' ? '' : window.location.href,
): Promise<string | null> {
  if (!href) return Promise.resolve(null);
  if (finishing?.href !== href) finishing = { href, done: completeReturn(env, href) };
  return finishing.done;
}

async function completeReturn(env: Record<string, string | undefined>, href: string): Promise<string | null> {
  // A refusal comes back as `error` with `state` and no `code` (RFC 6749 §4.1.2.1).
  const url = new URL(href);
  const isReturn = url.searchParams.has('state') && (url.searchParams.has('code') || url.searchParams.has('error'));
  if (!isReturn) return null;

  const cfg = portalConfigFromEnv(env);
  const store = session();
  const memoryUrl = store?.getItem(RETURN_KEY) ?? null;
  store?.removeItem(RETURN_KEY);

  let tokens: TokenSet | null = null;
  try {
    if (cfg && memoryUrl) tokens = await completeLogin(cfg, href);
  } finally {
    stripOAuthParams(href);
  }
  if (!tokens || !memoryUrl) return null;

  storeMemoryToken(memoryUrl, tokens.access_token);
  return memoryUrl;
}
