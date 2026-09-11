/**
 * "What is at this coordinate" — the half of geocoding the app did not have.
 *
 * A pin dropped on the globe knows where it is and nothing about where that is,
 * so the marker tool now asks. The three providers disagree about all of it:
 * the path, the parameter names, and even the JSON shape — Nominatim answers a
 * reverse lookup with a bare object where its search answers with an array,
 * which would otherwise fall straight through the shared parser and produce
 * nothing.
 *
 * A failed lookup is never an error here. A pin in the middle of the Atlantic
 * has no address, and neither does one placed while the geocoder is down; both
 * are `null`, and the panel shows the coordinates it already had.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reverseGeocode } from '../src/memory/geocode.js';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });

/** Capture the URL and answer with a canned body. */
const stub = (body: unknown, ok = true) => {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return { ok, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return calls;
};

const PHOTON = {
  features: [{
    geometry: { coordinates: [-21.9426, 64.1466] },
    properties: { name: 'Hallgrímskirkja', city: 'Reykjavík', country: 'Iceland' },
  }],
};
const NOMINATIM_ONE = {
  place_id: 1, lat: '64.1466', lon: '-21.9426',
  name: 'Hallgrímskirkja', display_name: 'Hallgrímskirkja, Reykjavík, Iceland',
};

describe('the request each provider actually wants', () => {
  it('asks Photon at /reverse with lat and lon', async () => {
    const calls = stub(PHOTON);
    await reverseGeocode(64.1466, -21.9426, { provider: 'photon' });
    const u = new URL(calls[0]!);
    expect(u.pathname).toMatch(/\/reverse$/);
    expect(u.searchParams.get('lat')).toBe('64.1466');
    expect(u.searchParams.get('lon')).toBe('-21.9426');
  });

  it('asks Nominatim for jsonv2, or it gets a shape the parser cannot read', async () => {
    const calls = stub(NOMINATIM_ONE);
    await reverseGeocode(64.1466, -21.9426, { provider: 'nominatim' });
    const u = new URL(calls[0]!);
    expect(u.pathname).toMatch(/\/reverse$/);
    expect(u.searchParams.get('format')).toBe('jsonv2');
  });

  it('asks Pelias in its own dialect — point.lat, not lat', async () => {
    const calls = stub({ features: [] });
    await reverseGeocode(64.1466, -21.9426, { provider: 'pelias' });
    const u = new URL(calls[0]!);
    expect(u.pathname).toMatch(/\/v1\/reverse$/);
    expect(u.searchParams.get('point.lat')).toBe('64.1466');
    expect(u.searchParams.get('lat')).toBeNull();
  });

  it('derives the reverse endpoint from a configured search endpoint', async () => {
    const calls = stub(PHOTON);
    await reverseGeocode(1, 2, { provider: 'photon', endpoint: 'https://photon.example.org/api' });
    expect(new URL(calls[0]!).toString()).toContain('https://photon.example.org/reverse');
  });
});

describe('reading the answer back', () => {
  it('parses a Photon feature into a place', async () => {
    stub(PHOTON);
    const place = await reverseGeocode(64.1466, -21.9426, { provider: 'photon' });
    expect(place?.name).toBe('Hallgrímskirkja');
    expect(place?.lat).toBeCloseTo(64.1466, 4);
  });

  it('handles Nominatim answering with one object rather than an array', async () => {
    // The shape difference between its search and its reverse. Unwrapped, this
    // returns nothing and a pin silently never learns its address.
    stub(NOMINATIM_ONE);
    const place = await reverseGeocode(64.1466, -21.9426, { provider: 'nominatim' });
    expect(place?.name).toBe('Hallgrímskirkja');
  });
});

describe('no address is an answer, not a failure', () => {
  it('returns null when the provider found nothing', async () => {
    stub({ features: [] });
    expect(await reverseGeocode(0, -30, { provider: 'photon' })).toBeNull();
  });

  it('returns null on a non-ok response rather than throwing', async () => {
    stub({}, false);
    expect(await reverseGeocode(1, 2, { provider: 'photon' })).toBeNull();
  });

  it('returns null when the network throws', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await reverseGeocode(1, 2, { provider: 'photon' })).toBeNull();
  });

  it('refuses an impossible coordinate without asking anyone', async () => {
    const calls = stub(PHOTON);
    expect(await reverseGeocode(91, 0, { provider: 'photon' })).toBeNull();
    expect(await reverseGeocode(0, NaN, { provider: 'photon' })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
