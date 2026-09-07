import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Cesium from 'cesium';
import { watchTerrainFailure } from '../src/renderers/CesiumStoryViewer.js';

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
