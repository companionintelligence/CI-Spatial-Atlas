import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isMemoryAuthError, signInToMemory, storedMemoryToken } from '../src/memory/auth.js';

function storage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', storage());
  vi.restoreAllMocks();
});

describe('viewer Memory authentication', () => {
  it('scopes a stored access token to the selected Memory connection', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'fresh-token' }), { status: 200 }));

    await signInToMemory({ memoryUrl: '/memory', email: 'test@example.com', password: 'correct-password' });

    expect(storedMemoryToken('/memory')).toBe('fresh-token');
    expect(storedMemoryToken('/other-memory')).toBeUndefined();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/memory/authenticate/csrf', '/memory/authenticate']);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      credentials: 'include',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }),
    });
  });

  it('derives auth routes from a full GraphQL URL', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'fresh-token' }), { status: 200 }));

    await signInToMemory({
      memoryUrl: 'https://memory.example/graphql',
      email: 'test@example.com',
      password: 'correct-password',
    });

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      'https://memory.example/authenticate/csrf',
      'https://memory.example/authenticate',
    ]);
  });

  it('turns a 401 login response into safe, actionable copy', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 }));

    await expect(
      signInToMemory({ memoryUrl: '/memory', email: 'test@example.com', password: 'wrong-password' }),
    ).rejects.toThrow('Invalid email or password.');
  });

  it('recognises authentication failures without classifying ordinary errors as auth', () => {
    expect(isMemoryAuthError('Companion Memory returned HTTP 401')).toBe(true);
    expect(isMemoryAuthError('Unauthorized')).toBe(true);
    expect(isMemoryAuthError('Couldn’t reach Companion Memory')).toBe(false);
  });
});
