import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const SHOTS = 'capture/screenshots';

const seededPins = {
  'earth-operator': [
    { id: 'pin-reykjavik', label: 'Reykjavik', notes: 'North Atlantic checkpoint', mediaUrl: '', lat: 64.1466, lon: -21.9426, altitude: 0, createdAt: '2026-03-14T09:00:00.000Z' },
    { id: 'pin-accra', label: 'Accra', notes: 'Equatorial corridor', mediaUrl: '', lat: 5.6037, lon: -0.187, altitude: 0, createdAt: '2026-03-14T09:05:00.000Z' },
    { id: 'pin-singapore', label: 'Singapore', notes: 'Strait relay', mediaUrl: '', lat: 1.3521, lon: 103.8198, altitude: 0, createdAt: '2026-03-14T09:10:00.000Z' },
  ],
};

async function ready(page: Page): Promise<void> {
  await expect(page.locator('#viewport')).toHaveAttribute('data-local-textures', 'ready', { timeout: 20_000 });
  await page.waitForTimeout(900);
}

test('01 — control deck (hero)', async ({ page }) => {
  await page.goto('/?static=1&imagery=local');
  await ready(page);
  await page.screenshot({ path: `${SHOTS}/01-control-deck.png`, fullPage: true });
});

test('02 — scrapbook route (seeded pins + journey)', async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('ci-earth-scrapbook', JSON.stringify(s)), seededPins);
  await page.goto('/?static=1&imagery=local');
  await ready(page);
  await page.screenshot({ path: `${SHOTS}/02-scrapbook-route.png`, fullPage: true });
});

test('03 — closer zoom', async ({ page }) => {
  await page.goto('/?static=1&imagery=local');
  await ready(page);
  for (let i = 0; i < 3; i++) {
    await page.locator('#zoom-in-btn').click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/03-close-zoom.png`, fullPage: true });
});

test('04 — 4D story mode (sample-pacific-journey)', async ({ page }) => {
  await page.goto('/?static=1&imagery=local&story=/stories/sample-pacific-journey.json');
  await ready(page);
  await page.screenshot({ path: `${SHOTS}/04-story-mode.png`, fullPage: true });
});

// Video: a scripted flythrough (Playwright records capture/results/**/video.webm).
test('05 — demo flythrough (video)', async ({ page }) => {
  await page.addInitScript((s) => localStorage.setItem('ci-earth-scrapbook', JSON.stringify(s)), seededPins);
  await page.goto('/?static=1&imagery=local');
  await ready(page);

  // Zoom in toward the globe.
  for (let i = 0; i < 3; i++) {
    await page.locator('#zoom-in-btn').click().catch(() => {});
    await page.waitForTimeout(700);
  }
  // Fly between the seeded pins.
  const pins = page.locator('#pin-list .pin-item');
  const count = await pins.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    await pins.nth(i).click().catch(() => {});
    await page.waitForTimeout(1400);
  }
  await page.waitForTimeout(1000);
});
