import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Cesium from 'cesium';
import { watchTerrainFailure } from '../src/renderers/CesiumStoryViewer.js';
import { createTerrain, guardRootTileStalls } from '../src/renderers/terrain.js';

/**
 * The terrain fallback, which exists because a failed terrain tile is not a
 * cosmetic loss.
 *
 * A level-0 tile whose request fails goes to `QuadtreeTileLoadState.FAILED` and
 * never leaves it (there is no parent to upsample from), and the fill-mesh pass
 * that covers missing geometry elsewhere only propagates outward from tiles
 * that *have* geometry — so with the roots gone the globe draws no surface at
 * all and renders black, however good the imagery underneath is. That is the
 * black globe people kept blaming on imagery. The full derivation is on
 * `watchTerrainFailure` in CesiumStoryViewer.tsx.
 *
 * These tests drive the listener directly with `TileProviderError`s of the
 * shape Cesium's own `GlobeSurfaceTile.requestTileGeometry` reports. Nothing
 * here touches the network or a WebGL context; the assertion is about the
 * policy, which is where the bug was.
 */

/** A viewer stub with the three members the fallback actually touches. */
function fakeViewer(terrain: Cesium.TerrainProvider) {
  const v = {
    terrainProvider: terrain,
    isDestroyed: () => false,
    scene: { requestRender: vi.fn() },
  };
  return v as unknown as Cesium.Viewer & typeof v;
}

const tileError = (provider: Cesium.TerrainProvider, x: number, y: number, level: number) =>
  new Cesium.TileProviderError(provider, `Failed to obtain terrain tile X: ${x} Y: ${y}`, x, y, level);

describe('terrain failure fallback', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retries a root tile once before giving up on the provider', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new Cesium.EllipsoidTerrainProvider();
    const v = fakeViewer(provider);
    watchTerrainFailure(v, provider);

    const first = tileError(provider, 0, 0, 0);
    provider.errorEvent.raiseEvent(first);
    // A single CDN hiccup should cost a re-request, not the session's terrain.
    expect(first.retry).toBe(true);
    expect(v.terrainProvider).toBe(provider);

    const second = tileError(provider, 0, 0, 0);
    provider.errorEvent.raiseEvent(second);
    expect(second.retry).toBe(false);
    expect(v.terrainProvider).not.toBe(provider);
    expect(v.terrainProvider).toBeInstanceOf(Cesium.EllipsoidTerrainProvider);
  });

  it('counts retries per root tile, not per provider', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new Cesium.EllipsoidTerrainProvider();
    const v = fakeViewer(provider);
    watchTerrainFailure(v, provider);

    // Cesium's own `timesRetried` is provider-wide — the terrain path reuses
    // one TileProviderError and never calls reportSuccess to reset it — so a
    // second *different* root tile failing once must still get its retry.
    provider.errorEvent.raiseEvent(tileError(provider, 0, 0, 0));
    const otherRoot = tileError(provider, 1, 0, 0);
    provider.errorEvent.raiseEvent(otherRoot);
    expect(otherRoot.retry).toBe(true);
    expect(v.terrainProvider).toBe(provider);
  });

  it('leaves terrain alone when the failures are below level 0', () => {
    const provider = new Cesium.EllipsoidTerrainProvider();
    const v = fakeViewer(provider);
    watchTerrainFailure(v, provider);

    // A deep tile upsamples from its parent or takes a neighbour's fill mesh:
    // the globe still draws, so dropping every height in the world over one bad
    // tile in the Alps would be the worse trade.
    for (let i = 0; i < 8; i++) provider.errorEvent.raiseEvent(tileError(provider, 4, 5, 6));
    expect(v.terrainProvider).toBe(provider);
  });

  it('does not stomp a terrain provider something else installed since', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new Cesium.EllipsoidTerrainProvider();
    const v = fakeViewer(provider);
    watchTerrainFailure(v, provider);

    // layers/cesium.ts hands the globe to a user's quantized-mesh layer when
    // one is added; a late error from the provider we installed at mount must
    // not take that away from them.
    const userTerrain = new Cesium.EllipsoidTerrainProvider();
    v.terrainProvider = userTerrain;
    provider.errorEvent.raiseEvent(tileError(provider, 0, 0, 0));
    provider.errorEvent.raiseEvent(tileError(provider, 0, 0, 0));
    expect(v.terrainProvider).toBe(userTerrain);
  });

  it('stops listening when the viewer unmounts', () => {
    const provider = new Cesium.EllipsoidTerrainProvider();
    const v = fakeViewer(provider);
    const stop = watchTerrainFailure(v, provider);
    stop();
    expect(provider.errorEvent.numberOfListeners).toBe(0);

    const err = tileError(provider, 0, 0, 0);
    provider.errorEvent.raiseEvent(err);
    expect(err.retry).toBe(false);
  });
});

/**
 * The half of the black-globe problem the error event structurally cannot see.
 *
 * Everything above is driven by a `TileProviderError`, and Cesium only raises
 * one from the `.catch` on the tile request promise. A host that accepts the
 * connection and then answers nothing never rejects — Cesium's XHR sets no
 * `timeout` and `RequestScheduler` adds none — so the root tile sits in
 * `RECEIVING`, no error is reported, and the fallback above never runs while
 * the globe shows exactly the black ball it exists to prevent.
 * `guardRootTileStalls` supplies the missing rejection.
 *
 * The stub providers here return promises that never settle, which is the
 * whole point: a test that resolves them would be testing the case that
 * already worked.
 */
describe('stalled root tiles', () => {
  afterEach(() => vi.restoreAllMocks());

  /** A provider whose tile requests hang forever, like a blackholed tile host. */
  const stalling = (): Cesium.TerrainProvider => {
    const p = new Cesium.EllipsoidTerrainProvider();
    p.requestTileGeometry = () => new Promise<Cesium.TerrainData>(() => {});
    return p;
  };

  /** Did this promise settle by the time the microtask queue drained? */
  const settledYet = async (p: Promise<unknown> | undefined): Promise<boolean> => {
    let done = false;
    void p?.then(() => { done = true; }, () => { done = true; });
    await new Promise((r) => setTimeout(r, 60));
    return done;
  };

  it('rejects a level-zero tile that never answers', async () => {
    const provider = guardRootTileStalls(stalling(), 20);
    // Rejecting is the entire contract: it is what reaches Cesium's
    // `failure()` → `TileProviderError.reportError` → the listener above.
    await expect(provider.requestTileGeometry(0, 0, 0)!).rejects.toThrow(/stalled/);
  });

  it('leaves deeper tiles hanging rather than failing them', async () => {
    const provider = guardRootTileStalls(stalling(), 20);
    // A FAILED deep tile is never re-requested; it upsamples from its parent
    // for the rest of the session. Timing one out would trade an invisible
    // delay for permanent local damage — and the globe still draws either way,
    // so there is no black-globe risk here to trade against.
    expect(await settledYet(provider.requestTileGeometry(3, 4, 5))).toBe(false);
  });

  it('passes a scheduler deferral through untouched', async () => {
    const provider = new Cesium.EllipsoidTerrainProvider();
    // `undefined` is Cesium's "the request was not sent, ask again next frame".
    // Timing out a request that was never issued would fail tiles because the
    // browser was busy, which is the opposite of the intent.
    provider.requestTileGeometry = () => undefined;
    expect(guardRootTileStalls(provider, 20).requestTileGeometry(0, 0, 0)).toBeUndefined();
  });

  it('does not disturb a tile that arrives in time', async () => {
    const data = {} as Cesium.TerrainData;
    const provider = new Cesium.EllipsoidTerrainProvider();
    provider.requestTileGeometry = () => Promise.resolve(data);
    // The guard is a deadline, not a proxy: the real terrain data must come
    // back unchanged, and the pending timer must not reject behind it.
    await expect(guardRootTileStalls(provider, 20).requestTileGeometry(0, 0, 0)!).resolves.toBe(
      data,
    );
    await new Promise((r) => setTimeout(r, 40));
  });

  it('arms the guard on the provider createTerrain hands back', async () => {
    // The guard is worthless if it is only ever applied in a test. Stub the
    // handshake — which such a host completes perfectly well; that is why the
    // 8 s budget around `fromUrl` does not catch this — and check that the
    // provider the viewer would install is the guarded one.
    const stub = stalling();
    vi.spyOn(Cesium.CesiumTerrainProvider, 'fromUrl').mockResolvedValue(
      stub as unknown as Cesium.CesiumTerrainProvider,
    );
    const choice = await createTerrain({
      env: { VITE_TERRAIN_URL: 'https://dem.example.org/copernicus' },
      rootTileTimeoutMs: 20,
    });
    expect(choice.source).toBe('self-hosted');
    await expect(choice.provider.requestTileGeometry(0, 0, 0)!).rejects.toThrow(/stalled/);
  });
});
