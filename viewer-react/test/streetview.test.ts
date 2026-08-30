import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Street View lookup: billing, caching and dedupe.
 *
 * Most of what is asserted here is a request that must *not* happen. The Static
 * API bills per image and answers a location with no panorama with a grey
 * placeholder rather than an error, so "check metadata first" is both the cost
 * control and the only way to tell a real street from a stand-in. The cache and
 * the in-flight map are the same argument at a different scale: a personal
 * archive is dozens of memories at one venue, and the immersive peek plate
 * re-targets as the viewer looks around.
 *
 * The module holds its cache in module scope, so each test imports a fresh copy
 * (`vi.resetModules`) rather than reaching in to clear it.
 */

const META = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const IMAGE = '/maps/api/streetview?';

/**
 * A fresh copy of the module, with an empty cache.
 *
 * The API key comes from `import.meta.env`, which Vite freezes when it resolves
 * the config — neither `vi.stubEnv` nor writing to the test file's own
 * `import.meta.env` reaches the copy the source module sees. The suite supplies
 * a stand-in key from `vitest.config.ts` instead, before that resolution
 * happens, so every test here runs with the key configured.
 */
async function load() {
  vi.resetModules();
  return import('../src/memory/streetview.js');
}

/**
 * A stub Google. Records every URL asked for and answers metadata with `status`.
 * The answer is withheld until `open()` when `gated`, which is how the
 * concurrency tests observe two callers overlapping.
 */
function stubGoogle(status: string | null, { date, gated = false }: { date?: string; gated?: boolean } = {}) {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (!gated) release();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (status === null) throw new Error('network down');
      await gate;
      return { ok: true, json: async () => ({ status, date }) } as Response;
    }),
  );
  return { calls, open: () => release() };
}

const asked = (calls: string[], fragment: string) => calls.filter((c) => c.includes(fragment)).length;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('metadata gating', () => {
  it('never requests a picture when there is no panorama', async () => {
    const { calls } = stubGoogle('ZERO_RESULTS');
    const { fetchStreetView } = await load();

    expect(await fetchStreetView(34.0568, -117.7504)).toBeNull();

    // Exactly one call, and it is the free one.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.startsWith(META)).toBe(true);
    expect(asked(calls, IMAGE)).toBe(0);
  });

  it('returns a picture URL, at the size asked for, when there is one', async () => {
    const { calls } = stubGoogle('OK', { date: '2018-04' });
    const { fetchStreetView } = await load();

    const shot = await fetchStreetView(34.0568, -117.7504, { width: 640, height: 400 });

    expect(shot?.captured).toBe('2018-04');
    expect(shot?.url).toContain(IMAGE);
    expect(shot?.url).toContain('size=640x400');
    // Still only the metadata call: the picture is a URL handed to an <img>,
    // and is billed when the browser loads it, not here.
    expect(calls).toHaveLength(1);
  });

  it('reports itself available once a key is configured', async () => {
    stubGoogle('OK');
    const { streetViewAvailable } = await load();
    expect(streetViewAvailable()).toBe(true);
  });

  it('treats a metadata failure as no imagery rather than throwing', async () => {
    stubGoogle(null);
    const { fetchStreetView } = await load();

    await expect(fetchStreetView(34.0568, -117.7504)).resolves.toBeNull();
  });

  it('asks nothing for a memory with no usable coordinates', async () => {
    const { calls } = stubGoogle('OK');
    const { fetchStreetView } = await load();

    expect(await fetchStreetView(Number.NaN, -117.7504)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('cache key', () => {
  it('buckets coordinates within a cell into one lookup', async () => {
    const { calls } = stubGoogle('OK', { date: '2018-04' });
    const { fetchStreetView } = await load();

    // Four decimal places is ~11 m: the same building entrance, reached by
    // memories geocoded a few metres apart.
    const a = await fetchStreetView(34.05681, -117.75042);
    const b = await fetchStreetView(34.05684, -117.75038);

    expect(calls).toHaveLength(1);
    expect(b).toEqual(a);
  });

  it('keeps genuinely different places apart', async () => {
    const { calls } = stubGoogle('OK', { date: '2018-04' });
    const { fetchStreetView } = await load();

    await fetchStreetView(34.0568, -117.7504);
    await fetchStreetView(34.0578, -117.7504); // ~110 m up the street

    expect(calls).toHaveLength(2);
  });

  it('remembers that a place had no panorama, and stops asking', async () => {
    const { calls } = stubGoogle('ZERO_RESULTS');
    const { fetchStreetView } = await load();

    expect(await fetchStreetView(37.7749, -122.4194)).toBeNull();
    expect(await fetchStreetView(37.7749, -122.4194)).toBeNull();

    expect(calls).toHaveLength(1);
  });
});

describe('in-flight dedupe', () => {
  it('shares one request between concurrent callers at one place', async () => {
    const { calls, open } = stubGoogle('OK', { date: '2018-04', gated: true });
    const { fetchStreetView } = await load();

    // The desktop inspector and the immersive plate can want the same venue in
    // the same tick; without the in-flight map that is two metadata calls for
    // one place, and two textures built from the answer.
    const both = Promise.all([
      fetchStreetView(34.05681, -117.75042),
      fetchStreetView(34.05683, -117.75041),
    ]);
    expect(calls).toHaveLength(1);

    open();
    const [first, second] = await both;
    expect(first).toEqual(second);
    expect(calls).toHaveLength(1);
  });

  it('does not merge concurrent callers at different places', async () => {
    const { calls, open } = stubGoogle('OK', { gated: true });
    const { fetchStreetView } = await load();

    const both = Promise.all([
      fetchStreetView(34.0568, -117.7504),
      fetchStreetView(51.5074, -0.1278),
    ]);
    expect(calls).toHaveLength(2);

    open();
    await both;
    expect(calls).toHaveLength(2);
  });
});
