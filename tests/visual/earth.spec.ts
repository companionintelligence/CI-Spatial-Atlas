import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { ScrapbookData } from '../../src/types';

const seededScrapbookState: ScrapbookData = {
  'earth-operator': [
    {
      id: 'pin-reykjavik',
      label: 'North Atlantic Checkpoint',
      notes: 'Seeded for visual regression coverage.',
      mediaUrl: '',
      lat: 64.1466,
      lon: -21.9426,
      altitude: 0,
      createdAt: '2026-03-14T09:00:00.000Z'
    },
    {
      id: 'pin-accra',
      label: 'Equatorial Corridor',
      notes: 'Seeded for visual regression coverage.',
      mediaUrl: 'https://example.com/accra.jpg',
      lat: 5.6037,
      lon: -0.187,
      altitude: 0,
      createdAt: '2026-03-14T09:05:00.000Z'
    },
    {
      id: 'pin-singapore',
      label: 'Strait Relay',
      notes: 'Seeded for visual regression coverage.',
      mediaUrl: '',
      lat: 1.3521,
      lon: 103.8198,
      altitude: 0,
      createdAt: '2026-03-14T09:10:00.000Z'
    }
  ]
};

const seededInteractionState: ScrapbookData = {
  'earth-operator': [
    {
      id: 'pin-pacific',
      label: 'Pacific Archive',
      notes: 'Starts selected because it is first in storage order.',
      mediaUrl: '',
      lat: 0,
      lon: -90,
      altitude: 0,
      createdAt: '2026-03-14T08:00:00.000Z'
    },
    {
      id: 'pin-front',
      label: 'Viewport Beacon',
      notes: 'Front-facing marker used for direct scene selection.',
      mediaUrl: '',
      lat: 4.8,
      lon: 90,
      altitude: 0,
      createdAt: '2026-03-14T08:05:00.000Z'
    }
  ]
};

async function seedScrapbookState(page: Page, scrapbookState: ScrapbookData): Promise<void> {
  await page.addInitScript((seededState: ScrapbookData) => {
    localStorage.setItem('ci-earth-scrapbook', JSON.stringify(seededState));
  }, scrapbookState);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

async function waitForLocalTextures(page: Page): Promise<void> {
  // Static mode still decodes eight KTX2/raw assets. Under the desktop + Pixel
  // projects running in parallel, browser workers can queue GPU transcoding for
  // longer than the old 10s budget even though the renderer is healthy.
  await expect(page.locator('#viewport')).toHaveAttribute('data-local-textures', 'ready', {
    timeout: 20_000
  });
}

test('Companion Atlas hero canvas is visually stable', async ({ page }) => {
  await page.goto('/?static=1&imagery=local');
  await expect(page.locator('#control-panel h1')).toHaveText('Companion Atlas');
  await expect(page.locator('#viewport')).toHaveAttribute('data-imagery-mode', 'local');
  await waitForLocalTextures(page);

  await page.waitForTimeout(800);

  await expect(page).toHaveScreenshot('companion-atlas-control-deck.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('Companion Atlas scrapbook route is visually stable', async ({ page }) => {
  await seedScrapbookState(page, seededScrapbookState);

  await page.goto('/?static=1&imagery=local');
  await expect(page.locator('#pin-list .pin-item')).toHaveCount(3);
  await expect(page.locator('#viewport')).toHaveAttribute('data-imagery-mode', 'local');
  await waitForLocalTextures(page);

  await page.waitForTimeout(800);

  await expect(page).toHaveScreenshot('companion-atlas-scrapbook-route.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('Companion Atlas closer zoom is visually stable', async ({ page }) => {
  await page.goto('/?static=1&imagery=local');
  await expect(page.locator('#control-panel h1')).toHaveText('Companion Atlas');
  await expect(page.locator('#viewport')).toHaveAttribute('data-imagery-mode', 'local');
  await waitForLocalTextures(page);

  await page.locator('#zoom-in-btn').click();
  await page.locator('#zoom-in-btn').click();
  await page.locator('#zoom-in-btn').click();
  await page.waitForTimeout(900);

  await expect(page).toHaveScreenshot('companion-atlas-close-zoom.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('Companion Atlas selects a pin directly from the globe', async ({ page }) => {
  await seedScrapbookState(page, seededInteractionState);

  await page.goto('/?static=1&imagery=local');
  await expect(page.locator('#pin-detail-label')).toHaveValue('Pacific Archive');
  await expect(page.locator('#viewport')).toHaveAttribute('data-imagery-mode', 'local');
  await waitForLocalTextures(page);

  const canvas = page.locator('#app canvas');
  const box = await canvas.boundingBox();

  if (!box) {
    throw new Error('Scene canvas was not rendered.');
  }

  await canvas.click({
    position: {
      x: box.width / 2,
      y: box.height / 2
    }
  });

  await expect(page.locator('#pin-detail-label')).toHaveValue('Viewport Beacon');
  await expect(page.locator('#journey-status')).toHaveText('Pin selected from globe.');
});
