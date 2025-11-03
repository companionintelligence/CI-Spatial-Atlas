# 🌍 Babylon.js Earth Explorer

A Google Earth-style 3D world explorer built with Babylon.js, featuring real-time 3D tiles, terrain rendering, atmospheric effects, and intuitive navigation controls.

## 🔄 Recent Realism Enhancements

The project now includes:
- PBR Earth globe with albedo + normal maps and environment reflections
- Dynamic day/night cycle updating sun direction & sky scattering
- Atmospheric sky with adjustable Rayleigh/Mie parameters
- Procedural starfield that appears at high altitude or when atmosphere disabled
- Multi-patch procedural terrain using layered trigonometric noise (placeholder for heightmaps)
- Toggleable layers (Terrain, Buildings placeholder, Atmosphere, Globe, Stars)
- Environment cube texture for realistic reflections
- Per-frame altitude-based transition between atmosphere and space view

Planned next steps (high priority):

- Stream real Cesium / 3D Tiles & terrain imagery
- Proper geospatial projection utilities (EPSG:4326 + WebMercator conversions)
- Heightmap & satellite imagery ingestion pipeline
- GPU-based noise / heightmap generation for terrain LOD

## ✨ Features

### 🌐 Google Earth-Style Navigation

- **Smooth Camera Controls**: WASD movement with mouse look, intuitive zoom
- **Earth-Scale Movement**: Automatic speed adjustment based on altitude
- **Geographic Coordinates**: Real latitude/longitude positioning system
- **Smooth Transitions**: Cinematic fly-to animations between locations

### 🗺️ Advanced Mapping Features

- **3D Tiles Integration (stub)**: CesiumJS-inspired tile loading system with procedural placeholder tiles
- **Procedural Terrain**: Multi-octave noise generation for realistic landscapes
- **Dynamic Level of Detail**: Automatic tile resolution based on zoom level
- **Layer Management**: Toggle terrain, buildings, satellite imagery, and labels

### 🎨 Atmospheric Rendering

- **Realistic Sky**: Atmospheric scattering with dynamic sun positioning & day-night cycle
- **Volumetric Lighting**: Directional sunlight with ambient sky illumination
- **Dynamic Shadows**: Real-time shadow generation with soft shadows

### 🏢 3D World Content

- **Procedural Buildings (placeholder)**: Automatic generation of sample structures; ready for replacement with real 3D Tiles
- **Landmark Rendering**: Famous world landmarks with accurate positioning
- **Terrain Features**: Hills, valleys, and geographic formations

## 🚀 Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You should see:

1. A PBR Earth globe centered at origin.
2. Atmospheric sky with moving sun (full day in ~60s).
3. Terrain patches around origin (toggleable) sculpted by pseudo noise.
4. Starfield when you fly far out (>300k units) or disable atmosphere.
5. Layer panel (top-right) for enabling/disabling features.

Main scene code lives in `src/components/WorldExplorer.tsx`. `app/page.tsx` now simply mounts the explorer component.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## ℹ️ Geospatial & Rendering Notes

Current coordinate system is simplistic (world units ≈ meters). Geographic conversion inside camera controller is placeholder. For real Earth-scale accuracy integrate an ellipsoid model and WebMercator / EPSG:4326 conversions.

Terrain & building tiles are procedural. Replace with Cesium or other 3D Tiles source by swapping out the service in `src/services/CesiumIntegration.ts`.

Sky parameters you can tune in `createSkyDome()` inside `WorldExplorer.tsx`:

```ts
skyMaterial.turbidity = 10;
skyMaterial.rayleigh = 3;
skyMaterial.mieCoefficient = 0.004;
skyMaterial.mieDirectionalG = 0.8;
```
 
Lower turbidity for clearer skies; adjust rayleigh for intensity of blue.

Day-night cycle length (demo): 60s in function `updateSunAndAtmosphere()`.

Starfield texture located at Babylon playground URL; replace with custom HDRI for deep space realism.

Environment reflections use prefiltered environment cube (`environment.env`). Replace with higher resolution environment for better specular highlights.

Performance tips:

- Reduce patch subdivisions for low-end devices.
- Increase shadow map size only if needed (currently 2048).
- Avoid unnecessary dynamic disposal/recreation of terrain patches; implement paging.

## ✅ Layer Panel Behavior

| Layer | Effect |
|-------|--------|
| Terrain | Adds procedural ground patches around origin |
| 3D Buildings | (Placeholder) Ready for streamed tiles |
| Atmosphere | Toggles sky scattering & sun updates |
| Earth Globe | Shows/hides PBR planet sphere |
| Stars | Force show/hide starfield independent of altitude |

## 📦 Key Files

- `src/components/WorldExplorer.tsx`: Main explorer logic
- `src/services/CesiumIntegration.ts`: 3D tiles & terrain stub
- `src/controllers/EarthCameraController.ts`: Camera behavior
- `src/app/page.tsx`: Thin wrapper mounting world explorer

## 🧪 Quality Gates

Run TypeScript checks and linting (if configured) to ensure build passes:

```bash
npm run build
npm run lint
```

TypeScript version warning: Current TS (5.8.x) exceeds supported range for `@typescript-eslint` (>=4.3.5 <5.4.0). Downgrade to 5.3.x for full parser support or upgrade ESLint ecosystem when compatibility lands.

## 🗺️ Next Steps

- Integrate real elevation & imagery
- Replace procedural buildings with streaming 3D Tiles
- Add label rendering & UI for search/geocoding
- Implement frustum-based tile loading & caching
- Add fog/atmospheric depth and night city lights
- Curved terrain refinement (current spherical projection is approximate)
- Accurate lat/long/alt HUD (present HUD shows lon/dist/lat; distance is radial magnitude not geodetic altitude)
- Proper Earth ellipsoid model (WGS84) and vertical exaggeration controls
- LayerManager integration for opacity and stacking order instead of ad-hoc state

## ⚠️ Known Issues

| Issue | Description | Planned Fix |
|-------|-------------|-------------|
| Approx spherical terrain | Terrain patches bent downwards; not geodetically accurate | Replace with ellipsoid-projected tiles or real heightmaps |
| Buildings placeholder | Procedural boxes only, no real 3D Tiles | Integrate Cesium Ion / open tiles source |
| Lat/Long math coarse | Uses simple trig on camera position; ignores Earth radius scaling & altitude separation | Implement proper conversion using radius and ellipsoid flattening |
| TypeScript lint warning | Using TS 5.8 outside eslint supported range | Downgrade or await ecosystem update |
| Starfield scaling | Hard-coded altitude threshold; abrupt switch | Fade transition based on altitude & atmosphere density |
| Single-threaded noise | CPU terrain sculpt may stutter | Move to Web Worker or GPU shader |
| No tile cache persistence | Tiles regenerated every session | Add cache & eviction strategy |

## 🛣️ Roadmap (Quartered)

Q1:

- Real elevation + imagery integration
- Stable building tiles streaming
- Geospatial conversion & search UI

Q2:

- Dynamic LOD + frustum culling system
- Atmospheric depth / fog, twilight color grading
- Label/POI system with clustering

Q3:

- Weather layers (cloud cover, precipitation heatmap)
- Night lights emissive maps & time-based city illumination
- Offline prefetch & caching strategy

Q4:

- VR/AR exploration mode
- Photorealistic water materials (oceans, lakes)
- Analytics & performance telemetry overlay

---
Built with Babylon.js • Next.js • TypeScript
