# viewer-react — the consolidated Companion Atlas viewer

> **Status: this is the viewer.** These files implement the ADR-0001
> architecture (Resium/Cesium viewer + React-Three-Fiber for WebXR, one `Story`
> model). The vanilla-TS viewer that used to live in `../src` has been removed —
> this app is the only viewer, and the root `npm run dev` / `npm run build` /
> `npm test` drive it.
>
> **Known limitation:** `@companionintelligence/tokens` (imported by
> `src/theme/index.ts`) resolves through the lockfile to a sibling `../ci-common`
> checkout, outside this repository, so `npm run build` and this app's Docker
> image cannot complete in a single-repo checkout. Vitest suites don't touch that
> import and run fine. See `docs/architecture.md` §8.

## Architecture

```
                 @companion-atlas/story  (loadStory, storyToCzml, storyEntities)
                          │
        ┌─────────────────┴──────────────────┐
   desktop / mobile                       headset (immersive-vr)
   CesiumStoryViewer (Resium)             XRStoryScene (R3F + @react-three/xr)
   CZML → Cesium Clock + 3D Tiles         same Story on a three.js globe
```

`rendererForDevice()` picks the renderer; both consume the **same** `Story` from
`@companion-atlas/story`, so there is one data path and one place to add features.

## Files

- `src/story/useStory.ts` — fetch `?story=<url>` → `loadStory` (accepts legacy
  Atlas *and* Earth-2 documents).
- `src/renderers/CesiumStoryViewer.tsx` — Resium `<Viewer>` + `<CzmlDataSource>`
  from `storyToCzml`, plus `<Cesium3DTileset>` per returned tileset. **Intended**
  to give real 4D scrubbing via the CZML clock once built.
- `src/renderers/XRStoryScene.tsx` — R3F `<Canvas><XR>` globe rendering
  `storyEntities(story)` as pins; ports CI-Earth-2's working WebXR path.
- `src/renderers/rendererForDevice.ts` — `immersive-vr` support check → renderer.
- `src/AtlasApp.tsx` — loads the story, switches renderer, shares the story with both.

## Open work

From [`../docs/CONSOLIDATION.md`](../docs/CONSOLIDATION.md):

1. Drive the Cesium `Viewer` clock from the CZML doc packet — real timeline
   scrubbing across scenes (`Story.timeline` → `storyToCzml`).
2. Re-establish visual regression against Resium. The old pixel-diff baselines
   covered the removed vanilla renderer's deterministic `?static=1` path;
   Cesium needs its own deterministic setup (offline imagery, ion disabled,
   locked camera and clock, masked dynamic regions, tolerant
   `maxDiffPixelRatio`). `tests/viewer.capture.ts` is the harness to build on.
3. Publish `@companionintelligence/tokens` to a registry CI and Docker can
   resolve, so `npm run build` and the image work from a clean checkout.
