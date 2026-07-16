import { test } from '@playwright/test';

// Run the actual Resium/Cesium viewer with a 4D story loaded (CZML → clock).
test('resium viewer — 4D story on Cesium (real imagery + timeline)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?renderer=cesium&story=/stories/sample-pacific-journey.json');
  await page.waitForSelector('canvas', { timeout: 40_000 });
  await page.waitForTimeout(10_000); // Cesium init + imagery + CZML entities + clock
  console.log(`[resium] canvas rendered; console errors: ${errors.length}`);
  await page.screenshot({ path: 'capture-shots/resium-01-story.png', fullPage: true });
});
