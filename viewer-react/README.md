# viewer-react — the consolidated Companion Atlas viewer

> **Status: Resium spike PASSED (2026-07-15).** These files implement the
> ADR-0001 architecture (Resium/Cesium viewer + React-Three-Fiber for WebXR, one
> `Story` model). **Verified:** `tsc --noEmit` clean and `vite build` succeeds —
> Cesium + React + Resium + R3F + `@companion-atlas/story` all compile and bundle
> together; `vite-plugin-cesium` copies the Cesium runtime assets (Assets, Widgets
> incl. `widgets.css`, Workers) so there's no viewport-height issue here. The
> biggest ADR risk (React+Cesium composition) is retired.
>
> **Still to do for parity:** wire the ion token (`Cesium.Ion.defaultAccessToken`),
> port the vanilla viewer's UI panels + scrapbook, and add Playwright visual
> regression — then the vanilla `../src` viewer is removed. The existing vanilla-TS
> viewer remains the shipping viewer until then (`docs/CONSOLIDATION.md`, Phases 1–2).

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
