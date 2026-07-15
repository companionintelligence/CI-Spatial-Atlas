# ADR 0001 — Resium (React + Cesium) viewer, R3F for WebXR, one Story schema

- **Status:** Accepted (2026-07-14)
- **Context:** Consolidating two parallel builds of the same product — CI-Earth-2
  (React + React-Three-Fiber, working WebXR, Vitest, live Companion Memory
  wiring) and Companion-Atlas (vanilla-TS + CesiumJS default renderer, Playwright
  visual regression, richer docs) — into one repo. Companion-Atlas is the
  canonical home (adopted name, license, Cesium, docs, visual-regression harness).

## Decision

1. **Viewer = CesiumJS via [Resium](https://resium.reearth.io/)** (React bindings
   for Cesium). This keeps Cesium's best-in-class globe (WGS84 precision, terrain,
   native 3D Tiles, CZML `Clock`, Gaussian-splat streaming) **and** gives us React
   component composition — ending the "vanilla DOM vs JSX" fork. It lets us port
   CI-Earth-2's React UI patterns onto the Cesium renderer.

2. **Immersive WebXR = React-Three-Fiber + `@react-three/xr`** (ported from
   CI-Earth-2), because **Cesium has no WebXR**. The XR scene renders the *same*
   `Story` on a three.js globe for headsets. Desktop/mobile use Resium/Cesium; a
   device check selects the renderer. We never attempt to run XR *inside* Cesium.

3. **One data model = `@companion-atlas/story`** (this repo's `packages/story-schema`).
   Zod is the single source of truth; the JSON Schema artifact is generated;
   normalizers load both legacy shapes; a ported CZML converter drives the Cesium
   `Clock`. Both renderers and the server import this one package.

## Why not the alternatives

- **Stay vanilla-TS (Atlas today):** loses React composition and forces a second
  UI stack for XR; the two prior builds already proved the pain of hand-wired DOM.
- **Go all-React-Three-Fiber (Earth-2 today):** loses Cesium's WGS84/terrain/CZML/
  3D-Tiles/splat streaming — we'd re-hand-roll the globe, exactly the DIY trap the
  2026 renderer research told us to escape.
- **Run WebXR inside Cesium:** Cesium exposes no WebXR session API; a custom XR
  camera rig over Cesium is a research project, not a path. R3F already works today.

## Consequences

- Adds React + Resium + Cesium to the viewer; the existing vanilla-TS viewer is
  retained until the Resium viewer reaches visual-regression parity (then removed).
- Two renderers to keep in sync — mitigated by the shared `Story` model + a shared
  entity/CZML layer, and by extending the Playwright baselines to **both** (the
  default Cesium renderer currently has none).
- Biggest risk: React+Cesium composition and the R3F XR boundary. **Mitigation:**
  a time-boxed Resium spike is the first task (see `docs/CONSOLIDATION.md`, Phase 0).
