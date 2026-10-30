/**
 * The service worker (public/sw.js) and its registration (src/pwa/registerServiceWorker.ts).
 *
 * The worker is plain JavaScript that a browser runs outside the page, so these tests load
 * its source into a function with a fake Cache Storage, a fake fetch and a fake `self`, and
 * dispatch the events a browser would. There is no DOM in this workspace's test environment
 * on purpose, which suits this: nothing here needs one.
 *
 * What is pinned is what the worker must NOT do as much as what it does: it must not
 * intercept the Cesium runtime, the Memory server, the API or the stories, and it must not
 * write to a cache after install, because a cached copy of any of those is how an installed
 * app ends up on a stale build or holds a bearer token.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, SERVICE_WORKER_URL, type PwaWindow } from '../src/pwa/registerServiceWorker.js';

const ORIGIN = 'https://atlas.ci.computer';
const SW_SOURCE = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');

// ---- registration (src/pwa/registerServiceWorker.ts) --------------------------

interface WindowOptions {
  readyState?: string;
  /** `null` is a browser with no service workers (plain http, old WebViews). */
  serviceWorker?: { register: ReturnType<typeof vi.fn> } | null;
  capacitor?: { isNativePlatform?: () => boolean };
  /** True when this page is inside someone else's <iframe>. */
  embedded?: boolean;
}

function fakeWindow({
  readyState = 'complete',
  serviceWorker = { register: vi.fn(() => Promise.resolve()) },
  capacitor,
  embedded = false,
}: WindowOptions = {}) {
  const win = {
    navigator: serviceWorker ? { serviceWorker } : {},
    document: { readyState },
    Capacitor: capacitor,
    addEventListener: vi.fn((type: string, handler: () => void) => {
      if (type === 'load') handler();
    }),
    self: undefined as unknown,
    top: undefined as unknown,
  };
  win.self = win;
  win.top = embedded ? {} : win;
  return win;
}

const asWindow = (win: ReturnType<typeof fakeWindow>) => win as unknown as PwaWindow;

describe('registerServiceWorker', () => {
  it('registers /sw.js with the whole origin as its scope', () => {
    const win = fakeWindow();
    expect(registerServiceWorker({ production: true, win: asWindow(win) })).toBe(true);
    expect(win.navigator.serviceWorker!.register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { scope: '/' });
    expect(SERVICE_WORKER_URL).toBe('/sw.js');
  });

  it('waits for the page to load, so the worker never competes with the globe’s first render', () => {
    const win = fakeWindow({ readyState: 'loading' });
    win.addEventListener.mockImplementation(() => {}); // the load event has not fired yet
    registerServiceWorker({ production: true, win: asWindow(win) });
    expect(win.navigator.serviceWorker!.register).not.toHaveBeenCalled();

    const [type, handler, options] = win.addEventListener.mock.calls[0] as unknown as [string, () => void, unknown];
    expect(type).toBe('load');
    expect(options).toEqual({ once: true });
    handler();
    expect(win.navigator.serviceWorker!.register).toHaveBeenCalledTimes(1);
  });

  it('does nothing outside a production build (the default under the test runner)', () => {
    const win = fakeWindow();
    expect(registerServiceWorker({ win: asWindow(win) })).toBe(false);
    expect(registerServiceWorker({ production: false, win: asWindow(win) })).toBe(false);
    expect(win.navigator.serviceWorker!.register).not.toHaveBeenCalled();
  });

  it('does nothing where the browser has no service workers (plain http, old WebViews)', () => {
    const win = fakeWindow({ serviceWorker: null });
    expect(registerServiceWorker({ production: true, win: asWindow(win) })).toBe(false);
  });

  it('does nothing inside the Capacitor iOS and Android shells, which load this bundle from the app', () => {
    const win = fakeWindow({ capacitor: { isNativePlatform: () => true } });
    expect(registerServiceWorker({ production: true, win: asWindow(win) })).toBe(false);
    expect(win.navigator.serviceWorker!.register).not.toHaveBeenCalled();
  });

  it('still registers in a browser that happens to define window.Capacitor', () => {
    const win = fakeWindow({ capacitor: { isNativePlatform: () => false } });
    expect(registerServiceWorker({ production: true, win: asWindow(win) })).toBe(true);
  });

  it('does nothing when the viewer is embedded in another page', () => {
    const win = fakeWindow({ embedded: true });
    expect(registerServiceWorker({ production: true, win: asWindow(win) })).toBe(false);
    expect(win.navigator.serviceWorker!.register).not.toHaveBeenCalled();
  });

  it('logs a failed registration and does not throw, because the viewer works without the worker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const win = fakeWindow({ serviceWorker: { register: vi.fn(() => Promise.reject(new Error('blocked'))) } });
    registerServiceWorker({ production: true, win: asWindow(win) });
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// ---- the worker (public/sw.js), run against fakes -----------------------------

/** A fetch Request as the worker sees it: relative URLs resolve against the worker's origin. */
class FakeRequest {
  url: string;
  method = 'GET';
  mode = 'cors';
  cache: string;
  constructor(input: string, init: { cache?: string } = {}) {
    this.url = new URL(input, ORIGIN).href;
    this.cache = init.cache ?? 'default';
  }
}

/** The path a cache entry is keyed by: the tests only ever store one entry per path. */
const keyOf = (input: string | { url: string }) =>
  new URL(typeof input === 'string' ? input : input.url, ORIGIN).pathname;

interface FakeResponseLike {
  clone(): FakeResponseLike;
  [key: string]: unknown;
}

/**
 * Loads public/sw.js with a Cache Storage and a fetch that are fakes, and returns the
 * listeners it registered. `writes` records every write to any cache, so a test can
 * assert what the worker stored and when.
 */
function loadWorker({ network = {}, offline = false }: { network?: Record<string, string | number | undefined>; offline?: boolean } = {}) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const stores = new Map<string, Map<string, Response | FakeResponseLike>>();
  const writes: { cache: string; path: string; via: string; mode?: string }[] = [];

  const fetchFake = vi.fn(async (request: { url: string }) => {
    if (offline) throw new TypeError('Failed to fetch');
    const body = network[keyOf(request)];
    if (body === undefined) return new Response('not found', { status: 404 });
    return typeof body === 'number' ? new Response('server said no', { status: body }) : new Response(body, { status: 200 });
  });

  const storeFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };

  const caches = {
    open: async (name: string) => {
      const store = storeFor(name);
      return {
        addAll: async (requests: FakeRequest[]) => {
          for (const request of requests) {
            const response = await fetchFake(request);
            if (!response.ok) throw new TypeError(`addAll: ${request.url} answered ${response.status}`);
            writes.push({ cache: name, path: keyOf(request), via: 'addAll', mode: request.cache });
            store.set(keyOf(request), response);
          }
        },
        put: async (request: { url: string }, response: Response) => {
          writes.push({ cache: name, path: keyOf(request), via: 'put' });
          store.set(keyOf(request), response);
        },
        add: async (request: { url: string }) => {
          writes.push({ cache: name, path: keyOf(request), via: 'add' });
        },
      };
    },
    match: async (input: string | { url: string }) => {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(input));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };

  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers[type] = handler;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(() => Promise.resolve()) },
  };

  new Function('self', 'caches', 'fetch', 'Request', SW_SOURCE)(self, caches, fetchFake, FakeRequest);

  /** Dispatch a lifecycle event and wait for everything it handed to waitUntil. */
  const lifecycle = async (type: 'install' | 'activate') => {
    const pending: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  };

  /** Dispatch a fetch; resolves to the response the worker supplied, or null if it left the request alone. */
  const dispatch = async (
    path: string,
    { method = 'GET', mode = 'cors', origin = ORIGIN }: { method?: string; mode?: string; origin?: string } = {}
  ): Promise<Response | null> => {
    const request = { url: new URL(path, origin).href, method, mode };
    let supplied: Promise<Response> | null = null;
    handlers.fetch({ request, respondWith: (promise: Promise<Response>) => (supplied = promise) });
    return supplied ? await supplied : null;
  };

  return { self, stores, writes, fetch: fetchFake, lifecycle, dispatch, storeFor };
}

const SITE = {
  '/offline/': '<h1>Companion Atlas is offline</h1>',
  '/offline/offline.css': 'body{}',
  '/offline/mark.svg': '<svg/>',
  '/': '<div id="root"></div>',
  '/stories/sample-pacific-journey.json': '{}',
};

const PRECACHED = ['/offline/', '/offline/offline.css', '/offline/mark.svg'];

describe('public/sw.js: lifecycle', () => {
  it('precaches the offline page, its stylesheet and the mark, straight from the network, and takes over at once', async () => {
    const worker = loadWorker({ network: SITE });
    await worker.lifecycle('install');

    expect(worker.writes.map((w) => w.path)).toEqual(PRECACHED);
    expect(worker.writes.every((w) => w.mode === 'reload')).toBe(true);
    expect(worker.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('fails the install, rather than half-installing, when a precached file cannot be fetched', async () => {
    const worker = loadWorker({ network: { ...SITE, '/offline/offline.css': undefined } });
    await expect(worker.lifecycle('install')).rejects.toThrow(/offline\.css/);
  });

  it('on activation deletes its own older caches, leaves every other cache alone, and claims open pages', async () => {
    const worker = loadWorker({ network: SITE });
    await worker.lifecycle('install');
    worker.storeFor('ci-atlas-offline-v0');
    worker.storeFor('some-other-apps-cache');

    await worker.lifecycle('activate');

    expect([...worker.stores.keys()].sort()).toEqual(['ci-atlas-offline-v1', 'some-other-apps-cache']);
    expect(worker.self.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe('public/sw.js: page loads', () => {
  it('is network first: an online page load is the network answer, and is not stored', async () => {
    const worker = loadWorker({ network: SITE });
    await worker.lifecycle('install');
    const before = worker.writes.length;

    const response = await worker.dispatch('/', { mode: 'navigate' });

    expect(await response!.text()).toBe(SITE['/']);
    expect(worker.writes).toHaveLength(before);
  });

  it('shows a server error as the server sent it, not as the offline page', async () => {
    const worker = loadWorker({ network: { ...SITE, '/broken': 503 } });
    await worker.lifecycle('install');

    const response = await worker.dispatch('/broken', { mode: 'navigate' });
    expect(response!.status).toBe(503);
  });

  it('answers a page load with no network with the offline page, whatever the query string carries', async () => {
    const worker = loadWorker({ network: SITE });
    await worker.lifecycle('install');
    worker.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    for (const path of ['/', '/?story=/stories/x.json', '/?memory=https://memory.example&token=secret', '/somewhere/deep']) {
      const response = await worker.dispatch(path, { mode: 'navigate' });
      expect(response!.status).toBe(200);
      expect(await response!.text()).toBe(SITE['/offline/']);
    }
  });

  it('falls back to the browser error page, not an exception, if the offline page was evicted', async () => {
    const worker = loadWorker({ offline: true });
    const response = await worker.dispatch('/', { mode: 'navigate' });
    expect(response!.type).toBe('error');
  });

  it('never hands a navigation a redirected response, which the browser refuses', async () => {
    const worker = loadWorker({ offline: true });
    worker.storeFor('ci-atlas-offline-v1').set('/offline/', {
      redirected: true,
      body: 'offline page',
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/html' }),
      clone() {
        return this;
      },
    });

    const response = await worker.dispatch('/', { mode: 'navigate' });
    expect(response!.redirected).toBe(false);
    expect(await response!.text()).toBe('offline page');
  });
});

describe('public/sw.js: everything else is left to the browser', () => {
  it('serves the files the offline page needs from the cache, and from the network if they are not there', async () => {
    const worker = loadWorker({ network: SITE });
    await worker.lifecycle('install');
    worker.fetch.mockClear();

    for (const path of ['/offline/offline.css', '/offline/mark.svg'] as const) {
      const response = await worker.dispatch(path);
      expect(await response!.text()).toBe(SITE[path]);
    }
    expect(worker.fetch).not.toHaveBeenCalled();

    worker.stores.clear();
    const response = await worker.dispatch('/offline/offline.css');
    expect(await response!.text()).toBe(SITE['/offline/offline.css']);
    expect(worker.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the app bundle', '/assets/index-CpwKQI41.js'],
    ['the Cesium runtime script that index.html loads', '/cesium/Cesium.js'],
    ['Cesium’s web workers', '/cesium/Workers/createVerticesFromQuantizedTerrainMesh.js'],
    ['Cesium’s bundled assets', '/cesium/Assets/approximateTerrainHeights.json'],
    ['Cesium’s widget stylesheet', '/cesium/Widgets/widgets.css'],
    ['the bundled sample story', '/stories/sample-pacific-journey.json'],
    ['a same-origin Memory proxy call', '/memory/graphql'],
    ['an Atlas API call', '/api/stories?token=secret'],
    ['the health check', '/healthz'],
    ['the web manifest', '/manifest.webmanifest'],
    ['an app icon', '/icons/icon-192.png'],
    ['a font', '/assets/manrope-latin-400-normal-PaqtzbVb.woff2'],
  ])('does not intercept %s', async (_label, path) => {
    const worker = loadWorker({ network: SITE });
    await worker.lifecycle('install');

    expect(await worker.dispatch(path)).toBeNull();
  });

  it.each([
    ['a Companion Memory server', 'https://memory.example.com'],
    ['the Portal sign-in', 'https://portal.ci.computer'],
    ['Cesium ion', 'https://api.cesium.com'],
    ['a map tile server', 'https://tile.openstreetmap.org'],
  ])('does not intercept requests to %s on another origin', async (_label, origin) => {
    const worker = loadWorker({ network: SITE });
    await worker.lifecycle('install');

    expect(await worker.dispatch('/graphql', { origin })).toBeNull();
    expect(await worker.dispatch('/offline/', { origin })).toBeNull();
    expect(await worker.dispatch('/', { origin, mode: 'navigate' })).toBeNull();
  });

  it('does not intercept anything that is not a GET', async () => {
    const worker = loadWorker({ network: SITE });
    await worker.lifecycle('install');

    expect(await worker.dispatch('/', { method: 'POST', mode: 'navigate' })).toBeNull();
    expect(await worker.dispatch('/memory/graphql', { method: 'POST' })).toBeNull();
    expect(await worker.dispatch('/offline/offline.css', { method: 'POST' })).toBeNull();
  });

  it('writes to a cache only while installing, whatever the page loads afterwards', async () => {
    const worker = loadWorker({ network: SITE });
    await worker.lifecycle('install');
    await worker.lifecycle('activate');
    const afterInstall = worker.writes.length;

    const navigations = ['/', '/?token=abc123', '/?memory=https://memory.example&token=secret'];
    for (const path of navigations) await worker.dispatch(path, { mode: 'navigate' });
    for (const path of ['/assets/index-CpwKQI41.js', '/cesium/Cesium.js', '/memory/graphql', '/api/stories', '/stories/sample-pacific-journey.json']) {
      await worker.dispatch(path);
    }
    await worker.dispatch('/offline/offline.css');
    await worker.dispatch('/graphql', { origin: 'https://memory.example.com' });

    expect(worker.writes).toHaveLength(afterInstall);
    expect(worker.writes.every((w) => w.via === 'addAll')).toBe(true);
  });
});
