import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const SHOTS = 'capture/screenshots';

async function cesiumTerminal(page: Page): Promise<string | null> {
  await page
    .waitForFunction(
      () => {
        const s = document.getElementById('viewport')?.getAttribute('data-cesium-status');
        return s === 'ready' || s === 'error';
      },
      { timeout: 30_000 },
    )
    .catch(() => {});
  return page.locator('#viewport').getAttribute('data-cesium-status');
}

async function probe(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate(() => {
    const v = document.getElementById('viewport');
    return {
      renderer: v?.getAttribute('data-renderer') ?? null,
      cesiumStatus: v?.getAttribute('data-cesium-status') ?? null,
      imageryMode: v?.getAttribute('data-imagery-mode') ?? null,
      tiles: v?.getAttribute('data-tiles') ?? null,
      localTextures: v?.getAttribute('data-local-textures') ?? null,
    };
  });
}

test('cesium — default renderer reaches terminal state (offline fallback w/o token)', async ({ page }) => {
  await page.goto('/?renderer=cesium');
  await expect(page.locator('#control-panel h1')).toHaveText('Companion Atlas');
  await expect(page.locator('#viewport')).toHaveAttribute('data-renderer', 'cesium');
  const status = await cesiumTerminal(page);
  await page.waitForTimeout(3500);
  console.log(`[cesium-default] status=${status} token=${Boolean(process.env.CESIUM_ION_TOKEN)} probe=${JSON.stringify(await probe(page))}`);
  await page.screenshot({ path: `${SHOTS}/cesium-01-default.png`, fullPage: true });
});

test('cesium — with a seeded scrapbook pin (billboards render on the Cesium globe)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ci-earth-scrapbook',
      JSON.stringify({ 'earth-operator': [
        { id: 'p1', label: 'New York', notes: '', mediaUrl: '', lat: 40.7128, lon: -74.006, altitude: 0, createdAt: '2026-03-14T12:00:00.000Z' },
        { id: 'p2', label: 'Reykjavik', notes: '', mediaUrl: '', lat: 64.1466, lon: -21.9426, altitude: 0, createdAt: '2026-03-14T12:05:00.000Z' },
      ] }),
    );
  });
  await page.goto('/?renderer=cesium');
  await cesiumTerminal(page);
  await expect(page.locator('#pin-list .pin-item')).toHaveCount(2, { timeout: 8000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/cesium-02-pins.png`, fullPage: true });
});

test('classic 3D-tiles path — status without tokens (graceful degradation)', async ({ page }) => {
  await page.goto('/?imagery=live&renderer=classic');
  const tiles = await page
    .waitForFunction(
      () => {
        const s = document.getElementById('viewport')?.getAttribute('data-tiles');
        return s && ['active', 'loading', 'disabled', 'error'].includes(s) ? s : null;
      },
      { timeout: 25_000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => null);
  await page.waitForTimeout(1500);
  console.log(`[classic-tiles] data-tiles=${tiles} google=${Boolean(process.env.GOOGLE_MAP_PLATFORM)}`);
  await page.screenshot({ path: `${SHOTS}/cesium-03-tiles-classic.png`, fullPage: true });
});
