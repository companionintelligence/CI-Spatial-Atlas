# Cesium data-source testing

Reproducible capture of every Cesium/imagery data source the viewer can render,
via `tests/demo/cesium.capture.ts` (+ the classic offline set in `demo.capture.ts`).
Goal: track parity with Google Earth across the real streamed sources.

## How the renderer + sources are selected

- `?renderer=cesium|classic` forces the renderer; `?static=1` pins to classic
  (offline, deterministic). Cesium is the default in live mode **when a token is set**.
- Tokens feed the Vite build via `loadEnv('', …)` — set them **either** in a `.env`
  file **or** as shell environment variables:
  - `CESIUM_ION_TOKEN` — free from <https://ion.cesium.com/>
  - `GOOGLE_MAP_PLATFORM` — Google Cloud **Map Tiles API** key
  - `MAPBOX_API_KEY`, `ESRI_API_ID/KEY` — optional imagery providers

## Data-source matrix

| # | Data source | Renderer | Token | Status **without** token (verified) | With token |
|---|---|---|---|---|---|
| 1 | Cesium ion **World Imagery** (photoreal basemap) | cesium | `CESIUM_ION_TOKEN` | ✅ renders — falls back to bundled **Natural Earth II** (`data-cesium-status=ready`) | real global satellite imagery |
| 2 | Cesium ion **World Terrain** (3D relief) | cesium | `CESIUM_ION_TOKEN` | flat ellipsoid | streamed elevation/relief |
| 3 | Cesium **OSM Buildings** (3D) | cesium | `CESIUM_ION_TOKEN` | none | worldwide 3D buildings |
| 4 | **Google Photorealistic 3D Tiles** (the "Google Earth" layer) | classic | `GOOGLE_MAP_PLATFORM` | `data-tiles=disabled` (verified) | photorealistic 3D mesh |
| 5 | Cesium ion **World Terrain** as 3D Tiles (classic path) | classic | `CESIUM_ION_TOKEN` | tiles disabled | terrain tileset |
| 6 | Mapbox / ESRI imagery (classic 2D overlays) | classic | provider keys | provider skipped → OSM/offline | provider tiles |
| 7 | Local procedural + KTX2 textures (offline) | classic `?static=1&imagery=local` | none | ✅ full offline globe | — |

## What's verified now (no tokens)

- **Cesium renderer initialises and reaches `ready`** on the offline Natural Earth II
  basemap — `capture/screenshots/cesium-01-default.png`.
- **Scrapbook works on the Cesium globe** — `PinBuilder` billboards + glowing journey
  route — `cesium-02-pins.png`.
- **Graceful degradation**: the classic 3D-tiles path reports `data-tiles=disabled`
  without a Google key — `cesium-03-tiles-classic.png`.
- Clouds/Weather layer toggles are inert on Cesium (no Cesium equivalent), as designed.

## Run it

```sh
npm install --no-workspaces
npm run textures:build      # once (needs ImageMagick) — or use committed textures
npm run cesium:assets       # copies Cesium runtime assets into public/cesium
# offline set (no tokens):
npx playwright test --config=playwright.capture.config.js
# Cesium set (real sources — export tokens first):
export CESIUM_ION_TOKEN=…   # and/or GOOGLE_MAP_PLATFORM=…
npx playwright test --config=playwright.capture.config.js tests/demo/cesium.capture.ts
```
Screenshots land in `capture/screenshots/`, videos in `capture/results/**/video.webm`.

## Known gaps toward Google-Earth parity

- **Tokens** unlock sources 1–5 above (the bulk of the visual parity).
- **Cesium viewport height** — the Cesium canvas currently renders shorter than the
  full viewport (see `cesium-01-default.png`); the classic renderer fills it. Fix the
  Cesium container to be full-height for a Google-Earth-style edge-to-edge map.
- Still to build (see `docs/CONSOLIDATION.md`): Story→CZML→Cesium `Clock` (real 4D
  scrubbing), Google 3D Tiles under the Cesium renderer (not just classic), and the
  Resium/React viewer.
