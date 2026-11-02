/**
 * Companion Hub discovery (docs/DISCOVERY.md): which service URLs the viewer will
 * call, what it reads from the Hub's resource document, and how a failed discovery
 * falls back to the build's own configuration.
 */
import { describe, expect, it } from 'vitest';
import {
  companionHubFromEnv,
  discoverCompanionResources,
  parseCompanionResources,
  RESOURCES_PATH,
  safeServiceUrl,
} from '../src/discovery/companion.js';

describe('safeServiceUrl', () => {
  it('accepts https, dropping a trailing slash and any fragment', () => {
    expect(safeServiceUrl('https://memory.example.com/')).toBe('https://memory.example.com');
    expect(safeServiceUrl('https://memory.example.com/api/#x')).toBe('https://memory.example.com/api');
  });

  it('accepts plain http only for a local development host', () => {
    expect(safeServiceUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(safeServiceUrl('http://127.0.0.1:3030')).toBe('http://127.0.0.1:3030');
    expect(safeServiceUrl('http://[::1]:3030')).toBe('http://[::1]:3030');
    expect(safeServiceUrl('http://ci-server.localhost')).toBe('http://ci-server.localhost');
    expect(safeServiceUrl('http://hub.test')).toBe('http://hub.test');
  });

  it('refuses plain http to any other host', () => {
    expect(safeServiceUrl('http://memory.example.com')).toBeNull();
    expect(safeServiceUrl('http://localhost.example.com')).toBeNull();
  });

  it('refuses other schemes, embedded credentials, non-URLs and over-long values', () => {
    expect(safeServiceUrl('ftp://memory.example.com')).toBeNull();
    expect(safeServiceUrl('javascript:alert(1)')).toBeNull();
    expect(safeServiceUrl('https://user:pass@memory.example.com')).toBeNull();
    expect(safeServiceUrl('https://user@memory.example.com')).toBeNull();
    expect(safeServiceUrl('not a url')).toBeNull();
    expect(safeServiceUrl(`https://memory.example.com/${'a'.repeat(2048)}`)).toBeNull();
  });

  it('refuses empty and non-string values', () => {
    expect(safeServiceUrl('')).toBeNull();
    expect(safeServiceUrl('   ')).toBeNull();
    expect(safeServiceUrl(42)).toBeNull();
    expect(safeServiceUrl(undefined)).toBeNull();
  });
});

describe('companionHubFromEnv', () => {
  it('reads VITE_COMPANION_HUB_URL, and is off when it is unset or unsafe', () => {
    expect(companionHubFromEnv({})).toBeNull();
    expect(companionHubFromEnv({ VITE_COMPANION_HUB_URL: '' })).toBeNull();
    expect(companionHubFromEnv({ VITE_COMPANION_HUB_URL: 'http://hub.example.com' })).toBeNull();
    expect(companionHubFromEnv({ VITE_COMPANION_HUB_URL: 'https://hub.example.com/' })).toBe('https://hub.example.com');
  });
});

describe('parseCompanionResources', () => {
  it('keeps the memory and llm entries it understands', () => {
    expect(
      parseCompanionResources({
        memory: { url: 'https://memory.example.com/api/' },
        llm: { url: 'https://llm.example.com/v1', provider: 'anthropic', models: ['claude-haiku-5-5'] },
      }),
    ).toEqual({
      memory: { url: 'https://memory.example.com/api' },
      llm: { url: 'https://llm.example.com/v1', provider: 'anthropic', models: ['claude-haiku-5-5'] },
    });
  });

  it('drops fields it does not read, and entries whose URL is unsafe', () => {
    expect(
      parseCompanionResources({
        memory: { url: 'http://memory.example.com', token: 'not-used' },
        llm: { url: 'https://llm.example.com', apiKey: 'not-used' },
        other: true,
      }),
    ).toEqual({ llm: { url: 'https://llm.example.com' } });
  });

  it('caps the provider and model list', () => {
    const models = Array.from({ length: 25 }, (_, i) => `model-${i}`);
    const out = parseCompanionResources({ llm: { url: 'https://llm.example.com', provider: 'p'.repeat(100), models } });
    expect(out?.llm?.provider).toHaveLength(64);
    expect(out?.llm?.models).toHaveLength(20);
  });

  it('returns null when nothing usable is present', () => {
    expect(parseCompanionResources(null)).toBeNull();
    expect(parseCompanionResources([])).toBeNull();
    expect(parseCompanionResources('https://memory.example.com')).toBeNull();
    expect(parseCompanionResources({})).toBeNull();
    expect(parseCompanionResources({ memory: 'https://memory.example.com' })).toBeNull();
  });
});

describe('discoverCompanionResources', () => {
  // A stand-in for fetch: records each call and answers with what `respond` returns.
  function fakeFetch(respond: (init: RequestInit) => Promise<unknown>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fn = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(init);
    }) as unknown as typeof fetch;
    return { fn, calls };
  }

  const json = (body: unknown) => async () => ({ ok: true, json: async () => body });

  it('reads the resource document from the Hub, without credentials', async () => {
    const { fn, calls } = fakeFetch(json({ memory: { url: 'https://memory.example.com' } }));

    expect(await discoverCompanionResources('https://hub.example.com', fn)).toEqual({
      memory: { url: 'https://memory.example.com' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://hub.example.com${RESOURCES_PATH}`);
    expect(calls[0].init.credentials).toBe('omit');
  });

  it('returns null for a failed response, a network error, or a body that is not JSON', async () => {
    const notFound = fakeFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    expect(await discoverCompanionResources('https://hub.example.com', notFound.fn)).toBeNull();

    const down = fakeFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await discoverCompanionResources('https://hub.example.com', down.fn)).toBeNull();

    const html = fakeFetch(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    expect(await discoverCompanionResources('https://hub.example.com', html.fn)).toBeNull();
  });

  it('gives up when the Hub does not answer in time', async () => {
    const hangs = fakeFetch(
      (init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    expect(await discoverCompanionResources('https://hub.example.com', hangs.fn, 10)).toBeNull();
  });
});
