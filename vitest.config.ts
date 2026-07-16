import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `tests/visual` belongs to Playwright (see playwright.config.ts `testDir`).
    // Without this, vitest's default spec glob collects those files and dies on
    // `test.use()` — three permanently-red files that train everyone to ignore a
    // red run, which is how a real failure gets missed.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/visual/**'],
  },
});
