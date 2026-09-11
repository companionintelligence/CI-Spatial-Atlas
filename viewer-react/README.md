# viewer-react — the consolidated Companion Atlas viewer

> **Status: active pre-release viewer (2026-09-03).** This package implements the
> ADR-0001 architecture (Resium/Cesium for desktop and mobile, React-Three-Fiber
> for WebXR, and one shared `Story` model). The shell, search, inspector, time
> machine, map layers, named places, media lightbox, scrapbook, curation,
> download, sanitized sharing, live Memory loading, and in-viewer Memory sign-in
> are implemented and covered by automated checks plus Codex-browser smoke tests.
> The biggest ADR risk (React + Cesium composition) is retired.
>
> This is still a pre-release build: a physical-device matrix, screen-reader
> audit, performance budget, and fully wired Portal OIDC browser flow remain
> open. The embedded Memory sign-in is a recovery path for a connected CI-Server;
> `src/auth/portal.ts` remains the Portal Authorization Code + PKCE scaffold.

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
  from `storyToCzml`, plus `<Cesium3DTileset>` per returned tileset. Drives the
  desktop/mobile globe and its 4D clock.
- `src/renderers/XRStoryScene.tsx` — R3F `<Canvas><XR>` globe rendering
  `storyEntities(story)` as pins; ports CI-Earth-2's working WebXR path.
- `src/renderers/rendererForDevice.ts` — `immersive-vr` support check → renderer.
- `src/AtlasApp.tsx` — loads the story, switches renderer, owns the shell state,
  and shares the story with both renderers.
- `src/memory/auth.ts` — obtains a short-lived CI-Server bearer after the
  in-viewer sign-in flow and keeps it scoped to the browser tab and Memory URL.
- `src/ui/StoryLoadError.tsx` — separates authentication failures from empty and
  unavailable stories and provides sign-in/retry recovery.

## Next steps to make it real (from `docs/CONSOLIDATION.md`)

1. `npm install` (adds cesium, resium, react, @react-three/fiber, @react-three/xr).
2. Set `VITE_DEV_MEMORY_PROXY` when using the same-origin local Memory gateway and
   load `?memory=/memory`; the error state can sign in when the bearer is absent
   or expired.
3. Configure Portal's public `companion-atlas` client before enabling the
   production OIDC redirect flow; the browser PKCE module is present but not yet
   wired into the shell.
4. Add repeatable browser visual-regression projects and physical-device runs to
   release CI. Current screenshots and runtime smoke evidence are documented in
   `CI-Docs`.
