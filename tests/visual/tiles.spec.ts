/**
 * 3D Tiles integration smoke tests.
 *
 * These tests run against the live dev server (not ?static=1) so real API
 * calls can be made using the keys injected via .env.
 *
 * Assertions:
 *   1. The tiles system initialises without crashing the page.
 *   2. The #viewport element reports a known data-tiles status.
 *   3. A screenshot is captured to visually document the tile render state.
 *      If tiles load, you'll see 3D terrain/buildings on the globe surface.
 *      If the API is unavailable, the procedural globe remains visible.
 *
 * Run only the chromium-desktop project to avoid redundant network calls.
 */
import { expect, test } from '@playwright/test';

// Only run tiles tests on desktop — keeps CI fast and avoids mobile quirks.
test.use({ viewport: { width: 1440, height: 900 } });

test('3D tiles system initialises and reports status', async ({ page }, testInfo) => {
  // Skip the screenshot assertion on mobile — the desktop snapshot is sufficient
  // as visual documentation; mobile is covered by the scrapbook crash-safety test.
  const isMobile = testInfo.project.name === 'mobile-chrome';

  // Live mode: no ?static=1, so tiles are allowed to load from the API.
  await page.goto('/?imagery=live');

  // Page must render without throwing.
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 8000 });

  // Wait for the tiles system to transition out of 'loading'.
  // 'active'   → at least one tile model was received from the 3D tiles API ✓
  // 'disabled' → no API key configured (expected in keyless environments)
  // 'error'    → API rejected the request (key invalid / quota exceeded)
  const viewport = page.locator('#viewport');
  await expect(viewport).toHaveAttribute('data-imagery-mode', 'live');
  await page
    .waitForSelector('#viewport[data-tiles]', { timeout: 20_000 })
    .catch(() => {
      // Attribute not set within timeout — tiles disabled or system not reached.
    });

  const status = await viewport.getAttribute('data-tiles');
  console.log(`[tiles-test] data-tiles="${status}"`);

  // Status must be a known value (not undefined/null – that would mean
  // the tilesSystem code never ran at all).
  expect(['active', 'loading', 'disabled', 'error']).toContain(status ?? 'none');

  // If tiles are loading or active, wait a bit longer for geometry to arrive.
  if (status === 'loading' || status === 'active') {
    await page.waitForTimeout(3000);
    const finalStatus = await viewport.getAttribute('data-tiles');
    console.log(`[tiles-test] data-tiles final="${finalStatus}"`);
  }

  // Screenshot captures the current globe render state regardless of tile status.
  // Use a high diff tolerance because tile geometry changes between API requests.
  // Skip on mobile — the desktop snapshot is sufficient documentation.
  if (!isMobile) {
    await expect(page).toHaveScreenshot('tiles-globe-state.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.35,
      fullPage: true
    });
  }
});

test('3D tiles do not crash the scrapbook system', async ({ page }) => {
  // Seed a pin and verify the scrapbook still works with tiles running.
  await page.addInitScript(() => {
    const pin = {
      id: 'pin-tiles-test',
      label: 'Tiles Smoke Pin',
      notes: '',
      mediaUrl: '',
      lat: 40.7128,
      lon: -74.006,
      altitude: 0,
      createdAt: '2026-03-14T12:00:00.000Z'
    };
    localStorage.setItem(
      'ci-earth-scrapbook',
      JSON.stringify({ 'earth-operator': [pin] })
    );
  });

  await page.goto('/?imagery=live');

  // Basic page load check.
  await expect(page.locator('#control-panel h1')).toHaveText('Companion Atlas');
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#viewport')).toHaveAttribute('data-imagery-mode', 'live');

  // The scrapbook pin should render in the pin list.
  await expect(page.locator('#pin-list .pin-item')).toHaveCount(1, { timeout: 5000 });

  // Wait for potential tile loading to start, then check no crash.
  await page.waitForTimeout(1500);
  const tilesStatus = await page.locator('#viewport').getAttribute('data-tiles');
  expect(tilesStatus).toBeTruthy();
  console.log(`[tiles-test] scrapbook+tiles status="${tilesStatus}"`);
});
