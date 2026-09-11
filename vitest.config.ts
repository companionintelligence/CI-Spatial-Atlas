import { defineConfig } from 'vitest/config';

// A stand-in Maps key, so the Street View tests can exercise the real code path
// on a fresh clone with no `.env`. Vite freezes `import.meta.env` when it
// resolves the config, and it builds that object from `process.env` as well as
// from `.env` files — so this has to be set here, before the config is
// resolved. `??=`, because a machine that has a real key keeps it; nothing in
// the suite ever reaches the network (fetch is stubbed), so the value is only
// ever a presence check.
process.env.VITE_GOOGLE_MAPS_API_KEY ??= 'test-maps-key';

export default defineConfig({
  test: {
    // `viewer-react/tests` belongs to Playwright (see
    // viewer-react/playwright.capture.config.js `testDir`); the Vitest suites
    // live in `viewer-react/test`. Without this, vitest's default spec glob
    // collects the capture scripts and dies on `test.use()` — permanently-red
    // files that train everyone to ignore a red run, which is how a real
    // failure gets missed.
    // `.claude/worktrees` holds other agents' checkouts of this same repo. The
    // default spec glob walks into them and runs a second, older copy of every
    // suite — locally that doubled the run and reported passes from code that
    // is not the working tree.
    exclude: ['**/node_modules/**', '**/dist/**', 'viewer-react/tests/**', '**/.claude/**'],
  },
});
