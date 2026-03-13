import { test, expect } from '@playwright/test';

test('Companion Earth hero canvas is visually stable', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });

  await page.goto('/?static=1');
  await expect(page.locator('#control-panel h1')).toHaveText('Companion Earth');

  // Allow one render cycle so animation settles and canvas is present.
  await page.waitForTimeout(800);

  await expect(page).toHaveScreenshot('companion-earth-control-deck.png', {
    animations: 'disabled',
    fullPage: true
  });
});
