# viewer-react — the consolidated Companion Atlas viewer (Phase-1 scaffold)

> **Status: scaffold.** These files implement the ADR-0001 architecture
> (Resium/Cesium viewer + React-Three-Fiber for WebXR, one `Story` model) as a
> concrete starting point. They are **not yet built/verified** — `npm install`
> pulls Cesium + React + R3F, which are heavy and not installed in the authoring
> sandbox. The existing vanilla-TS viewer in `../src` remains the shipping viewer
> until this one reaches Playwright visual-regression parity (see
> `docs/CONSOLIDATION.md`, Phases 1–2), at which point the old viewer is removed.

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

## Next steps to make it real (from `docs/CONSOLIDATION.md`)

1. `npm install` (adds cesium, resium, react, @react-three/fiber, @react-three/xr).
2. Wire `npm run cesium:assets` (copy Cesium static assets) into this app's public dir.
3. Port the CI-Earth-2 React UI panels (search, scrapbook, timeline scrubber).
4. Add Playwright visual-regression projects for the Cesium renderer (it has none today).
