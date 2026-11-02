/**
 * Browser sign-in for a connected Companion Memory.
 *
 * The CI-Server GraphQL API accepts an access-token bearer (or an API key),
 * not the refresh/session cookie used by its main web app. Keep the short-lived
 * access token in sessionStorage, scoped to the selected Memory URL, so Atlas
 * can authenticate a same-origin dev proxy without putting a credential in the
 * address bar or in a shareable story URL.
 *
 * In the native shell the address and token also go to the Keychain, so the
 * connection survives a relaunch. Launch copies them back into sessionStorage,
 * so every reader keeps using the same lookup.
 */

import { isNativeShell, readSecret, removeSecret, writeSecret } from './nativeKeychain.js';

const SESSION_KEY = 'atlas.memory.auth';
const KEYCHAIN_URL = 'atlas.memory.url';
const KEYCHAIN_TOKEN = 'atlas.memory.token';
/** The longest a launch waits for the Keychain before it opens the demo instead. */
const RESTORE_TIMEOUT_MS = 3000;

/** The Memory the native shell reconnected to at launch. */
let restoredMemoryUrl: string | undefined;

interface StoredMemoryAuth {
  memoryUrl: string;
  accessToken: string;
}

function normalizeMemoryUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function authBase(url: string): string {
  const normalized = normalizeMemoryUrl(url);
  return normalized.endsWith('/graphql') ? normalized.slice(0, -'/graphql'.length) : normalized;
}

function readStoredAuth(): StoredMemoryAuth | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredMemoryAuth>;

    if (typeof parsed.memoryUrl !== 'string' || typeof parsed.accessToken !== 'string' || !parsed.accessToken) {
      return null;
    }

    return parsed as StoredMemoryAuth;
  } catch {
    return null;
  }
}

/** Return a token only when it belongs to this exact Memory connection. */
export function storedMemoryToken(memoryUrl: string): string | undefined {
  const stored = readStoredAuth();

  return stored?.memoryUrl === normalizeMemoryUrl(memoryUrl) ? stored.accessToken : undefined;
}

export function storeMemoryToken(memoryUrl: string, accessToken: string): void {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ memoryUrl: normalizeMemoryUrl(memoryUrl), accessToken } satisfies StoredMemoryAuth),
    );
  } catch {
    // A private browsing policy may deny sessionStorage. The current login still
    // succeeds, but the next reload will ask the user to sign in again.
  }
}

/** Forget this tab's Companion Memory sign-in. */
export function clearMemoryToken(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage is blocked, so there is no token here to forget.
  }
}

async function responseMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    const message = body?.message ?? body?.error;

    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  } catch {
    /* keep the local fallback */
  }

  return fallback;
}

export interface MemoryLoginInput {
  memoryUrl: string;
  email: string;
  password: string;
}

/** Sign in to CI-Server, retain the access token for this browser tab, and return it. */
export async function signInToMemory({ memoryUrl, email, password }: MemoryLoginInput): Promise<string> {
  const base = authBase(memoryUrl);
  let csrf: Response;

  try {
    csrf = await fetch(`${base}/authenticate/csrf`, {
      method: 'GET',
      credentials: 'include',
    });
  } catch {
    throw new Error(`Couldn’t reach Companion Memory at ${base}. Check that the server is running.`);
  }

  if (!csrf.ok) {
    throw new Error(await responseMessage(csrf, `Couldn’t prepare sign-in (${csrf.status}).`));
  }

  let csrfBody: { csrfToken?: string };

  try {
    csrfBody = (await csrf.json()) as { csrfToken?: string };
  } catch {
    throw new Error('Companion Memory returned an invalid sign-in response.');
  }

  if (!csrfBody.csrfToken) {
    throw new Error('Companion Memory did not return a sign-in token.');
  }

  let login: Response;

  try {
    login = await fetch(`${base}/authenticate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-CSRF-Token': csrfBody.csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify({ username: email, password }),
    });
  } catch {
    throw new Error(`Couldn’t reach Companion Memory at ${base}. Check that the server is running.`);
  }

  if (!login.ok) {
    const message = await responseMessage(login, `Sign-in failed (${login.status}).`);
    throw new Error(login.status === 401 ? 'Invalid email or password.' : message);
  }

  let body: { accessToken?: string };

  try {
    body = (await login.json()) as { accessToken?: string };
  } catch {
    throw new Error('Companion Memory returned an invalid sign-in response.');
  }

  if (!body.accessToken) {
    throw new Error('Companion Memory did not return a session.');
  }

  storeMemoryToken(memoryUrl, body.accessToken);
  await persistNativeConnection(memoryUrl, body.accessToken);

  return body.accessToken;
}

export interface MemoryDeleteInput {
  memoryUrl: string;
  /** The token from this person's sign-in, passed in so storage is not needed. */
  accessToken: string;
  confirmEmail: string;
}

/**
 * Delete the signed-in Companion Memory account: `DELETE /account`, the route
 * behind Settings > Account on the web. The account ends at once and its data is
 * purged after the server's grace period. The email is typed again, not the
 * password, so every sign-in method can delete.
 */
export async function deleteMemoryAccount({ memoryUrl, accessToken, confirmEmail }: MemoryDeleteInput): Promise<void> {
  const base = authBase(memoryUrl);
  let res: Response;

  try {
    res = await fetch(`${base}/account`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ confirmEmail }),
    });
  } catch {
    throw new Error(`Couldn’t reach Companion Memory at ${base}. Check that the server is running.`);
  }

  if (res.status === 401) {
    clearMemoryToken();
    throw new Error('Your sign-in has expired. Sign in again, then delete the account.');
  }

  if (!res.ok) {
    throw new Error(await responseMessage(res, `Couldn’t delete the account (${res.status}).`));
  }

  // 204: the account has ended, so this tab must not keep its token.
  clearMemoryToken();
  await forgetMemoryConnection();
}

/** True when a load failure is an authentication problem with the live source. */
export function isMemoryAuthError(error: string | null): boolean {
  return /\b(?:401|403)\b|unauthori[sz]ed|sign in/i.test(error ?? '');
}

/** The Memory the native shell reconnected to at launch, if it has one. */
export function nativeMemoryUrl(): string | undefined {
  return restoredMemoryUrl;
}

/**
 * Reconnect the native shell to the Memory it last signed in to. main.tsx awaits
 * this before the first render, so the viewer starts on the saved connection rather
 * than the bundled demo. The token goes back into sessionStorage, where
 * storedMemoryToken already looks.
 */
export async function restoreNativeMemoryConnection(): Promise<void> {
  if (!isNativeShell()) return;

  const fallback: [null, null] = [null, null];
  const [memoryUrl, accessToken] = await withTimeout<[string | null, string | null]>(
    Promise.all([readSecret(KEYCHAIN_URL), readSecret(KEYCHAIN_TOKEN)]),
    fallback,
    RESTORE_TIMEOUT_MS,
  );

  if (!memoryUrl || !accessToken) return;

  restoredMemoryUrl = memoryUrl;
  storeMemoryToken(memoryUrl, accessToken);
}

/** Disconnect: forget the saved address and token, here and in the Keychain. */
export async function forgetMemoryConnection(): Promise<void> {
  restoredMemoryUrl = undefined;

  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear when sessionStorage is unavailable.
  }

  if (!isNativeShell()) return;
  await removeSecret(KEYCHAIN_URL);
  await removeSecret(KEYCHAIN_TOKEN);
}

/** Why a typed server address cannot be used, or null when it can. */
export function connectionUrlError(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'Enter the address of your Companion Memory server.';

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'Start the address with https://, for example https://memory.example.com.';
  }

  if (url.protocol !== 'https:') return 'Use an https:// address. The app only connects over HTTPS.';
  if (url.username || url.password || url.search || url.hash) {
    return 'Enter the server address alone, without a token or query string.';
  }
  return null;
}

async function persistNativeConnection(memoryUrl: string, accessToken: string): Promise<void> {
  if (!isNativeShell()) return;
  await writeSecret(KEYCHAIN_URL, normalizeMemoryUrl(memoryUrl));
  await writeSecret(KEYCHAIN_TOKEN, accessToken);
}

/** Race a Keychain read against a timer, so a stuck plugin cannot hold the boot screen. */
function withTimeout<T>(work: Promise<T>, fallback: T, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
