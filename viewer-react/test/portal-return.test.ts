/**
 * The Portal sign-in around the viewer (`auth/portalReturn.ts`): when the sign-in is
 * offered, what it refuses to start without, and what a return from the Portal leaves
 * behind. The PKCE exchange itself is pinned by `portal-auth.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishPortalSignIn, portalSignInAvailable, startPortalSignIn } from '../src/auth/portalReturn.js';
import { storedMemoryToken } from '../src/memory/auth.js';

const OIDC = {
  VITE_OIDC_ISSUER: 'https://hub.ci.localhost/api/auth',
  VITE_OIDC_CLIENT_ID: 'companion-atlas',
  VITE_OIDC_REDIRECT_URI: 'https://atlas.example/',
};

const MEMORY = 'https://memory.example.com';

// Node has no sessionStorage; the modules only use get/set/remove.
function installSessionStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
  return store;
}

/** The storage a tab holds once `startPortalSignIn` has sent it to the Portal. The keys match `portal.ts` and `portalReturn.ts`. */
function primeSignIn(store: Map<string, string>, memoryUrl: string | null = MEMORY): void {
  store.set('atlas.pkce.verifier', 'verifier-abc');
  store.set('atlas.pkce.state', 'state-xyz');
  if (memoryUrl) store.set('atlas.oidc.memory', memoryUrl);
}

/** The page the Portal redirects back to, carrying the state this tab started with. */
const returnTo = (query: string) => `https://atlas.example/?${query}&state=state-xyz`;

let store: Map<string, string>;

beforeEach(() => {
  store = installSessionStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'sessionStorage');
});

describe('portalSignInAvailable', () => {
  it('is on only when all three VITE_OIDC_* variables are set', () => {
    expect(portalSignInAvailable({})).toBe(false);
    expect(portalSignInAvailable({ ...OIDC, VITE_OIDC_REDIRECT_URI: '' })).toBe(false);
    expect(portalSignInAvailable(OIDC)).toBe(true);
  });
});

describe('startPortalSignIn', () => {
  it('refuses to start when the build has no Portal configuration', async () => {
    await expect(startPortalSignIn({}, MEMORY)).rejects.toThrow('Companion sign-in is not set up for this build.');
    expect(store.has('atlas.oidc.memory')).toBe(false);
  });
});

describe('finishPortalSignIn', () => {
  it('does nothing when the page is not a return from the Portal', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await finishPortalSignIn(OIDC, 'https://atlas.example/')).toBeNull();
    expect(await finishPortalSignIn(OIDC, 'https://atlas.example/?state=state-xyz')).toBeNull();
    expect(await finishPortalSignIn(OIDC, 'https://atlas.example/?code=code-0')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not exchange a code for a return this tab did not start', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await finishPortalSignIn(OIDC, returnTo('code=code-1'))).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exchanges the code and files the token under the Memory URL that started the sign-in', async () => {
    primeSignIn(store);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'token-123', token_type: 'Bearer' }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    expect(await finishPortalSignIn(OIDC, returnTo('code=code-2'))).toBe(MEMORY);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(storedMemoryToken(MEMORY)).toBe('token-123');
    expect(storedMemoryToken('https://other.example.com')).toBeUndefined();
    expect(store.has('atlas.oidc.memory')).toBe(false);
  });

  it('shares one exchange between two calls for the same return, as React StrictMode makes', async () => {
    primeSignIn(store);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'token-456', token_type: 'Bearer' }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const href = returnTo('code=code-3');
    const [first, second] = await Promise.all([finishPortalSignIn(OIDC, href), finishPortalSignIn(OIDC, href)]);

    expect(first).toBe(MEMORY);
    expect(second).toBe(MEMORY);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(storedMemoryToken(MEMORY)).toBe('token-456');
  });

  it('reports the Portal refusal in its own words, and keeps no token', async () => {
    primeSignIn(store);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      finishPortalSignIn(
        OIDC,
        'https://atlas.example/?error=invalid_client&error_description=Client%20is%20not%20registered&state=state-xyz',
      ),
    ).rejects.toThrow('authorization failed — invalid_client — Client is not registered');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storedMemoryToken(MEMORY)).toBeUndefined();
    expect(store.has('atlas.pkce.verifier')).toBe(false);
  });

  it('reports a failed token exchange with the server reason, and keeps no token', async () => {
    primeSignIn(store);
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'invalid_grant', error_description: 'Code already used' }),
    }));

    await expect(finishPortalSignIn(OIDC, returnTo('code=code-4'))).rejects.toThrow(
      'token exchange failed (400) — invalid_grant — Code already used',
    );
    expect(storedMemoryToken(MEMORY)).toBeUndefined();
    expect(store.has('atlas.pkce.verifier')).toBe(false);
  });
});
