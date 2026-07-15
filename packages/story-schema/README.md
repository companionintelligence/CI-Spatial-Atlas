# @companion-atlas/story

The **canonical 4D `Story` schema** for Companion Atlas — the single source of
truth that consolidates the two prior, divergent data models:

| Prior model | Where | What it was good at |
|---|---|---|
| Companion-Atlas `Story` | `src/atlas/schema.ts` + `server/src/schema.ts` (Zod) | pipeline-centric `media[]` + `layers[]`; schema-discriminated identity |
| CI-Earth-2 `Scrapbook` | `packages/scrapbook` (JSON-Schema-first) | typed `items[]`; a working **CZML converter** |

This package keeps Atlas's `schema: "companion.atlas/story@1"` identity and its
`media[]`/`layers[]`, **adds** Earth-2's typed `items[]`, ports the **CZML
converter**, and provides **normalizers** so a document of *either* legacy shape
loads and validates. The two historical sample documents both round-trip in the
test suite.

## What's inside

- **`schema.ts`** — Zod is the single source of truth; TS types are inferred
  from it; `schema/story.schema.json` (JSON Schema 2020-12) is **generated**
  from it (`npm run gen:schema`) — no second hand-maintained model.
- **`normalize.ts`** — `detectFormat`, `loadStory(unknown)` (detect → normalize
  → validate), `storyEntities(story)` (the merged renderable entity list),
  `timelineBounds`, `normalizeCamera`.
- **`czml.ts`** — `storyToCzml(story)` → `{ czml, tilesets }` for CesiumJS
  `Clock` playback (splats/3D-Tiles returned separately to load as
  `Cesium3DTileset`s). This is what makes "4D" actually wired.
- **`memory.ts`** — `mediaItemsFromMemory(graphqlResult)` + `LOCATED_MEDIA_QUERY`:
  CI-Server Companion Memory → canonical `MediaItem[]` (ported from CI-Earth-2's
  live PR #8 integration — the only working Memory wiring across either build).
- **`validate.ts`** — `validateStory`, `assertStory`.

## Use

```ts
import { loadStory, storyToCzml, storyEntities, mediaItemsFromMemory } from '@companion-atlas/story';

const story = loadStory(await (await fetch(url)).json()); // accepts Atlas OR Earth-2 docs
const { czml, tilesets } = storyToCzml(story);            // → CesiumJS clock + tilesets
```

## Scripts

```sh
npm install
npm test          # vitest: 12 tests — both legacy samples load, CZML + memory mapping
npm run typecheck # tsc --noEmit
npm run build     # → dist/ (js + d.ts)
npm run gen:schema# → schema/story.schema.json from the Zod source
```

## Who consumes this

- **Viewer** (`viewer-react/`) — `loadStory` + `storyToCzml` drive the Resium
  (Cesium) viewer's `Clock`; `storyEntities` feed the R3F/WebXR globe.
- **Server** (`server/`) — replaces the hand-mirrored `server/src/schema.ts`;
  `mediaItemsFromMemory` backs the `atlas_query_memory` connector.

See [`docs/CONSOLIDATION.md`](../../docs/CONSOLIDATION.md) and
[`docs/adr/0001-resium-viewer-r3f-xr.md`](../../docs/adr/0001-resium-viewer-r3f-xr.md).
