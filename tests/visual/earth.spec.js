import { test, expect } from '@playwright/test';

const seededScrapbookState = {
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

const seededInteractionState = {
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

test('Companion Earth hero canvas is visually stable', async ({ page }) => {
  await page.goto('/?static=1');
  await expect(page.locator('#control-panel h1')).toHaveText('Companion Earth');

  // Allow one render cycle so animation settles and canvas is present.
  await page.waitForTimeout(800);

  await expect(page).toHaveScreenshot('companion-earth-control-deck.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('Companion Earth scrapbook route is visually stable', async ({ page }) => {
  await page.addInitScript((scrapbookState) => {
    localStorage.setItem('ci-earth-scrapbook', JSON.stringify(scrapbookState));
  }, seededScrapbookState);

  await page.goto('/?static=1');
  await expect(page.locator('#pin-list .pin-item')).toHaveCount(3);

  await page.waitForTimeout(800);

  await expect(page).toHaveScreenshot('companion-earth-scrapbook-route.png', {
    animations: 'disabled',
    fullPage: true
  });
});

test('Companion Earth selects a pin directly from the globe', async ({ page }) => {
  await page.addInitScript((scrapbookState) => {
    localStorage.setItem('ci-earth-scrapbook', JSON.stringify(scrapbookState));
  }, seededInteractionState);

  await page.goto('/?static=1');
  await expect(page.locator('#pin-detail-label')).toHaveValue('Pacific Archive');

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
