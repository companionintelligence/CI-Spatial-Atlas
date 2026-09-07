# viewer-react — the consolidated Companion Atlas viewer

> **Status: this is the viewer.** These files implement the ADR-0001
> architecture (Resium/Cesium viewer + React-Three-Fiber for WebXR, one `Story`
> model). The vanilla-TS viewer that used to live in `../src` has been removed —
> this app is the only viewer, and the root `npm run dev` / `npm run build` /
> `npm test` drive it.
>
> **Builds from a clean checkout.** `@companionintelligence/tokens` is a pinned
> git submodule at `third_party/ci-common` and an npm workspace, so
> `git clone --recurse-submodules` then `npm ci` then `npm run build` works with
> nothing else on the machine. It used to resolve to a sibling `../ci-common`
> path outside the repo, which is why neither the build nor the image could ever
> complete. Update the pin with
> `git submodule update --remote third_party/ci-common` and commit the new SHA.

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
  from `storyToCzml`, plus `<Cesium3DTileset>` per returned tileset. The CZML
  document packet drives the Cesium `Clock`, which `src/ui/TimeMachine.tsx`
  scrubs and `AtlasApp` mirrors into React state — 4D scrubbing is live, not
  intended.
- `src/renderers/XRStoryScene.tsx` — R3F `<Canvas><XR>` globe rendering
  `storyEntities(story)` as pins; ports CI-Earth-2's working WebXR path.
- `src/renderers/rendererForDevice.ts` — `immersive-vr` support check → renderer.
- `src/AtlasApp.tsx` — loads the story, switches renderer, shares the story with both.

## Open work

From [`../docs/CONSOLIDATION.md`](../docs/CONSOLIDATION.md):

1. ~~Drive the Cesium `Viewer` clock from the CZML doc packet~~ — **done.**
   `AtlasApp` applies the story's clock explicitly (`automaticallyTrackDataSourceClocks`
   is off, because the memory layer used to steal `clockTrackedDataSource` and leave
   the viewer a story behind) and the Time Machine reads/writes it. Left here struck
   through rather than deleted: this item outlived its truth by long enough that
   `docs/INTEGRATION.md` was still listing it as remaining work.
2. Re-establish visual regression against Resium. The old pixel-diff baselines
   covered the removed vanilla renderer's deterministic `?static=1` path;
   Cesium needs its own deterministic setup (offline imagery, ion disabled,
   locked camera and clock, masked dynamic regions, tolerant
   `maxDiffPixelRatio`). `tests/viewer.capture.ts` is the harness to build on.
3. Publish `@companionintelligence/tokens` to a registry CI and Docker can
   resolve, so `npm run build` and the image work from a clean checkout.
