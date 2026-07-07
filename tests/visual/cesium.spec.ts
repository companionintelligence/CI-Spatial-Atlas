/**
 * Cesium renderer smoke tests.
 *
 * Real Cesium ion imagery/terrain is not suitable for pixel-diff screenshot
 * testing (it can change server-side independent of this app's code — see
 * docs/architecture.md §6), so these tests assert on status attributes and
 * DOM state rather than screenshots, the same philosophy tiles.spec.ts
 * already uses for its live-network assertions.
 *
 * `data-cesium-status` reaching 'error' is treated as a pass, not a failure —
 * the point of this test is "the app reaches a defined terminal state
 * without crashing," not "the ion API is always reachable from wherever
 * this test happens to run" (no token, network egress restrictions, or ion
 * quota limits are all legitimate reasons a real deployment might see
 * 'error', and the app should degrade gracefully when it does).
 *
 * Run only the chromium-desktop project to avoid redundant network calls.
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function waitForCesiumTerminalStatus(page: import('@playwright/test').Page): Promise<string | null> {
  await page
    .waitForFunction(
      () => {
        const status = document.getElementById('viewport')?.getAttribute('data-cesium-status');
        return status === 'ready' || status === 'error';
      },
      { timeout: 20_000 }
    )
    .catch(() => {
      // Neither terminal state reached within timeout — surfaced via the
      // 'loading' fallback below, which the assertion after this rejects.
    });

  return page.locator('#viewport').getAttribute('data-cesium-status');
}

test('Cesium renderer initialises and reaches a terminal status', async ({ page }) => {
  await page.goto('/?renderer=cesium');

  await expect(page.locator('#control-panel h1')).toHaveText('Companion Atlas');
  await expect(page.locator('#viewport')).toHaveAttribute('data-renderer', 'cesium');

  const status = await waitForCesiumTerminalStatus(page);
  console.log(`[cesium-test] data-cesium-status="${status}"`);

  expect(['ready', 'error']).toContain(status);
});

test('Cesium renderer does not crash the scrapbook system', async ({ page }) => {
  await page.addInitScript(() => {
    const pin = {
      id: 'pin-cesium-test',
      label: 'Cesium Smoke Pin',
      notes: '',
      mediaUrl: '',
      lat: 40.7128,
      lon: -74.006,
      altitude: 0,
      createdAt: '2026-03-14T12:00:00.000Z'
    };
    localStorage.setItem('ci-earth-scrapbook', JSON.stringify({ 'earth-operator': [pin] }));
  });

  await page.goto('/?renderer=cesium');

  await expect(page.locator('#control-panel h1')).toHaveText('Companion Atlas');
  await expect(page.locator('#pin-list .pin-item')).toHaveCount(1, { timeout: 5000 });

  const status = await waitForCesiumTerminalStatus(page);
  expect(['ready', 'error']).toContain(status);

  // The page must still be responsive after Cesium finishes initialising —
  // dropping a second pin should work regardless of whether ion assets loaded.
  await page.fill('#pin-label', 'Second Pin');
  await page.click('#scrapbook-form button[type="submit"]');
  await expect(page.locator('#pin-list .pin-item')).toHaveCount(2, { timeout: 5000 });
});
