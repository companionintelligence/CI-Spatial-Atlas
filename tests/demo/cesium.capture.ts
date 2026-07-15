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

async function probe(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const h = (el: Element | null) => (el ? Math.round((el as HTMLElement).clientHeight) : null);
    const v = document.getElementById('viewport');
    const canvas = document.querySelector('#app canvas') as HTMLCanvasElement | null;
    return {
      renderer: v?.getAttribute('data-renderer') ?? null,
      cesiumStatus: v?.getAttribute('data-cesium-status') ?? null,
      tiles: v?.getAttribute('data-tiles') ?? null,
      H: {
        layout: h(document.getElementById('layout')),
        viewport: h(v),
        app: h(document.getElementById('app')),
        cesiumViewer: h(document.querySelector('.cesium-viewer')),
        cesiumWidget: h(document.querySelector('.cesium-widget')),
        canvasClient: canvas ? Math.round(canvas.clientHeight) : null,
        canvasAttr: canvas ? canvas.height : null,
      },
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

test('cesium — fly to a city (real imagery + terrain + 3D buildings when token set)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ci-earth-scrapbook',
      JSON.stringify({ 'earth-operator': [
        { id: 'sf', label: 'San Francisco', notes: '', mediaUrl: '', lat: 37.7749, lon: -122.4194, altitude: 0, createdAt: '2026-03-14T12:00:00.000Z' },
      ] }),
    );
  });
  await page.goto('/?renderer=cesium');
  await cesiumTerminal(page);
  await expect(page.locator('#pin-list .pin-item')).toHaveCount(1, { timeout: 8000 });
  await page.locator('#pin-list .pin-item').first().click().catch(() => {}); // fly-to
  await page.waitForTimeout(4000);
  for (let i = 0; i < 4; i++) {
    await page.locator('#zoom-in-btn').click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(4000); // let terrain + 3D buildings stream in
  console.log(`[cesium-city] probe=${JSON.stringify(await probe(page))}`);
  await page.screenshot({ path: `${SHOTS}/cesium-04-city-closeup.png`, fullPage: true });
});

test('cesium — oblique low-altitude over Manhattan (3D buildings + terrain)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ci-earth-scrapbook',
      JSON.stringify({ 'earth-operator': [
        { id: 'nyc', label: 'Manhattan', notes: '', mediaUrl: '', lat: 40.7484, lon: -73.9857, altitude: 0, createdAt: '2026-03-14T12:00:00.000Z' },
      ] }),
    );
  });
  await page.goto('/?renderer=cesium');
  await cesiumTerminal(page);
  await page.locator('#pin-list .pin-item').first().click().catch(() => {}); // select the pin
  await expect(page.locator('#pin-detail-label')).toHaveValue('Manhattan', { timeout: 5000 });
  // "Fly To Pin" sets an oblique -45° view at ~4.5 km range over the target.
  await page.locator('#pin-fly-btn').click().catch(() => {});
  await page.waitForTimeout(6500); // fly + OSM buildings + World Terrain stream in
  // Gently get closer while keeping the oblique pitch (camera.zoomIn preserves it).
  await page.locator('#zoom-in-btn').click().catch(() => {});
  await page.waitForTimeout(2200);
  await page.locator('#zoom-in-btn').click().catch(() => {});
  await page.waitForTimeout(5500); // let 3D buildings tile in at the closer range
  console.log(`[cesium-oblique] probe=${JSON.stringify(await probe(page))}`);
  await page.screenshot({ path: `${SHOTS}/cesium-05-oblique.png`, fullPage: true });
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
