# Companion Atlas documentation

| Doc | What's in it |
|---|---|
| [`architecture.md`](architecture.md) | How it works: mermaid diagrams for the system, the viewer module map, renderer selection, the `Story` data model, and the processing server — plus reference tables (scripts, env vars, Docker services, REST endpoints) and the known gaps |
| [`adr/0001-resium-viewer-r3f-xr.md`](adr/0001-resium-viewer-r3f-xr.md) | Why one viewer: Resium/Cesium for desktop + mobile, React-Three-Fiber for WebXR |
| [`CONSOLIDATION.md`](CONSOLIDATION.md) | The CI-Earth-2 consolidation plan and what is still open on it |
| [`REDESIGN.md`](REDESIGN.md) | What the viewer's UI is trying to be |
| [`INTEGRATION.md`](INTEGRATION.md) | Wiring Atlas to CI-Portal and CI-Server |
| [`mcp-api.md`](mcp-api.md) | The MCP tool reference for creating and publishing stories, manually or by an agent |

Start with [`../REIMAGINE.md`](../REIMAGINE.md) for *why* the product is shaped
this way — the open-web-GIS research, the 4D story concept, and the migration
roadmap. Start with [`architecture.md`](architecture.md) for how the pieces fit.

## Screenshots

There are none right now. The previous set documented the vanilla-TS viewer
that was removed when `viewer-react` became the only viewer, and the capture
script (`scripts/capture-doc-screenshots.ts`) went with it. Recapturing against
the Resium viewer is open work — `viewer-react/tests/viewer.capture.ts` is the
Playwright harness to build it on:

```sh
npx playwright install chromium
npx playwright test --config=viewer-react/playwright.capture.config.js
```
