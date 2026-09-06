# Development Workflow

Companion Atlas is one viewer (`viewer-react/`, Resium/CesiumJS + R3F WebXR)
over a shared 4D `Story` schema (`packages/story-schema/`), with a processing
server (`server/`).

## Commands

- `npm run account:new -- "your-account-name"`
- `npm run dev` — build the schema package, then the viewer dev server on `:4174`
- `npm run build` — schema package, then `tsc --noEmit && vite build` for the viewer
- `npm test` — Vitest across the viewer and the server
- `npm run typecheck` — schema package, then the server

## Loop

1. Set account context with `account:new`.
2. Run `dev` and verify real-time updates at http://127.0.0.1:4174.
3. Make one scoped change at a time.
4. Run `npm test` — the logic suites in `viewer-react/test/` are the fast gate.
5. Run `npm run build` as the pre-merge gate.

## Testing

Logic is covered by Vitest (`viewer-react/test/`, `server/test/`,
`packages/story-schema/test/`). `viewer-react/tests/*.capture.ts` are Playwright
**capture** scripts (video/screenshots for docs and review), not pixel-diff
regression — run them with
`npx playwright test --config=viewer-react/playwright.capture.config.js`.

There is no pixel-diff visual regression suite today. The old one covered the
removed vanilla-TS viewer's `?static=1` path; re-establishing baselines against
the Resium renderer is open work (see `docs/CONSOLIDATION.md`).
