/**
 * CI-Portal SPA login — the failure paths.
 *
 * `src/auth/portal.ts` has no caller (see its header and docs/architecture.md
 * §8), so nothing else in the suite touches it. That is exactly why it needs
 * tests: an unwired module gets no accidental exercise, and the two defects
 * covered here — every OAuth refusal reported as "missing authorization code",
 * and a PKCE verifier that outlived the failed callback that consumed it —
 * were both invisible for as long as no one called the function.
 *
 * The happy path is deliberately thin: it is the part that was already right.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeLogin } from '../src/auth/portal.js';

const CFG = {
  issuer: 'https://hub.ci.localhost/api/auth',
  clientId: 'companion-atlas',
  redirectUri: 'http://localhost:4174/auth/callback',
};

// Node has no sessionStorage; the module only uses get/set/removeItem.
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

let store: Map<string, string>;
const primed = () => {
  store.set('atlas.pkce.verifier', 'verifier-abc');
  store.set('atlas.pkce.state', 'state-xyz');
};

beforeEach(() => {
  store = installSessionStorage();
  primed();
});
afterEach(() => vi.unstubAllGlobals());

describe('completeLogin — authorization-endpoint errors', () => {
  it('reports the server\'s error instead of "missing authorization code"', async () => {
    // RFC 6749 §4.1.2.1: a refusal comes back with `error` and NO `code`. This
    // is the shape Portal answers with while `companion-atlas` is absent from
    // its PUBLIC_CLIENTS — the blocker portal.ts's own header documents.
    const url = `${CFG.redirectUri}?error=unauthorized_client&error_description=Client%20is%20not%20registered&state=state-xyz`;
    // One call, three assertions: the verifier is single-use, so calling again
    // to re-assert would hit "state mismatch" instead of the error under test.
    const err = await completeLogin(CFG, url).catch((e: Error) => e);
    expect(String(err)).toMatch(/unauthorized_client/);
    expect(String(err)).toMatch(/Client is not registered/);
    // The misdirecting message must be gone, not merely accompanied.
    expect(String(err)).not.toMatch(/missing authorization code/);
  });

  it('refuses to echo an error whose state does not validate', async () => {
    // `error_description` is remote text that ends up on screen. A callback
    // pasted into a tab with a login in flight must not get to choose it, so
    // state is checked before the error is reported.
    const forged = `${CFG.redirectUri}?error=invalid_client&error_description=Call%20support%20on%20555-0100&state=forged`;
    const err = await completeLogin(CFG, forged).catch((e: Error) => e);
    expect(String(err)).toMatch(/state mismatch/);
    expect(String(err)).not.toMatch(/555-0100/);
  });

  it('clips an over-long error_description rather than passing it through', async () => {
    const long = 'x'.repeat(5000);
    const err = await completeLogin(CFG, `${CFG.redirectUri}?error=server_error&error_description=${long}&state=state-xyz`)
      .catch((e: Error) => e);
    expect(String(err).length).toBeLessThan(400);
    expect(String(err)).toMatch(/server_error/);
  });

  it('still says "missing authorization code" when the callback carries neither code nor error', async () => {
    // A truncated/hand-typed callback is a genuinely different failure and keeps
    // its own message — the fix must not turn every empty callback into "OAuth error".
    await expect(completeLogin(CFG, `${CFG.redirectUri}?state=state-xyz`))
      .rejects.toThrow(/missing authorization code/);
  });
});

describe('completeLogin — the verifier and state are single-use', () => {
  it('clears both when the callback is an error redirect', async () => {
    await expect(completeLogin(CFG, `${CFG.redirectUri}?error=access_denied&state=state-xyz`)).rejects.toThrow();
    // Left behind, they would validate a second callback that this tab never
    // started — the replay the state parameter exists to prevent.
    expect(store.has('atlas.pkce.verifier')).toBe(false);
    expect(store.has('atlas.pkce.state')).toBe(false);
  });

  it('clears both when state does not match', async () => {
    await expect(completeLogin(CFG, `${CFG.redirectUri}?code=c1&state=attacker`)).rejects.toThrow(/state mismatch/);
    expect(store.size).toBe(0);
  });

  it('clears both when the token request itself rejects', async () => {
    // The old ordering deleted the keys only after `await fetch(...)` resolved,
    // so an offline/DNS/CORS rejection skipped the cleanup entirely.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    await expect(completeLogin(CFG, `${CFG.redirectUri}?code=c1&state=state-xyz`)).rejects.toThrow(/network down/);
    expect(store.size).toBe(0);
  });

  it('refuses a replayed callback rather than re-sending the verifier', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 't', token_type: 'Bearer' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const url = `${CFG.redirectUri}?code=c1&state=state-xyz`;
    await expect(completeLogin(CFG, url)).resolves.toMatchObject({ access_token: 't' });
    await expect(completeLogin(CFG, url)).rejects.toThrow(/state mismatch|missing PKCE verifier/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('completeLogin — token-endpoint errors', () => {
  it('includes the RFC 6749 §5.2 error body, not just the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'invalid_grant', error_description: 'code_verifier does not match' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )));
    const err = await completeLogin(CFG, `${CFG.redirectUri}?code=c1&state=state-xyz`).catch((e: Error) => e);
    // 400 alone cannot tell a bad verifier from an unknown client from a
    // second redemption of the same code; all three land here.
    expect(String(err)).toMatch(/400/);
    expect(String(err)).toMatch(/invalid_grant/);
    expect(String(err)).toMatch(/code_verifier does not match/);
  });

  it('survives a non-JSON error body from a proxy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })));
    const err = await completeLogin(CFG, `${CFG.redirectUri}?code=c1&state=state-xyz`).catch((e: Error) => e);
    // The status is the one fact always available; a parse failure must not eat it.
    expect(String(err)).toMatch(/token exchange failed \(502\)/);
  });
});

describe('completeLogin — success', () => {
  it('posts the PKCE verifier and returns the token set', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'jwt', token_type: 'Bearer', expires_in: 3600 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const tokens = await completeLogin(CFG, `${CFG.redirectUri}?code=c1&state=state-xyz`);
    expect(tokens.access_token).toBe('jwt');
    const body = new URLSearchParams(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.get('code_verifier')).toBe('verifier-abc');
    expect(body.get('grant_type')).toBe('authorization_code');
  });
});
