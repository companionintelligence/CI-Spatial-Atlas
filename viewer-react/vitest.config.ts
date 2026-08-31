/**
 * Vitest for the viewer workspace.
 *
 * Without this file, `npm test -w viewer-react` falls back to `vite.config.ts`
 * — which loads `viewer-react/.env`, so the Street View suite passed here only
 * because this machine happens to hold a real Maps key, and would have failed on
 * a fresh clone. Reusing the repo-root config keeps the two entry points
 * (`npm test -w viewer-react` and a bare `vitest` at the root) running the same
 * suite under the same environment, including the stand-in key it installs.
 */
export { default } from '../vitest.config.js';
