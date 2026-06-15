# Companion Earth → Companion Atlas

Companion Earth is a browser-native, Three.js-powered planetary exploration prototype with an iterative vibe coding workflow.

It is being reimagined as **Companion Atlas** — a containerized 3D processing
server + web viewer that turns any image, set of images, or video into a
shareable **4D (3D + time) scrapbook map** and storytelling timeline, created
manually or automatically through an **MCP API** and wired into the Companion
Intelligence suite (CI‑Server memory, OpenClaw, Hermes, Companion OIDC).

**Start here:** [`REIMAGINE.md`](REIMAGINE.md) — vision, the open‑web‑GIS‑viewer
research and recommendation, the 4D `Story` data model, architecture, and the
migration roadmap. The MCP API is documented in [`docs/mcp-api.md`](docs/mcp-api.md).

## Companion Atlas at a glance

```
media / memory ─▶ ingest ─▶ reconstruct (SfM → mesh | gaussian splat) ─▶ 3D Tiles
   MCP / REST  ─▶ Atlas API ─▶ Story (4D doc) ─▶ publish ─▶ share URL ─▶ Viewer
```

- **Viewer** (`src/`, this app) — renders a published `Story`. Open one today on
  the existing globe: `npm run vibe:dev` then visit
  `/?imagery=local&story=/stories/sample-pacific-journey.json`.
- **Processing server + MCP API** (`server/`) — see [`server/README.md`](server/README.md).
- **Containerized stack** — `docker compose up viewer atlas-api minio postgres redis`
  (add `--profile gpu up worker` for reconstruction). See [`docker-compose.yml`](docker-compose.yml).
- **4D Story schema** — [`src/atlas/schema.ts`](src/atlas/schema.ts) (viewer types),
  mirrored in [`server/src/schema.ts`](server/src/schema.ts) (runtime).

## Current Feature Set

- Declarative scene setup for globe rendering
- Selectable local-texture rendering mode with KTX2-backed Earth and sky assets
- Desktop drag-to-rotate globe interaction
- Account session switching
- Spatial scrapbook pin drops rendered as globe beacons
- Direct in-scene scrapbook beacon selection
- Chronological journey routes rendered across scrapbook memories
- Account-scoped local persistence for scrapbook memories
- Deterministic visual regression mode via `/?static=1`

## Iterative Vibe Loop

1. `npm install`
2. `npm run textures:build`
3. `npm run vibe:dev`
4. `npm run vibe:build`
5. `npm run vibe:test`
6. If UI changes are intentional: `npm run vibe:test:update` then `npm run vibe:test`
7. Pre-merge gate: `npm run vibe:loop`

## Texture Assets

- Source masters live in [materials](materials).
- Derived runtime files are generated into [public/textures](public/textures) and [public/basis](public/basis).
- Regenerate the texture set with `npm run textures:build`.
- Static mode defaults to local textured rendering: `/?static=1`.
- Force local textured rendering in normal browsing with `/?imagery=local`.
- Force live provider imagery with `/?imagery=live`.

## New Account Session

- CLI setup: `npm run account:new -- "my-account"`
- In-app setup: use the **New Account** panel and submit.

## Agent Customization Files

- `.github/copilot-instructions.md`
- `.github/instructions/vibe-loop.instructions.md`
- `.github/agents/vibe-iteration.agent.md`
- `.github/prompts/vibe-iterate.prompt.md`

These files are configured to support continuous, scoped iterations with visual stability checks.
