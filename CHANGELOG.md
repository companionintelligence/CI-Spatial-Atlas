# Changelog

Notable changes to Companion Atlas. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); dates are UTC. This project
does not yet follow semantic versioning (`package.json` remains `0.1.0`
pending a first tagged release).

## Unreleased

### Added
- **PWA build check and kill switch.** `npm run build` (so the image build and the deploy
  workflow too) now fails when the service worker's files drift: a precached file that is
  missing or outside `/offline/`, a `CACHE` name that no longer matches the fingerprint of the
  precached files (the message names the value to use), or a bundle that no longer registers
  `/sw.js`. `viewer-react/scripts/check-pwa.mjs` does it, from a Vite plugin, and the unit
  tests import the same fingerprint. `docs/service-worker-kill-switch.js` retires the worker
  from the browsers that installed it: copy it over `viewer-react/public/sw.js`, delete the
  `registerServiceWorker()` call, deploy. Its first line tells the build and the tests to stop
  requiring what it has none of — see "Install as a web app (PWA)" in the README.
- **Installable web app (PWA).** `viewer-react` ships a web app manifest
  (standalone, `#041620`, 192 / 512 / maskable icons copied from
  `@companionintelligence/assets` 1.5.1), the head tags that point at it, and a
  small service worker (`viewer-react/public/sw.js`) that shows a static
  `/offline/` page when a page load cannot reach the network. The worker caches
  nothing but that page, its stylesheet and the mark, once at install; the app,
  Cesium, imagery, stories and every Memory or API request go straight to the
  network. It is registered from the bundle in production builds only, and
  skipped in the Capacitor shells and in iframes. The container image's nginx
  config gains `no-cache` for `/sw.js` and `application/manifest+json` for
  `/manifest.webmanifest`. An installed copy starts at `/`, so it loses
  `?memory=` and `?token=` — see "Install as a web app (PWA)" in the README.
  Checked in desktop Chrome only.
- **iOS + Android shell (Capacitor).** `viewer-react/mobile/` wraps the
  viewer-react production build for iOS and Android
  (`com.companionintelligence.atlas`, Capacitor 7). It is a standalone npm
  project, not a root workspace, and is excluded from the Docker context.
  `.github/workflows/mobile-build.yml` (manual dispatch only) builds an unsigned
  debug APK and an unsigned iOS Simulator `.app`. Not store-ready: placeholder
  icons and splash, no signing, no privacy declarations — see
  `viewer-react/mobile/README.md`.
- **Cloudflare deployment (prod).** A single Cloudflare Worker
  (`server/wrangler.toml`, `ci-atlas-prod`) serves the `viewer-react`
  production build as static assets and a REST API shim
  (`server/src/worker.ts`) at `/api/*`, backed by D1 (`store-d1.ts`, in place
  of Postgres) and R2 (`object-store-r2.ts`, in place of MinIO) instead of
  the containerized stack's Postgres/Redis/MinIO. Deploys from
  `.github/workflows/deploy-cloudflare.yml` on push to `main`. Out of scope,
  deliberately: the MCP tool surface (agents keep using the containerized
  Fastify server's `/mcp`) and real 3D reconstruction (COLMAP/OpenDroneMap/
  Nerfstudio need a GPU worker container Workers cannot run) — see
  `server/wrangler.toml` and `server/src/worker.ts` for the full scope note,
  and `server/README.md` for the manual custom-domain step this needs.
- **`.claude/hooks/session-start.sh`** — a Claude Code on the web SessionStart
  hook that inits the `third_party/ci-common` submodule and runs `npm
  install`, so a cloud dev session is immediately buildable/testable. Degrades
  to an actionable warning (never a failed session start) when
  `NODE_AUTH_TOKEN` isn't configured for the private `@companionintelligence/*`
  GitHub Packages.

### Removed
- **The vanilla-TS viewer.** `viewer-react/` is now the only viewer;
  `src/` (the three.js + Cesium control deck), the root `index.html`,
  `vite.config.ts`, `tsconfig.json`, and `Dockerfile` are gone, along with the
  texture pipeline (`scripts/generate-textures.ts`, `materials/`,
  `public/textures`, `public/basis`), the Cesium asset copy
  (`scripts/copy-cesium-assets.ts`), and the doc-screenshot capture
  (`scripts/capture-doc-screenshots.ts`). This completes the
  [`docs/CONSOLIDATION.md`](docs/CONSOLIDATION.md) Phase-1 item that kept the
  vanilla viewer shipping until Resium reached parity.
  - Root `npm run dev` / `build` / `preview` / `test` / `typecheck` (and their
    `deno task` twins) now drive `viewer-react` + `packages/story-schema` +
    `server`. The `vibe:*` scripts, `textures:build`, `cesium:assets`, and
    `docs:screenshots` are gone.
  - `docker-compose.yml`'s `viewer` service is now built from
    `viewer-react/Dockerfile`, which serves on **8080** to match the port
    `hub/config.json` and `hub/docker-compose.json` advertise to CI-Hub. The
    separate `viewer-react` service is gone; host port is 4174.
  - **The pixel-diff visual regression suite went with it.** `tests/visual/*`
    and its baselines only ever covered the removed renderer's deterministic
    `?static=1` path — Resium was never given baselines. Re-establishing them
    is open work. `viewer-react/tests/*.capture.ts` (Playwright *capture*, not
    assertions) is the remaining harness.
  - `docs/ui-guide.md`, `docs/CESIUM-TESTING.md`, and `docs/screenshots/*`
    documented the removed UI and were removed; `docs/architecture.md` was
    rewritten around the one viewer.
  - **CI no longer builds any image.** The root `viewer` and `image` jobs are
    gone with the Dockerfile they built. `viewer-react`'s image cannot build in
    a single-repo checkout because `@companionintelligence/tokens` resolves to
    a path outside this repository, so `hub/docker-compose.json` currently
    names an image nothing here produces. Publishing that package to GitHub
    Packages is what unblocks it.

### Changed
- **Capacitor shell moved from 7.6.10 to 8.6.0** (`viewer-react/mobile`; 7.x loses extended
  support on 2026-12-08). The iOS project builds with Swift Package Manager instead of
  CocoaPods and uses Capacitor's own UIScene delegate in place of the hand-written one; the
  Android project is on AGP 8.13.0 and Gradle 8.14.3. Pinch-zoom is on for both platforms
  (`zoomEnabled`, WCAG 1.4.4). On Android the page now pads itself for the system bars with
  Capacitor's `--safe-area-inset-*` variables (`atlas.css`, `embed.css`), because Capacitor 8
  has no `adjustMarginsForEdgeToEdge`; nothing moves in a browser or in the iOS app.
  `mobile-build.yml` builds the SPM project on `macos-26`. The shell README no longer tells
  operators to add the shell's origins to `CORS_ALLOWED_ORIGINS`: Companion-Memory already
  allows them.
- `3d-tiles-renderer` is now declared by `viewer-react` (it is imported by
  `src/renderers/xr/worldTransform.ts`) instead of being picked up by hoisting
  from the root viewer's dependencies.
- `.env.default`'s viewer block is the `VITE_*` set the React viewer actually
  reads; `ATLAS_VIEWER_BASE_URL` defaults to `http://localhost:4174`.


### Added
- **Consolidation with CI-Earth-2** — Companion Atlas is now the single home for
  the product; the parallel CI-Earth-2 build is superseded and slated for archive.
  See [`docs/CONSOLIDATION.md`](docs/CONSOLIDATION.md) and
  [`docs/adr/0001-resium-viewer-r3f-xr.md`](docs/adr/0001-resium-viewer-r3f-xr.md).
  - **`@companion-atlas/story`** (`packages/story-schema`) — the unified, canonical
    4D `Story` schema (Zod source of truth → generated JSON Schema), consolidating
    this repo's `Story` and CI-Earth-2's `Scrapbook`. Includes normalizers that
    load **either** legacy document shape, the ported **CZML converter**
    (`storyToCzml`, real Cesium `Clock` playback), and `mediaItemsFromMemory`
    (CI-Server Companion Memory → `MediaItem`, ported from CI-Earth-2 PR #8).
    Verified: `tsc` clean + 13 Vitest tests (both historical samples round-trip).
  - **`viewer-react/`** — scaffold of the consolidated viewer (Resium/Cesium for
    desktop+mobile, React-Three-Fiber + `@react-three/xr` for WebXR), consuming the
    unified schema. Not yet built; the vanilla-TS viewer keeps shipping until parity.
  - Root **npm workspaces** (`packages/*`, `viewer-react`).
- **Cesium renderer** (`src/cesium/`) — real Cesium ion World Imagery, World
  Terrain, and OSM 3D Buildings, now the default live-mode renderer behind
  `?renderer=cesium|classic` (see [`docs/architecture.md` §11](docs/architecture.md#11-cesium-renderer)).
  Pins render as proper map-pin icons with a glowing journey route; real
  meters/heading replace the classic renderer's approximated altitude and a
  scripted day/night cycle. Each ion resource (imagery/terrain/buildings)
  degrades independently, with imagery falling back to Cesium's bundled
  offline Natural Earth II raster rather than leaving the globe unpickable.
  `journeyController.ts` extracts the shared journey-playback logic so both
  renderers stay in sync. `cesium.spec.ts` covers it with status-based
  (not pixel-diff) smoke tests, since real ion imagery isn't deterministic.
- Comprehensive documentation set: [`docs/ui-guide.md`](docs/ui-guide.md)
  (every screen/panel/button, with screenshots), [`docs/architecture.md`](docs/architecture.md)
  (mermaid diagrams + reference tables), and a [`docs/README.md`](docs/README.md) index.
- `scripts/capture-doc-screenshots.ts` (`npm run docs:screenshots`) — regenerates
  the documentation screenshot set against the running dev server.
- `LICENSE.md` reference and an accurate, non-open-source license section in
  the root `README.md`.

### Fixed
- The sidebar Environment card's time/weather no longer freeze between pin
  events — the 200ms HUD tick now updates them, matching the environment bar.
- The lat/lon HUD readout now clears on pointer-leave instead of showing a
  stale coordinate after the pointer leaves the globe (fixed on both renderers).
- `?static=1` no longer lets a configured `CESIUM_ION_TOKEN` trigger network
  calls into the classic renderer's `tilesSystem.ts` — deterministic test runs
  must not depend on network access, token validity, or ion quota.
- 14 accuracy/completeness issues found by an independent documentation audit
  (wrong diagram precedence, mislabeled file paths, incorrect ER cardinality,
  misattributed sequence-diagram participants, and an understated auth gap)
  were corrected in `docs/ui-guide.md` and `docs/architecture.md`.
- The two file pickers in the Import & export panel (KML/GeoJSON/story files,
  and photos/video) were unnamed, focusable inputs: axe `label` (critical) and
  two redundant tab stops, one ahead of each picker button (Chromium named them
  "Choose File" from its own default text, so a screen reader heard a duplicate
  of the real button). The hidden inputs now carry `tabindex="-1"` and
  `aria-hidden="true"`; the buttons that open them are the controls.

### Changed
- Product renamed from **Companion Earth** to **Companion Atlas** throughout
  the viewer (page title, sidebar header), package metadata, and agent-facing
  docs. The GitHub repository itself was renamed from `CI-Earth` to
  `Companion-Atlas`. Visual regression baselines were regenerated to match.

## 2026-06-15 — Reimagining: Companion Atlas direction

### Added
- [`REIMAGINE.md`](REIMAGINE.md) — the product direction: turn any image, image
  set, or video into a shareable 4D (3D + time) scrapbook map, created manually
  or automatically via an MCP API, wired into the Companion Intelligence suite.
  Includes a sourced survey of open web GIS viewers recommending CesiumJS as
  the eventual renderer.
- The viewer-agnostic 4D `Story` schema ([`src/atlas/schema.ts`](src/atlas/schema.ts),
  mirrored at [`server/src/schema.ts`](server/src/schema.ts)) and a
  backward-compatible `?story=<url>` loader that renders one on the existing
  globe (`src/atlas/story.ts`, `scrapbookSystem.loadPins()`).
- `server/` — the **Companion Atlas processing server**: an MCP API
  (`atlas_create_story`, `atlas_query_memory`, `atlas_ingest_media`,
  `atlas_auto_compose`, `atlas_publish_story`, and more — see
  [`docs/mcp-api.md`](docs/mcp-api.md)) with REST parity, an image/video → 3D
  reconstruction pipeline scaffold, and connectors for CI-Server memory,
  OpenClaw, and Hermes, authenticated via Companion OIDC.
- Containerization: `Dockerfile` (viewer), `server/Dockerfile` (API),
  `docker/Dockerfile.worker` (GPU reconstruction), and `docker-compose.yml`
  wiring the full stack together with MinIO, Postgres, and Redis.

## Earlier

The repository began as **Companion Earth**, a browser-native three.js globe
built through an iterative "vibe coding" loop (see `WORKFLOW.md`,
`ARCHITECTURE.md`, `GDD.md`): procedural + KTX2-backed Earth rendering, live
imagery layers (hillshade, borders, clouds, weather), optional Google/Cesium
3D Tiles streaming, WebXR support, and the spatial scrapbook system (pin
drops, journeys, account-scoped local persistence) that Companion Atlas's 4D
`Story` model generalizes.
