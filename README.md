# Companion Atlas

*(formerly Companion Earth; the GitHub repository was renamed from `CI-Earth`
to [`Companion-Atlas`](https://github.com/companionintelligence/Companion-Atlas))*

**Turn any image, set of images, or video into a shareable 4D (3D + time)
scrapbook map.** Companion Atlas is a containerized 3D processing server + web
viewer, built manually or automatically through an **MCP API**, and wired into
the Companion Intelligence suite (CI‑Server memory, OpenClaw, Hermes,
Companion OIDC).

| | |
|---|---|
| **License** | [Commercial Standard License](LICENSE.md) — proprietary, not open source (see [§ License](#license)) |
| **Status** | Active reimagining — see [`REIMAGINE.md`](REIMAGINE.md) for the roadmap |
| **Stack** | TypeScript · React + **Resium/CesiumJS** (desktop + mobile) · React-Three-Fiber + `@react-three/xr` (WebXR) · Fastify + MCP SDK (server) · Docker Compose |

## Documentation

| Doc | What's in it |
|---|---|
| [`REIMAGINE.md`](REIMAGINE.md) | **Start here.** Vision, the open-web-GIS-viewer research behind choosing CesiumJS (now live — see [`docs/architecture.md` §3](docs/architecture.md#3-renderer-selection)), the 4D `Story` data model, architecture, migration roadmap |
| [`docs/adr/0001-resium-viewer-r3f-xr.md`](docs/adr/0001-resium-viewer-r3f-xr.md) | Why one viewer: Resium/Cesium for desktop + mobile, R3F for WebXR |
| [`docs/architecture.md`](docs/architecture.md) | Mermaid diagrams of the system and the viewer module map, renderer selection, the `Story` schema, and the processing server, plus reference tables and the known gaps |
| [`docs/mcp-api.md`](docs/mcp-api.md) | The MCP tool reference for creating and publishing stories, manually or by an agent |
| [`server/README.md`](server/README.md) | Running and extending the processing server |
| [`CHANGELOG.md`](CHANGELOG.md) | Notable changes by version |

## How it fits together

```
media / memory ─▶ ingest ─▶ reconstruct (SfM → mesh | gaussian splat) ─▶ 3D Tiles
   MCP / REST  ─▶ Atlas API ─▶ Story (4D doc) ─▶ publish ─▶ share URL ─▶ Viewer
```

- **Viewer** (`viewer-react/`, this app) — renders a `Story` on a Resium/Cesium
  globe, or the same `Story` in a headset via React-Three-Fiber. `npm run dev`,
  then visit `http://127.0.0.1:4174`.
- **Processing server + MCP API** (`server/`) — see [`server/README.md`](server/README.md).
- **Containerized stack** — `docker compose up viewer atlas-api minio postgres redis`
  (add `--profile gpu up worker` for reconstruction). See [`docker-compose.yml`](docker-compose.yml).
- **4D Story schema** — [`packages/story-schema/`](packages/story-schema)
  (`@companion-atlas/story`, Zod source of truth → generated JSON Schema),
  mirrored in [`server/src/schema.ts`](server/src/schema.ts) (runtime).

## Feature set

- **One viewer, two renderers, one model.** `rendererForDevice()` picks the
  Resium/Cesium globe on desktop and mobile, and the React-Three-Fiber +
  `@react-three/xr` globe on a headset (Cesium has no WebXR). Both read the
  same `Story` from `@companion-atlas/story`, so a feature is added once.
  Force either with `?renderer=cesium` or `?renderer=xr`.
- **Real Cesium ion imagery, terrain, and 3D buildings**, degrading
  independently — with no ion token the globe falls back to Cesium's bundled
  offline Natural Earth II raster rather than going blank.
- **Live Companion Memory integration** — point the viewer at a CI-Server with
  `?memory=<url>` (`&token=`) and it renders your located photos and videos as
  a 4D story, with people, places, weather, and Street View peeks.
- **Spatial scrapbook** — collect memories into a draft, let the Companion
  curate it, and save it back to memory as a shareable story.
- **Timeline playback** — scrub or play the journey in time order, with
  day/night lighting driven off the clock.
- **WebXR** — grab-to-rotate and squeeze-to-zoom locomotion, memory pins, a
  wrist menu, and Street View plates in the headset.
- Load any `companion.atlas/story@1` document via `?story=<url>` — legacy Atlas
  *and* CI-Earth-2 documents both normalize through `loadStory`.
- A containerized processing server (`server/`) exposing the same capability
  as an **MCP API** — `atlas_create_story`, `atlas_ingest_media`,
  `atlas_auto_compose`, `atlas_publish_story`, and more (see
  [`docs/mcp-api.md`](docs/mcp-api.md)).

## Quickstart — local viewer

```sh
npm install
npm run dev
```

Or under [Deno](https://deno.com) (2.9+; `deno.json` mirrors these as tasks,
resolving `npm run <script>` → `deno task <script>` for every package in the
repo — root, `server/`, `packages/story-schema/`, `viewer-react/`):

```sh
deno install
deno task dev
```

Visit `http://127.0.0.1:4174`. With no configuration the viewer renders a
bundled demo story on offline imagery, and says so. To go further, put these in
`.env` (see [`.env.default`](.env.default)):

| Variable | Gets you |
|---|---|
| `VITE_CESIUM_ION_TOKEN` | Real ion World Imagery, World Terrain, OSM Buildings — free from [ion.cesium.com](https://ion.cesium.com/) |
| `VITE_GOOGLE_MAPS_API_KEY` | Photorealistic 3D buildings and Street View peeks |
| `VITE_MAPBOX_TOKEN` | Sharper satellite basemap |
| `VITE_MEMORY_URL` / `VITE_MEMORY_TOKEN` | Your real located memories from CI-Server |

URL params override all of them per load: `?memory=<url>&token=<jwt>` for live
memory, `?story=<url>` for a published story, `?renderer=cesium|xr` to force a
renderer.

> **Note:** clone with `--recurse-submodules`, or run
> `git submodule update --init` afterwards. The design tokens come from
> [CI-Common](https://github.com/companionintelligence/CI-Common), pinned as a
> submodule at `third_party/ci-common` and wired in as an npm workspace, so
> `npm ci` and `npm run build` both work with nothing else on the machine.
> CI-Common is a private repository, so you need access to it.
>
> This used to resolve to a sibling `../ci-common` checkout outside the repo,
> which is why the viewer build and its Docker image could never complete from a
> clean clone. Refresh the pin with
> `git submodule update --remote third_party/ci-common` and commit the new SHA.

## Quickstart — processing server + MCP API

```sh
cd server
npm install
npm run dev          # REST + MCP-over-HTTP on :8787
# or, for a local agent:
npm run mcp:stdio
```

Or under Deno, from the repo root (`server/src` depends on the
`packages/story-schema` workspace package, so `deno install` needs to run
where the workspace is declared):

```sh
deno install
cd server && deno task dev
```

See [`server/README.md`](server/README.md) and [`docs/mcp-api.md`](docs/mcp-api.md).

## Quickstart — full containerized stack

```sh
docker compose up viewer atlas-api minio postgres redis
# add reconstruction (requires an NVIDIA GPU):
docker compose --profile gpu up worker
```

## Developing the viewer

```sh
npm run dev        # schema package + viewer dev server on :4174
npm test           # Vitest across viewer-react, server, and the schema package
npm run build      # tsc --noEmit && vite build
```

`npm test` is the fast gate; `npm run build` is the pre-merge one. See
[`WORKFLOW.md`](WORKFLOW.md).

There is no pixel-diff visual regression suite today — the old one covered the
removed vanilla-TS viewer's deterministic `?static=1` path, and establishing
baselines against Resium is open work (see
[`docs/CONSOLIDATION.md`](docs/CONSOLIDATION.md)).
`viewer-react/tests/*.capture.ts` are Playwright *capture* scripts for docs and
review, not assertions:

```sh
npx playwright install chromium
npx playwright test --config=viewer-react/playwright.capture.config.js
```

## New account session

A local namespace key for scoping scrapbook pins — **not** an authentication
system (Companion OIDC, once wired into the viewer, will replace this; see
[`REIMAGINE.md`](REIMAGINE.md)).

- CLI setup: `npm run account:new -- "my-account"`

## Agent customization files

- `.github/copilot-instructions.md`
- `.github/instructions/vibe-loop.instructions.md`
- `.github/agents/vibe-iteration.agent.md`
- `.github/prompts/vibe-iterate.prompt.md`

These files are configured to support continuous, scoped iterations gated on
`npm test` and `npm run build`.

## License

Companion Atlas is proprietary software distributed under the **Commercial
Standard License** (`CI-Commercial-1.0`) — see [`LICENSE.md`](LICENSE.md). It
is **not** open source: the license does not grant rights to copy, redistribute,
sublicense, or incorporate this software into other products without the
licensor's prior written consent, and no source code rights are implied by
having read access to this repository. The underlying research in
[`REIMAGINE.md`](REIMAGINE.md) surveys open-source tools (CesiumJS, COLMAP,
OpenDroneMap, Nerfstudio, etc.) that Companion Atlas integrates with or is
inspired by — those third-party projects retain their own licenses.

For licensing inquiries or support: [ci.computer/support-faqs](https://ci.computer/support-faqs)
or **team@ci.computer**.
