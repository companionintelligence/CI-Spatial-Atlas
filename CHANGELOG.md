# Changelog

Notable changes to Companion Atlas. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); dates are UTC. This project
does not yet follow semantic versioning (`package.json` remains `0.1.0`
pending a first tagged release).

## Unreleased

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
