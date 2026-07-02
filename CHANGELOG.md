# Changelog

Notable changes to Companion Atlas. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); dates are UTC. This project
does not yet follow semantic versioning (`package.json` remains `0.1.0`
pending a first tagged release).

## Unreleased

### Added
- Comprehensive documentation set: [`docs/ui-guide.md`](docs/ui-guide.md)
  (every screen/panel/button, with screenshots), [`docs/architecture.md`](docs/architecture.md)
  (mermaid diagrams + reference tables), and a [`docs/README.md`](docs/README.md) index.
- `scripts/capture-doc-screenshots.ts` (`npm run docs:screenshots`) — regenerates
  the documentation screenshot set against the running dev server.
- `LICENSE.md` reference and an accurate, non-open-source license section in
  the root `README.md`.

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
