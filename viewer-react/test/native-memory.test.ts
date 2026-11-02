/**
 * The native shell keeps the Memory connection in the Keychain. These tests drive
 * that path with an in-memory stand-in for the bridge, so no device is needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectionUrlError,
  forgetMemoryConnection,
  nativeMemoryUrl,
  restoreNativeMemoryConnection,
  signInToMemory,
  storedMemoryToken,
} from '../src/memory/auth.js';

const MEMORY = 'https://memory.example.com';

/** The auth module reads sessionStorage at call time, so a plain stand-in is enough. */
class MemorySessionStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

/** Install the bridge with a Keychain stand-in, and return the values it holds. */
function installShell(values = new Map<string, string>()): Map<string, string> {
  (globalThis as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      SecureStoragePlugin: {
        async get({ key }: { key: string }) {
          const value = values.get(key);
          if (value === undefined) throw new Error('Item with given key does not exist');
          return { value };
        },
        async set({ key, value }: { key: string; value: string }) {
          values.set(key, value);
          return { value: true };
        },
        async remove({ key }: { key: string }) {
          values.delete(key);
          return { value: true };
        },
      },
    },
  };
  return values;
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', new MemorySessionStorage());
});

afterEach(async () => {
  await forgetMemoryConnection();
  delete (globalThis as unknown as { Capacitor?: unknown }).Capacitor;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('connectionUrlError', () => {
  it('accepts an https server address', () => {
    expect(connectionUrlError(' https://memory.example.com/ ')).toBeNull();
  });

  it('refuses plain http, which the shell will not connect over', () => {
    expect(connectionUrlError('http://memory.example.com')).toMatch(/https/);
  });

  it('asks for a scheme when one is missing', () => {
    expect(connectionUrlError('memory.example.com')).toMatch(/Start the address with https/);
  });

  it('refuses an empty address', () => {
    expect(connectionUrlError('   ')).toMatch(/Enter the address/);
  });

  it('refuses a token or query string in the address', () => {
    expect(connectionUrlError('https://memory.example.com/?token=abc')).toMatch(/without a token/);
  });
});

describe('native Memory connection', () => {
  it('does nothing in a browser, which has no bridge', async () => {
    await restoreNativeMemoryConnection();

    expect(nativeMemoryUrl()).toBeUndefined();
    expect(storedMemoryToken(MEMORY)).toBeUndefined();
  });

  it('reconnects at launch from the Keychain', async () => {
    installShell(new Map([
      ['atlas.memory.url', MEMORY],
      ['atlas.memory.token', 'token-1'],
    ]));

    await restoreNativeMemoryConnection();

    expect(nativeMemoryUrl()).toBe(MEMORY);
    expect(storedMemoryToken(MEMORY)).toBe('token-1');
  });

  it('ignores a saved address that has no token', async () => {
    installShell(new Map([['atlas.memory.url', MEMORY]]));

    await restoreNativeMemoryConnection();

    expect(nativeMemoryUrl()).toBeUndefined();
  });

  it('stops waiting on a Keychain that never answers', async () => {
    vi.useFakeTimers();
    (globalThis as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        SecureStoragePlugin: {
          get: () => new Promise(() => {}),
          set: async () => ({ value: true }),
          remove: async () => ({ value: true }),
        },
      },
    };

    const restore = restoreNativeMemoryConnection();
    await vi.advanceTimersByTimeAsync(3000);
    await restore;

    expect(nativeMemoryUrl()).toBeUndefined();
  });

  it('saves a sign-in to the Keychain, but never the password', async () => {
    const values = installShell();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).endsWith('/authenticate/csrf')
        ? { csrfToken: 'csrf-1' }
        : { accessToken: 'token-2' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    await signInToMemory({ memoryUrl: `${MEMORY}/`, email: 'reader@example.com', password: 'not-stored' });

    expect(values.get('atlas.memory.url')).toBe(MEMORY);
    expect(values.get('atlas.memory.token')).toBe('token-2');
    expect([...values.values()].join(' ')).not.toContain('not-stored');
  });

  it('forgets the connection here and in the Keychain', async () => {
    const values = installShell(new Map([
      ['atlas.memory.url', MEMORY],
      ['atlas.memory.token', 'token-1'],
    ]));
    await restoreNativeMemoryConnection();

    await forgetMemoryConnection();

    expect(nativeMemoryUrl()).toBeUndefined();
    expect(storedMemoryToken(MEMORY)).toBeUndefined();
    expect(values.size).toBe(0);
  });
});
