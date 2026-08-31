import { defineConfig } from 'vitest/config';

/**
 * The viewer's own test config, so `vitest run` in this workspace stops
 * inheriting `vite.config.ts`.
 *
 * `test/streetview.test.ts` has been red since it landed and says why in its
 * own header: the Street View module reads its key off `import.meta.env`, Vite
 * freezes that when it resolves the config, and neither `vi.stubEnv` nor
 * writing to the test file's `import.meta.env` reaches the copy the source
 * module sees. The stand-in key has to be in place *before* that resolution,
 * which means here — and this file was never committed, so all eight of that
 * file's assertions were checking a `fetch` the module returned early without
 * ever calling.
 *
 * `define` rather than `test.env`, because this has to survive the same
 * freezing it exists to get ahead of: it is a transform-time substitution into
 * the module's own `import.meta.env` lookup, not a value handed to a resolution
 * step that has already run.
 *
 * Nothing here reaches a build. The key is a string that only ever travels to a
 * stubbed `fetch` — every test in that file replaces `globalThis.fetch` before
 * it calls anything.
 */
export default defineConfig({
  define: {
    'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify('test-street-view-key'),
  },
});
