# Companion Atlas — Reimagining CI‑Earth as the Spatial Storytelling Engine

> Status: direction adopted. The product is now **Companion Atlas** — the viewer
> H1, page title, and agent docs have been renamed. Phase 0 scaffolding is in
> this branch; the renderer migration (Phase 2, CesiumJS) is gated on sign‑off
> of that specific piece of this document.

## 1. The reimagining in one paragraph

CI‑Earth today is a hand‑rolled three.js globe with local‑only scrapbook pins.
**Companion Atlas** reimagines it as a product of the Companion Intelligence
suite: a **containerized 3D processing server + web viewer** that turns *any
geodata — a photo, a set of photos, or a video — into a shareable 4D (3D +
time) scrapbook map and storytelling timeline.* Views are created **manually**
by a person or **automatically** by an agent, both through one **MCP API**.
Atlas connects directly to **CI‑Server memory**, **OpenClaw**, and **Hermes**
over MCP, and authenticates with **Companion OIDC**. The output is always the
same portable unit: a `Story` document that any client can render and anyone
can open via a link.

```
  media / memory ─▶ [ ingest ] ─▶ [ reconstruct (SfM → mesh | splat) ] ─▶ [ tile ]
                                                                              │
   MCP / REST  ─▶ [ Atlas API ] ─▶ Story (4D doc) ─▶ [ publish ] ─▶ share URL ─▶ [ Viewer ]
        ▲                              │
   OpenClaw / Hermes            CI‑Server memory (provenance + seed)
```

## 2. What exists today (and what we keep)

| Capability | Today | Disposition |
|---|---|---|
| Renderer | **Done.** Cesium (`src/cesium/`) is the default; bespoke three.js (`src/systems/*`) remains for `?static=1` tests and WebXR | Project `Story` → CZML + `Clock` for full timeline scrubbing (open) |
| 3D Tiles | NASA‑AMMOS `3d-tiles-renderer` (Google/Cesium ion) `tilesSystem.ts`, classic renderer only | Superseded by Cesium's native 3D Tiles/terrain support in the default renderer |
| Scrapbook | localStorage pins per "account" `scrapbookSystem.ts` | **Generalize** into the `Story`/`Scene`/`MediaItem` schema |
| Journeys | `setInterval` auto‑fly between pins (`main.ts`) | **Generalize** into a timeline‑driven clock |
| Accounts | ad‑hoc account name string | **Replace** with Companion OIDC subjects |
| Imagery keys | Mapbox/ESRI/Google/Cesium via Vite `define` | Move server‑side; viewer consumes published tiles |
| Vibe loop | Vite + Playwright visual regression | **Keep** — extend to the Cesium viewer |

The working globe is **not** deleted in Phase 0. The new schema, MCP API,
processing server, and containerization land alongside it, and the viewer gains
a backward‑compatible `?story=<url>` mode that renders a `Story` on today's
globe so the new data model is demonstrable immediately.

## 3. Research — open web GIS viewers (2026)

The brief asks us to research existing open web GIS viewers and decide whether
to replace the current mapping tool. Findings, current as of mid‑2026:

### 3a. 3D globe / planetary viewers

| Viewer | License | Tech | Globe + terrain | 4D / time | 3D Tiles | Gaussian splats | Verdict for Atlas |
|---|---|---|---|---|---|---|---|
| **CesiumJS** | Apache‑2.0 | WebGL | ✅ WGS84, 64‑bit precision | ✅ **CZML + Clock** (native) | ✅ best‑in‑class HLOD | ✅ **3DGS via 3D Tiles (2026)** | **Primary recommendation** |
| **MapLibre GL JS** | BSD‑3 | WebGL (WebGPU WIP) | ✅ globe projection + terrain | partial (feature‑state/filters) | via deck.gl | via deck.gl | Strong alt; best for vector + 2.5D |
| **deck.gl** | MIT | WebGL/WebGPU | layers over a basemap | ✅ `TripsLayer`, time filters | ✅ Tile3DLayer | community layers | Pair with MapLibre/Cesium for big data |
| **iTowns / Giro3D** | CeCILL‑B / MIT | three.js | ✅ | partial | ✅ | emerging | three.js‑native option if we stay on three |
| **three.js + 3d‑tiles‑renderer** (today) | MIT / Apache | WebGL/WebGPU | hand‑rolled | hand‑rolled | ✅ (NASA‑AMMOS) | manual | Status quo; everything is DIY |
| **Potree** | BSD‑2 | WebGL | point clouds | limited | n/a | n/a | Only if point‑cloud‑first |

The independent signal is consistent: for a *true 3D virtual globe with terrain,
precise cartography, time‑dynamic data, and massive‑dataset streaming, CesiumJS
is the de‑facto standard*, and a 2025 FOSS4G performance study found CesiumJS
excels specifically with 3D Tiles while MapLibre wins on lightweight vector
tiles. ([Cesium](https://github.com/CesiumGS/cesium), [FOSS4G 2025](https://talks.osgeo.org/foss4g-2025/talk/9FVHFA/), [Cesium vs deck.gl](https://matom.ai/insights/cesium-vs-deck-gl/))

### 3b. 4D / time‑dynamic & storytelling

- **CesiumJS CZML + `Clock`/`Entity` time availability** is the most mature
  open path to "4D" — every entity can carry time‑tagged positions and
  visibility, and the viewer scrubs/animates them natively. This maps 1:1 onto
  our `Story.timeline` + per‑layer `availability`.
- **deck.gl `TripsLayer`** and time‑filtered layers cover animated paths if we
  go the MapLibre route.
- Scrollytelling templates (scrollama‑based, Mapbox storytelling template) are
  presentation sugar we can layer on either viewer.

### 3c. Image / video → 3D (open, containerizable)

| Tool | Role | Notes (2026) |
|---|---|---|
| **COLMAP** | SfM baseline | Standard camera‑pose + sparse cloud; needs CUDA for real datasets |
| **OpenDroneMap / NodeODM / WebODM** | georeferenced photogrammetry | Leading OSS for aerial/GPS sets; orthomosaics, DEMs, LAZ; **can ingest video by extracting frames**; stable 3.5.6 (Jul 2025) |
| **Meshroom / AliceVision** | photogrammetry mesh | Strong OSS mesh pipeline; CUDA |
| **Nerfstudio + gsplat** | NeRF / Gaussian Splatting | Same SfM front‑end (COLMAP), then splat/NeRF training; headless‑capable |
| **SuperSplat (PlayCanvas)** | splat **viewer/editor** | **Open‑sourced, MIT**; self‑hostable viewer; SplatTransform CLI |

Two 2026 developments make splats first‑class for Atlas: **Khronos shipped the
`KHR_gaussian_splatting` glTF extension (Feb 2026)** and **Cesium added 3D
Gaussian Splats with hierarchical LOD streamed as 3D Tiles (Apr 2026)**. That
means a splat reconstruction can be tiled and streamed by the *same* viewer and
format as everything else. Niantic's **SPZ** (MIT) gives ~90% splat
compression. ([SuperSplat OSS](https://blog.playcanvas.com/supersplat-3dgs-viewer-is-now-open-source/), [Cesium 3DGS LOD](https://cesium.com/blog/2026/04/27/3d-gaussian-splats-lod/), [State of 3DGS 2026](https://www.thefuture3d.com/blog/state-of-gaussian-splatting-2026/), [OpenDroneMap](https://en.wikipedia.org/wiki/OpenDroneMap), [free photogrammetry 2026](https://www.skyebrowse.com/news/posts/free-photogrammetry-software))

### 3d. Recommendation

1. **Replace the hand‑rolled globe with CesiumJS** as the Atlas viewer. It is
   the only open viewer that gives us WGS84 precision, terrain, time‑dynamic
   CZML, 3D Tiles, **and** Gaussian‑splat streaming in one Apache‑2.0 package —
   exactly the four axes Atlas needs. Keep the three.js globe as a lightweight
   embed/fallback.
2. **Processing**: COLMAP for SfM, then **two selectable backends** — OpenDroneMap
   for georeferenced photogrammetry, Nerfstudio/gsplat for Gaussian splats —
   converged to **3D Tiles** (meshes via py3dtiles/3d‑tiles‑tools; splats via
   SplatTransform → `KHR_gaussian_splatting`).
3. **Time/story model**: our viewer‑agnostic `Story` schema, projected onto
   Cesium CZML + `Clock` at render time.

*(The full sourced survey, including the prior internal analysis, lives in
`ARCHITECTURE.md`; this section is the decision layer on top of it.)*

## 4. Target architecture

A containerized system (see `docker-compose.yml`):

- **`viewer`** — the web viewer (today: Vite/three.js served by nginx; Phase 2:
  CesiumJS). Renders a published `Story`. Stateless static bundle.
- **`atlas-api`** — the **3D processing server + MCP API** (`server/`). Node/TS,
  Fastify REST at `/api/*` and the MCP server at `/mcp`. Owns stories, jobs,
  auth, and suite connectors. CPU‑only; orchestrates the worker.
- **`worker`** — GPU reconstruction (`docker/Dockerfile.worker`). Runs
  COLMAP/ODM/Nerfstudio, converts to 3D Tiles, uploads to the object store.
- **`minio`** — S3‑compatible object store for source media + generated tiles
  (served to the viewer like a CDN).
- **`postgres`** + **`redis`** — story metadata + the job queue.

Connectors (`server/src/connectors.ts`):

- **CI‑Server memory** — seed stories from geotagged memories
  (`atlas_query_memory`) and write finished stories back as memories.
- **OpenClaw / Hermes** — suite agents that are **MCP clients of Atlas**; they
  call the tools below to build and deliver stories automatically.
- **Companion OIDC** (`server/src/auth.ts`) — bearer auth for REST + MCP‑HTTP;
  the verified subject scopes every story (replacing ad‑hoc account names).

## 5. The 4D `Story` data model

The portable unit, defined once in `src/atlas/schema.ts` (viewer types) and
mirrored as a Zod runtime schema in `server/src/schema.ts`:

- **`Story`** — id, title, basemap, `timeline`, `media[]`, `layers[]`,
  `scenes[]`, access, provenance.
- **`MediaItem`** — a photo / image‑set / video / pano / splat / model, with
  `location` (WGS84), `capturedAt` (the time axis), `exif`, optional
  `derived3d` (the tiled reconstruction), and `sourceMemoryId` (provenance).
- **`Scene`** — a scrapbook *page* / timeline keyframe: title, markdown
  `narrative`, `time`, a `camera` pose, and the `mediaIds`/`layerIds` it shows.
- **`Timeline`** — start/stop/current/multiplier/loop — the playback clock.
- **`Layer`** — 3D‑tiles / gaussian‑splat / terrain / imagery / geojson with
  optional time `availability`.

Why viewer‑agnostic: the same document renders on CesiumJS (CZML + Clock),
MapLibre + deck.gl (time layers), or today's three.js globe (pins + journey).

## 6. Image / video → 3D pipeline

Implemented as three queued stages (`server/src/pipeline.ts`):

1. **ingest** — EXIF GPS + time from photos; `ffmpeg` frame sampling + GPMF /
   telemetry tracks from video; reverse‑geocode → `MediaItem[]`.
2. **reconstruct** — COLMAP SfM → **photogrammetry** (ODM/OpenMVS) **or**
   **gaussian‑splat** (Nerfstudio/gsplat), selected per job.
3. **tile** — meshes → 3D Tiles (py3dtiles); splats → `KHR_gaussian_splatting`
   3D Tiles (SplatTransform/SOGS) for HLOD streaming.

Georeferenced output is placed at the media's GPS coordinates and attached to
the `MediaItem.derived3d`. `atlas_auto_compose` then orders everything by time
into scenes + camera flights → a shareable story.

## 7. The MCP API (how views get made)

Full reference: [`docs/mcp-api.md`](docs/mcp-api.md). Tools
(`server/src/mcp.ts`):

`atlas_create_story` · `atlas_query_memory` · `atlas_ingest_media` ·
`atlas_get_job` · `atlas_add_scene` · `atlas_set_timeline` · `atlas_add_layer` ·
`atlas_auto_compose` · `atlas_get_story` · `atlas_list_stories` ·
`atlas_publish_story` (+ `story://{id}` resource).

**Automatic** path (one shot): `create_story → query_memory → ingest_media
(reconstruct) → auto_compose → publish_story` returns a share URL. **Manual**
path: a person adds scenes/layers and tweaks the timeline before publishing.

## 8. Migration roadmap

- **Phase 0 — direction + scaffold (this branch).** `Story` schema (viewer +
  server), MCP API + REST + connectors + pipeline scaffold, Docker/compose,
  OIDC stub, and a backward‑compatible `?story=` loader on the existing globe.
  Existing vibe loop stays green; no visual baselines change.
- **Phase 1 — live backend.** Real Postgres/Redis/MinIO, Companion OIDC
  verification, CI‑Server memory connector; viewer loads stories from the API.
- **Phase 2 — CesiumJS viewer. Substantially delivered.** Cesium (ion World
  Imagery + World Terrain + OSM Buildings, `src/cesium/`) is now the default
  live renderer behind `?renderer=cesium|classic` — see
  [`docs/architecture.md` §11](docs/architecture.md#11-cesium-renderer). Still
  open: projecting `Story` → CZML + `Clock` for full timeline scrubbing, and
  Gaussian‑splat layers. three.js remains — not as a deprecated fallback, but
  because `?static=1` visual regression needs a pixel‑diffable renderer and
  WebXR has no Cesium equivalent yet.
- **Phase 3 — reconstruction at scale.** GPU worker live (COLMAP + ODM +
  Nerfstudio), splat → 3D Tiles, `auto_compose`, sharing + Hermes delivery.

## 9. Decisions & open questions

**Decided (recommendation, pending sign‑off):** CesiumJS viewer; viewer‑agnostic
`Story` schema; MCP‑first creation; OIDC subjects replace account names; splats
streamed as 3D Tiles.

**Resolved:** Product name is **Companion Atlas** (the LICENSE separately lists
Hub/Core/Memory/Scan as other suite products — Atlas joins that family). The
GitHub repository itself has been renamed from `CI‑Earth` to
[`Companion-Atlas`](https://github.com/companionintelligence/Companion-Atlas);
the viewer H1, page title, and all agent-facing docs now read "Companion Atlas"
and Playwright baselines are re‑generated against it in this branch.

**Open for the team:**
1. CI‑Server memory contract — MCP tools vs REST, and the memory record shape
   for geotagged media (drives `connectors.ts`).
2. OpenClaw/Hermes exact roles — confirm they should be MCP *clients* of Atlas.
3. Hosting — self‑hosted MinIO/Postgres vs managed (S3/RDS) for production.
4. GPU availability for the worker tier (cost/where it runs).
