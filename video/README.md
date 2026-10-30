# Companion Atlas — product video (storyboard only, shots not yet captured)

> **Private & Confidential — Property of Lifescope Inc. Do not distribute.**

`storyboard.json` is the editorial and capture spec for a 16:9 and 9:16 film of the Atlas viewer
(7 scenes, about 51 s, narration committed). **`assets/shots/` is deliberately empty.** A render today
would be placeholder slates, so do not render until the shots below exist.

## Why no shots are committed

The recipes run (`./video/make.sh --no-render` captured 5 of 6 on the GPU Chromium build), but the frames
are not honest enough to ship:

1. **Placeholder place names.** The bundled sample story renders `Unnamed location` and `Unknown place` in the
   map label and memory card on every frame. That reads as a bug and is not a claim we can stand behind.
2. **Disclosed fixture.** The only story that loads without a Companion Memory is the bundled sample
   ("Pacific Crossing, Spring 2026"). Without `?story=` the viewer prints "Demo data - not connected". The
   storyboard says "bundled sample story" in captions; a real run needs a real Memory connection or a
   fixture story whose places resolve.
3. **Hard-coded identity.** The rail avatar is `LB` with the title "Liam Broza" (`viewer-react/src/ui/Shell.tsx`).
4. **Live imagery.** Basemap tiles are fetched at capture time, so byte-stable shots are not expected.
5. **The flat-map shot barely differs** from the globe shot at this zoom; reframe it before capturing.
6. **SwiftShader fails.** The kit's default rasteriser times out on `page.screenshot` (30 s) for the Cesium
   globe at 3840x2160. `capture.config.mjs` sets `launch.channel: "chromium"`, which works but re-rasterises text.

Also: the `flat-map` mobile recipe times out on its click (the projection switch is not on the phone layout),
and `npm ci` fails on `main` because `package-lock.json` is out of sync with `package.json`; `npm install`
without the lockfile needs a GitHub Packages token for the private `@companionintelligence/config`. `stage.sh`
uses `npm install` and leaves the lockfile edit uncommitted.

## Claims, and where each comes from

Every caption/narration line is taken from `README.md` (feature set, "Processing status"), `CHANGELOG.md`
and the viewer's own strings. The film deliberately says the processing server is scaffolded and does not
mention 3D reconstruction. WebXR is not mentioned because it cannot be filmed here.
