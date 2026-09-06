import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Cesium from 'cesium';
import {
  BASEMAPS,
  DEFAULT_BASEMAP,
  OFFLINE_BASEMAP,
  buildBasemaps,
  gibsDailyTimes,
  gibsDefaultDate,
  resolveBasemap,
  s2cloudlessAttribution,
  s2cloudlessLicence,
  s2cloudlessYear,
  type Basemap,
} from '../src/renderers/basemaps.js';
import { createTerrain, openTerrainUrl, terrainCredit } from '../src/renderers/terrain.js';

/**
 * Basemap selection, and the licence obligations that come with the open tier.
 *
 * Two kinds of assertion live here. The first is the ordinary one: the picker
 * offers what the configuration can actually draw, and never nothing. The
 * second is a licence check — CC BY, ODbL and Esri's terms all make attribution
 * a *condition of use*, so an entry that can fetch tiles without carrying a
 * credit is not a cosmetic defect, it is a breach that ships silently. The
 * suite asserts the credit exists, that it names the right licence, and that
 * the EOX default is the CC BY year rather than one of the NonCommercial ones
 * that would be unusable in a CI-Commercial build.
 *
 * Nothing here reaches the network: every provider is constructed and then
 * inspected, which is all Cesium needs (a tile request happens when a globe
 * asks for one, and there is no globe in a unit test).
 */

const ids = (list: Basemap[]) => list.map((b) => b.id);

describe('picker composition', () => {
  it('offers the open tier with no configuration at all', () => {
    const open = buildBasemaps({});
    expect(ids(open)).toEqual([
      'natural',
      'imagery',
      'streets',
      'terrain',
      'dark',
      's2cloudless',
      'gibs',
      'osm',
    ]);
  });

  it('appends Mapbox only when a token is configured, without moving anything else', () => {
    const without = buildBasemaps({});
    const with_ = buildBasemaps({ VITE_MAPBOX_TOKEN: 'pk.test' });

    // The keyed entries land on the end: a deployment that drops its token
    // shortens the picker rather than reshuffling the entries people know the
    // position of.
    expect(ids(with_).slice(0, without.length)).toEqual(ids(without));
    expect(ids(with_).slice(without.length)).toEqual(['mapbox-satellite', 'mapbox-outdoors']);
  });

  it('treats a blank token as no token', () => {
    // An env var present but empty is the normal state of a `.env` copied from
    // `.env.example`; it must not put a basemap in the picker that 401s.
    expect(ids(buildBasemaps({ VITE_MAPBOX_TOKEN: '   ' }))).not.toContain('mapbox-satellite');
  });

  it('is what the module exports', () => {
    // BASEMAPS is buildBasemaps() over the frozen import.meta.env; the suite
    // runs with no Mapbox token, so it is the open+Esri set.
    expect(ids(BASEMAPS)).toContain('s2cloudless');
    expect(ids(BASEMAPS)).toContain(DEFAULT_BASEMAP);
    expect(ids(BASEMAPS)).toContain(OFFLINE_BASEMAP);
  });
});

describe('attribution is a condition of use, not a nicety', () => {
  it('carries a credit and a licence on every entry that fetches tiles', () => {
    for (const b of buildBasemaps({ VITE_MAPBOX_TOKEN: 'pk.test' })) {
      if (!b.create) continue;
      expect(b.attribution, `${b.id} has no attribution`).toBeTruthy();
      expect(b.licence, `${b.id} has no licence`).toBeTruthy();
    }
  });

  it('exempts only the offline entry, which fetches nothing', () => {
    const offline = buildBasemaps({}).filter((b) => !b.create);
    expect(ids(offline)).toEqual([OFFLINE_BASEMAP]);
  });

  it('puts the credit Cesium will render on the provider itself', () => {
    const osm = buildBasemaps({}).find((b) => b.id === 'osm')!;
    const provider = osm.create!();
    const html = provider.credit!.html;
    expect(html).toContain('OpenStreetMap');
    // ODbL attribution belongs on the map, not behind a "Data attribution"
    // disclosure — the OSMF guidelines are explicit about it.
    expect(provider.credit!.showOnScreen).toBe(true);
  });
});

describe('EOX Sentinel-2 cloudless licensing', () => {
  it('defaults to a CC BY year, not a NonCommercial one', () => {
    const s2 = buildBasemaps({}).find((b) => b.id === 's2cloudless')!;
    expect(s2.licence).toBe('CC-BY-4.0');
    expect(s2.attribution).toContain('CC BY 4.0');
    // CC BY 4.0 wants the creator, the source, and an indication that the
    // material was modified.
    expect(s2.attribution).toContain('EOX IT Services GmbH');
    expect(s2.attribution).toContain('modified Copernicus Sentinel data');
  });

  it('knows which years EOX relicensed as NonCommercial', () => {
    expect(s2cloudlessLicence('s2cloudless_3857')).toBe('CC-BY-4.0');
    expect(s2cloudlessLicence('s2cloudless-2017_3857')).toBe('CC-BY-4.0');
    for (const year of [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
      expect(s2cloudlessLicence(`s2cloudless-${year}_3857`)).toBe('CC-BY-NC-SA-4.0');
    }
  });

  it('says NonCommercial out loud when a deployment opts into a later year', () => {
    const s2 = buildBasemaps({ VITE_EOX_S2_LAYER: 's2cloudless-2024_3857' }).find(
      (b) => b.id === 's2cloudless',
    )!;
    expect(s2.licence).toBe('CC-BY-NC-SA-4.0');
    expect(s2.attribution).toContain('non-commercial');
    expect(s2.attribution).toContain('2024');
    expect(s2.hint).toContain('2024');
  });

  it('reads the year out of the layer name, defaulting to the 2016 mosaic', () => {
    expect(s2cloudlessYear('s2cloudless_3857')).toBe('2016');
    expect(s2cloudlessYear('s2cloudless')).toBe('2016');
    expect(s2cloudlessYear('s2cloudless-2021_3857')).toBe('2021');
    expect(s2cloudlessAttribution('s2cloudless-2021_3857')).toContain('2021');
  });
});

describe('self-hostable endpoints', () => {
  it('points at the deployment’s own tile servers when configured', () => {
    const list = buildBasemaps({
      VITE_EOX_TILE_URL: 'https://tiles.example.org/wmts/1.0.0/',
      VITE_OSM_TILE_URL: 'https://osm.example.org/{z}/{x}/{y}.png',
    });
    const s2 = list.find((b) => b.id === 's2cloudless')!.create!();
    const osm = list.find((b) => b.id === 'osm')!.create!();
    // Trailing slash trimmed, so the configured value can be pasted either way.
    expect((s2 as unknown as { url: string }).url).toBe(
      'https://tiles.example.org/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
    );
    expect((osm as unknown as { url: string }).url).toBe('https://osm.example.org/{z}/{x}/{y}.png');
  });

  it('keeps Sentinel-2 on the Web Mercator pyramid its tile matrix set uses', () => {
    // The bug this guards: UrlTemplateImageryProvider defaults to EPSG:4326,
    // whose {z}/{y}/{x} indices address tiles that do not exist in EOX's `g`
    // matrix set. Well-formed requests, blank globe, nothing logged.
    const s2 = buildBasemaps({}).find((b) => b.id === 's2cloudless')!.create!();
    expect(s2.tilingScheme).toBeInstanceOf(Cesium.WebMercatorTilingScheme);
    // 10 m of ground per Sentinel-2 pixel is z14; anything past it is upsample.
    expect((s2 as unknown as { maximumLevel?: number }).maximumLevel).toBe(14);
  });
});

describe('NASA GIBS date axis', () => {
  it('asks for a completed day, not today’s half-built mosaic', () => {
    // GIBS assembles the current UTC day as the satellite flies, so "today"
    // is an Earth with a ragged edge where the swaths stop.
    expect(gibsDefaultDate(new Date('2026-09-05T04:00:00Z'))).toBe('2026-09-03');
    expect(gibsDefaultDate(new Date('2026-01-01T00:30:00Z'))).toBe('2025-12-30');
  });

  it('puts the date in the tile URL, and 512px tiles in the LOD maths', () => {
    const gibs = buildBasemaps({ VITE_GIBS_DATE: '2024-07-04' }).find((b) => b.id === 'gibs')!;
    const provider = gibs.create!() as unknown as {
      url: string;
      dimensions: Record<string, string>;
      tileWidth: number;
      maximumLevel: number;
    };
    expect(provider.dimensions.Time).toBe('2024-07-04');
    expect(provider.url).toContain('{Time}');
    // 512, because the matrix set serves 512px tiles: saying 256 makes Cesium
    // refine a level too far and fetch four times the tiles it needs.
    expect(provider.tileWidth).toBe(512);
    expect(provider.maximumLevel).toBe(8);
  });

  it('takes an explicit date per call without rebuilding the list', () => {
    const gibs = BASEMAPS.find((b) => b.id === 'gibs')!;
    const provider = gibs.create!({ date: '2020-04-01' }) as unknown as {
      dimensions: Record<string, string>;
    };
    expect(provider.dimensions.Time).toBe('2020-04-01');
  });

  it('builds one clock interval per UTC day, inclusive of both ends', () => {
    const times = gibsDailyTimes(new Date('2024-03-01T18:00:00Z'), new Date('2024-03-04T02:00:00Z'));
    expect(times.length).toBe(4);
    expect((times.get(0)!.data as { Time: string }).Time).toBe('2024-03-01');
    expect((times.get(3)!.data as { Time: string }).Time).toBe('2024-03-04');
  });

  it('refuses to allocate a million intervals for a nonsense range', () => {
    const times = gibsDailyTimes(new Date('1900-01-01T00:00:00Z'), new Date('2400-01-01T00:00:00Z'));
    expect(times.length).toBeLessThanOrEqual(11001);
  });
});

describe('resolveBasemap — the globe is always pickable', () => {
  const list = buildBasemaps({});

  it('returns the requested entry when it exists', () => {
    expect(resolveBasemap('osm', list).id).toBe('osm');
  });

  it('falls back to the default for an id that is no longer offered', () => {
    // The real case: a persisted 'mapbox-satellite' choice comes back after the
    // deployment dropped VITE_MAPBOX_TOKEN. `find` answers undefined, the
    // viewer reads that as "no overlay", and the globe silently sits on the
    // two-level offline raster with nothing on screen to explain it.
    expect(resolveBasemap('mapbox-satellite', list).id).toBe(DEFAULT_BASEMAP);
    expect(resolveBasemap('nonsense', list).id).toBe(DEFAULT_BASEMAP);
    expect(resolveBasemap(undefined, list).id).toBe(DEFAULT_BASEMAP);
  });

  it('falls through to something drawable when even the default is gone', () => {
    const noDefault = list.filter((b) => b.id !== DEFAULT_BASEMAP);
    const chosen = resolveBasemap('nonsense', noDefault);
    expect(chosen.create).toBeTypeOf('function');
  });

  it('ends at the offline entry rather than at undefined', () => {
    const offlineOnly = list.filter((b) => !b.create);
    expect(resolveBasemap('nonsense', offlineOnly).id).toBe(OFFLINE_BASEMAP);
    // Even an empty list — which cannot happen, but the caller cannot check —
    // answers with something that has an id.
    expect(resolveBasemap('nonsense', []).id).toBe(OFFLINE_BASEMAP);
  });
});

describe('terrain selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the deployment’s tileset and credit out of the environment', () => {
    expect(openTerrainUrl({})).toBeUndefined();
    expect(openTerrainUrl({ VITE_TERRAIN_URL: '  ' })).toBeUndefined();
    expect(openTerrainUrl({ VITE_TERRAIN_URL: 'https://dem.example.org/copernicus' })).toBe(
      'https://dem.example.org/copernicus',
    );
    // Never defaulted: attributing someone else's DEM to the wrong people is
    // worse than showing no credit at all.
    expect(terrainCredit({})).toBeUndefined();
    expect(terrainCredit({ VITE_TERRAIN_CREDIT: '© DLR e.V.' })).toBe('© DLR e.V.');
  });

  it('gives a flat globe rather than no globe when nothing is configured', async () => {
    const { provider, source } = await createTerrain({ env: {} });
    expect(source).toBe('ellipsoid');
    expect(provider).toBeTruthy();
  });

  it('falls back loudly when a configured tileset cannot be loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `.invalid` is reserved by RFC 2606 and never resolves, so this cannot
    // reach the network however the environment implements fetching.
    const { source } = await createTerrain({
      env: { VITE_TERRAIN_URL: 'https://terrain.invalid/tiles' },
      timeoutMs: 50,
    });
    expect(source).toBe('ellipsoid');
    // An operator who configured a terrain URL needs to know it did not load:
    // the only other symptom is a globe that looks subtly, unaccountably flat.
    expect(warn).toHaveBeenCalled();
  });
});
