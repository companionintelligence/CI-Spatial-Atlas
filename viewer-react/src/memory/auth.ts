/**
 * Browser sign-in for a connected Companion Memory.
 *
 * The CI-Server GraphQL API accepts an access-token bearer (or an API key),
 * not the refresh/session cookie used by its main web app. Keep the short-lived
 * access token in sessionStorage, scoped to the selected Memory URL, so Atlas
 * can authenticate a same-origin dev proxy without putting a credential in the
 * address bar or in a shareable story URL.
 */

const SESSION_KEY = 'atlas.memory.auth';

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

function storeMemoryToken(memoryUrl: string, accessToken: string): void {
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

/** Sign in to CI-Server and retain the access token for this browser tab. */
export async function signInToMemory({ memoryUrl, email, password }: MemoryLoginInput): Promise<void> {
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
}

/** True when a load failure is an authentication problem with the live source. */
export function isMemoryAuthError(error: string | null): boolean {
  return /\b(?:401|403)\b|unauthori[sz]ed|sign in/i.test(error ?? '');
}
