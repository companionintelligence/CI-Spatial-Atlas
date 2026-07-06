/**
 * Documentation screenshot generator.
 *
 * Captures the reference imagery used by docs/ui-guide.md: full desktop and
 * mobile views, individual sidebar cards, HUD clusters, interaction states
 * (pin selected, journey route, story mode), and one numbered-callout
 * overview image. Uses `?static=1` throughout so output is reproducible.
 *
 * Requires the dev server running (`npm run vibe:dev`) on port 4173.
 * Run with: npx tsx scripts/capture-doc-screenshots.ts
 */
import { chromium, devices, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = 'http://127.0.0.1:4173';
const OUT_DIR = resolve('docs/screenshots');

const seededPins = {
  'earth-operator': [
    {
      id: 'pin-reykjavik',
      label: 'North Atlantic Checkpoint',
      notes: 'First light over the fjords before heading south.',
      mediaUrl: 'https://example.com/reykjavik.jpg',
      lat: 64.1466,
      lon: -21.9426,
      altitude: 0,
      createdAt: '2026-03-14T08:00:00.000Z'
    },
    {
      id: 'pin-accra',
      label: 'Equatorial Corridor',
      notes: 'Coastal reconstruction from a 42-photo set.',
      mediaUrl: 'https://example.com/accra.jpg',
      lat: 5.6037,
      lon: -0.187,
      altitude: 0,
      createdAt: '2026-03-14T08:35:00.000Z'
    },
    {
      id: 'pin-singapore',
      label: 'Strait Relay',
      notes: 'Journey closes on the strait at dusk.',
      mediaUrl: '',
      lat: 1.3521,
      lon: 103.8198,
      altitude: 0,
      createdAt: '2026-03-14T09:10:00.000Z'
    }
  ]
};

async function seedPins(page: Page): Promise<void> {
  await page.addInitScript((state) => {
    localStorage.setItem('ci-earth-scrapbook', JSON.stringify(state));
  }, seededPins);
}

async function waitForReady(page: Page): Promise<void> {
  await page.waitForSelector('#viewport[data-local-textures="ready"]', { timeout: 15_000 });
  await page.waitForTimeout(500);
}

/** Draw a numbered circular badge over `selector`'s bounding box, anchored at its top-left. */
async function annotate(page: Page, items: Array<{ selector: string; n: number; label: string }>): Promise<void> {
  await page.evaluate((entries) => {
    const layer = document.createElement('div');
    layer.id = 'doc-annotate-layer';
    layer.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;font-family:sans-serif;';
    document.body.appendChild(layer);

    for (const { selector, n, label } of entries) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const rect = el.getBoundingClientRect();

      const badge = document.createElement('div');
      badge.textContent = String(n);
      badge.style.cssText = `
        position:absolute; left:${rect.left - 12}px; top:${rect.top - 12}px;
        width:26px; height:26px; border-radius:50%;
        background:#ff6a3d; color:#fff; font-weight:800; font-size:13px;
        display:flex; align-items:center; justify-content:center;
        border:2px solid #fff; box-shadow:0 0 0 2px #ff6a3d, 0 2px 6px rgba(0,0,0,0.5);
      `;
      layer.appendChild(badge);

      const outline = document.createElement('div');
      outline.style.cssText = `
        position:absolute; left:${rect.left - 4}px; top:${rect.top - 4}px;
        width:${rect.width + 8}px; height:${rect.height + 8}px;
        border:2px solid #ff6a3d; border-radius:10px;
      `;
      layer.appendChild(outline);

      const tag = document.createElement('div');
      tag.textContent = `${n}. ${label}`;
      tag.style.cssText = `
        position:absolute; left:${rect.left - 12}px; top:${rect.top + rect.height + 6}px;
        background:rgba(10,16,32,0.92); color:#fff; font-size:11px; font-weight:700;
        padding:2px 7px; border-radius:6px; white-space:nowrap; border:1px solid #ff6a3d;
      `;
      layer.appendChild(tag);
    }
  }, items);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  // ---------------------------------------------------------------------
  // Desktop captures
  // ---------------------------------------------------------------------
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // 1. Hero — default state
  {
    const page = await desktop.newPage();
    await page.goto(`${BASE_URL}/?static=1&imagery=local`);
    await waitForReady(page);
    await page.screenshot({ path: `${OUT_DIR}/hero-desktop.png`, fullPage: true });
    await page.close();
  }

  // 2. Annotated overview (numbered callouts over the default state)
  {
    const page = await desktop.newPage();
    await page.goto(`${BASE_URL}/?static=1&imagery=local`);
    await waitForReady(page);
    await annotate(page, [
      { selector: '.panel-head', n: 1, label: 'Brand header' },
      { selector: '#layer-controls', n: 2, label: 'Layers card' },
      { selector: '#scrapbook-form', n: 3, label: 'Drop-pin form' },
      { selector: '#pin-detail-form', n: 4, label: 'Pin details form' },
      { selector: '#hud-coords', n: 5, label: 'Lat/lon readout' },
      { selector: '#hud-zoom', n: 6, label: 'Zoom controls' },
      { selector: '#hud-compass', n: 7, label: 'Compass' },
      { selector: '#env-bar', n: 8, label: 'Environment bar' },
      { selector: '#sidebar-close', n: 9, label: 'Collapse sidebar' }
    ]);
    await page.screenshot({ path: `${OUT_DIR}/overview-annotated.png`, fullPage: false });
    await page.close();
  }

  // 3. Individual sidebar cards
  const cardTargets: Array<{ heading: string; file: string }> = [
    { heading: 'Environment', file: 'card-environment.png' },
    { heading: 'Layers', file: 'card-layers.png' },
    { heading: 'Spatial Scrapbook', file: 'card-scrapbook.png' },
    { heading: 'Pin Details', file: 'card-pin-details.png' },
    { heading: 'Journeys', file: 'card-journeys.png' }
  ];
  {
    const page = await desktop.newPage();
    await seedPins(page);
    await page.goto(`${BASE_URL}/?static=1&imagery=local`);
    await waitForReady(page);
    // Select a pin so Pin Details renders populated fields.
    await page.locator('.pin-item').first().click();
    await page.waitForTimeout(200);

    for (const { heading, file } of cardTargets) {
      const card = page.locator('section.card').filter({ has: page.locator(`h2:text("${heading}")`) });
      await card.screenshot({ path: `${OUT_DIR}/${file}` });
    }

    const settings = page.locator('details.settings-card');
    await settings.evaluate((el) => el.setAttribute('open', ''));
    await settings.screenshot({ path: `${OUT_DIR}/card-account-settings.png` });

    await page.close();
  }

  // 4. HUD clusters
  {
    const page = await desktop.newPage();
    await page.goto(`${BASE_URL}/?static=1&imagery=local`);
    await waitForReady(page);
    await page.locator('#hud-right').screenshot({ path: `${OUT_DIR}/hud-right-cluster.png` });
    await page.locator('#hud-coords').screenshot({ path: `${OUT_DIR}/hud-coords.png` });
    await page.locator('#env-bar').screenshot({ path: `${OUT_DIR}/hud-env-bar.png` });
    await page.close();
  }

  // 5. Pin selected + journey route (multi-pin state)
  {
    const page = await desktop.newPage();
    await seedPins(page);
    await page.goto(`${BASE_URL}/?static=1&imagery=local`);
    await waitForReady(page);
    await page.screenshot({ path: `${OUT_DIR}/journey-route.png`, fullPage: true });

    await page.locator('.pin-item').first().click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT_DIR}/pin-selected.png`, fullPage: true });
    await page.close();
  }

  // 6. Story mode (?story=)
  {
    const page = await desktop.newPage();
    await page.goto(`${BASE_URL}/?static=1&imagery=local&story=/stories/sample-pacific-journey.json`);
    await waitForReady(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT_DIR}/story-mode.png`, fullPage: true });
    await page.close();
  }

  // 6b. Cesium renderer (real ion imagery — not deterministic, illustrative only)
  {
    const page = await desktop.newPage();
    await page.goto(`${BASE_URL}/?renderer=cesium`);
    await page
      .waitForFunction(
        () => {
          const s = document.getElementById('viewport')?.getAttribute('data-cesium-status');
          return s === 'ready' || s === 'error';
        },
        { timeout: 20_000 }
      )
      .catch(() => {
        // Fall through to the screenshot regardless — illustrative capture,
        // not a pass/fail gate (see cesium.spec.ts for the actual test).
      });
    await page.waitForTimeout(4000); // let imagery/terrain/buildings stream in
    await page.screenshot({ path: `${OUT_DIR}/cesium-renderer.png`, fullPage: true });
    await page.close();
  }

  // 7. Sidebar collapsed (desktop)
  {
    const page = await desktop.newPage();
    await page.goto(`${BASE_URL}/?static=1&imagery=local`);
    await waitForReady(page);
    await page.locator('#sidebar-close').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT_DIR}/sidebar-collapsed-desktop.png`, fullPage: true });
    await page.close();
  }

  await desktop.close();

  // ---------------------------------------------------------------------
  // Mobile captures
  // ---------------------------------------------------------------------
  const mobile = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 } });

  // 8. Mobile default (sidebar collapsed to bottom-sheet handle)
  {
    const page = await mobile.newPage();
    await page.goto(`${BASE_URL}/?static=1&imagery=local`);
    await waitForReady(page);
    await page.screenshot({ path: `${OUT_DIR}/hero-mobile.png`, fullPage: true });
    await page.close();
  }

  // 9. Mobile bottom-sheet open
  {
    const page = await mobile.newPage();
    await page.goto(`${BASE_URL}/?static=1&imagery=local`);
    await waitForReady(page);
    await page.locator('#sidebar-open').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT_DIR}/sidebar-open-mobile.png`, fullPage: true });
    await page.close();
  }

  await mobile.close();
  await browser.close();

  console.log(`Wrote screenshots to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
