# Companion Atlas — Consolidation Plan (CI-Earth-2 → Companion-Atlas)

> **Private & Confidential — Property of Lifescope Inc. Do not distribute.**
> Status: **in progress.** Phase 0 (unified schema) is landed and verified in this
> branch. This document is the authoritative plan; it supersedes the divergent
> visions in CI-Earth-2 `docs/VISION.md` and this repo's older `ARCHITECTURE.md`.

## Decision (see [ADR-0001](adr/0001-resium-viewer-r3f-xr.md))

**Companion Atlas is the one repo.** CI-Earth-2 is superseded and will be archived
once its one unique in-flight asset (the live Companion Memory wiring, PR #8) is
migrated here. The consolidated architecture:

- **Viewer:** CesiumJS via **Resium** (React + Cesium) for desktop/mobile.
- **WebXR:** **React-Three-Fiber + `@react-three/xr`** (Cesium has no WebXR),
  rendering the same `Story`.
- **Data model:** one package, **`@companion-atlas/story`** (`packages/story-schema`).
- **Backend:** this repo's single `server/` (Fastify REST + MCP), hardened.
- **Tests:** the union of both suites — Vitest units + Playwright visual
  regression (extended to Cesium) + container smoke + new MCP/E2E/perf/XR tiers.

## What each build contributed (the "best ideas")

| From CI-Earth-2 | From Companion-Atlas |
|---|---|
| React + R3F + `@react-three/xr` **working WebXR** | **CesiumJS default renderer** (WGS84, terrain, 3D Tiles, splats) |
| JSON-Schema discipline + **CZML converter** | `schema:` discriminated `Story` identity + Zod runtime |
| **Vitest** logic-test discipline | **Playwright visual-regression** harness (desktop+mobile×darwin+linux) |
| **Live Companion Memory** integration (PR #8) | Texture (KTX2) pipeline, richest docs, adopted product name + license |

---

## Phase 0 — Unify the data model — **DONE (verified in this branch)**

`packages/story-schema` (`@companion-atlas/story`) is the single source of truth.

- **Zod is canonical**; TS types are inferred; `schema/story.schema.json` is
  **generated** from Zod (`npm run gen:schema`) — no second hand-maintained model.
- The canonical `Story` is a **superset**: keeps Atlas's `schema`,
  `media[]`, `layers[]`; adds Earth-2's typed `items[]`; `photo`/`video` may carry
  a `derived3d` reconstruction link.
- **`normalize.ts`** loads *either* legacy shape: `loadStory(doc)` detects an
  Atlas `Story` or an Earth-2 `Scrapbook`, normalizes vocabulary (`end`→`stop`,
  `caption`→`narrative`, `{lon,lat}`→`{location}`, `items`↔`itemIds`), and
  validates. `storyEntities(story)` merges `items[]` + `media[]`-projected
  entities into one renderable list for both renderers and the CZML converter.
- **`czml.ts`** — `storyToCzml(story)` → `{ czml, tilesets }` for the Cesium
  `Clock` (this closes the "4D isn't actually wired" gap both builds had).
- **`memory.ts`** — `mediaItemsFromMemory()` ports CI-Earth-2's PR #8 CI-Server
  GraphQL query into the canonical `MediaItem` (with null-island rejection).
- **Verification:** `tsc --noEmit` clean; **12/12 Vitest tests** pass — both
  historical sample documents (`sample-pacific-journey.json`,
  `sample-scrapbook.json`) load and round-trip; CZML + memory mappings asserted.

### Phase 0 remaining (small, mechanical)
- [ ] Add root **npm workspaces** (done: `packages/*`, `viewer-react`); run a root
      `npm install` to link the workspace.
- [ ] Replace `server/src/schema.ts` (hand-mirrored Zod) with a re-export:
      `export * from '@companion-atlas/story'` — delete the duplicate types.
- [ ] Replace `src/atlas/schema.ts` + `src/atlas/story.ts`'s loader with
      `loadStory`/`storyToCzml` from the package (the existing vanilla viewer can
      import it too).
- [ ] Delete CI-Earth-2's `packages/scrapbook` (its ideas are merged here).

---

## Phase 1 — Merge the test strategy + stand up the Resium shell

**Tests (adopt both, add the missing tiers):**
- [ ] Keep this repo's **Playwright visual regression**; **extend baselines to the
      default Cesium renderer** (today only the classic three.js path under
      `?static=1` has pixel baselines — the renderer users actually see has none).
- [ ] Add **Vitest** to the repo root for logic (schema already covered; add
      geometry/camera/`storyEntities` and the server's MCP tools + `compose`,
      which have **zero** tests today).
- [ ] Keep CI-Earth-2's **container smoke** screenshot as the GHCR publish gate.

**Resium viewer (`viewer-react/`, scaffolded in this branch):**
- [ ] `npm install`; verify `CesiumStoryViewer` renders `storyToCzml` output with a
      working clock (the **Resium spike** — the single biggest technical risk;
      time-box it first).
- [ ] Port CI-Earth-2's React UI panels (search, scrapbook, timeline scrubber).
- [ ] Keep the existing vanilla-TS viewer shipping until Resium reaches visual
      parity, then remove it (`src/systems/*`, `src/cesium/*`, `src/main.ts`).

---

## Phase 2 — Make "4D" real + WebXR on the same model
- [ ] Drive the Cesium `Viewer` clock from the CZML doc packet — real timeline
      scrubbing across scenes (`Story.timeline` → `storyToCzml`).
- [ ] Bring `XRStoryScene` (R3F) to parity: port CI-Earth-2's grab-to-rotate /
      squeeze-to-zoom locomotion and billboard pins; render `storyEntities`.
- [ ] Add **MCP contract + E2E** tests: `create → query_memory → ingest →
      auto_compose → publish → open ?story=` renders the published share URL.

---

## Phase 3 — Live backend (close the scaffold + security gaps)
Both builds' backends are typed scaffolds with the same holes. Fix them here:
- [ ] **Persistence:** replace `server/src/store.ts` `InMemoryStore` with the
      declared Postgres + Redis (BullMQ) + MinIO (already in `docker-compose.yml`).
- [ ] **Security (blocker):** `server/src/auth.ts` currently **decodes JWTs without
      verifying the signature** (its own header says "DO NOT ship as-is").
      Implement real Companion OIDC verification (issuer/audience/signature) via
      `openid-client` before any non-dev deployment.
- [ ] **Memory connector:** implement `CiMemoryConnector.query()`/`saveStory()`
      (today no-ops) using `mediaItemsFromMemory` — promoting PR #8 from
      frontend-only to the real server path. Also seed → `atlas_query_memory`.
- [ ] Wire the viewer to the API (today it only `fetch`es a published `Story` JSON).

---

## Phase 4 — Reconstruction at scale
- [ ] Wire the GPU worker (`docker/Dockerfile.worker`) to the job queue:
      COLMAP → (OpenDroneMap photogrammetry | Nerfstudio/gsplat) → 3D Tiles /
      `KHR_gaussian_splatting`. `server/src/pipeline.ts` `ingest`/`reconstruct`
      are echo/enqueue stubs today.
- [ ] Implement `atlas_auto_compose` (order media by time → scenes + flights).
- [ ] Hermes/OpenClaw delivery of the share URL.

## Cross-cutting
- [ ] Adopt the **CI canonical UI tokens** (teal `--primary` #0f717a/#abd4d8 +
      Montserrat) in the viewer.
- [ ] Add a **performance-budget** test (GDD: 72–90 Hz, <1.5M tris) and a
      tile-streaming memory-pressure test (the GDD's #1 crash risk) — neither build
      has one.
- [ ] Accessibility + empty/error states; fix the root `package.json` stray
      top-level `jpeg-js` key.

---

## Archiving CI-Earth-2 (sequenced — do NOT archive first)

CI-Earth-2 has an **open PR #8** with the only live Companion Memory work. Order:

1. **Migrate PR #8** — its `parseLocatedPhotos`/GraphQL is already ported to
   `packages/story-schema/src/memory.ts` here; port the frontend photo-pin
   rendering into `viewer-react` (Phase 1). Close PR #8 as *migrated*.
2. **Deprecation notice** — add a README banner + `DEPRECATED.md` on CI-Earth-2
   pointing here (prepared on branch `deprecate/superseded-by-companion-atlas`).
3. **Archive** — `gh repo archive companionintelligence/CI-Earth-2` (reversible;
   makes it read-only). Do this only after steps 1–2 land, so no in-flight work is
   stranded. Keep the repo (history) — do not delete.

## Open decisions (for the team)
1. Resium spike sign-off (gates Phase 1). 2. Backend topology: this repo's single
   `server/` vs CI-Earth-2's `mcp-server` + `processing-server` split (recommend
   single API + separate GPU worker). 3. Hosting: self-hosted MinIO/Postgres vs
   managed (S3/RDS). 4. Where the GPU worker runs.
