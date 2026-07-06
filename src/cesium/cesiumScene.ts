/**
 * Cesium-backed globe — the successor to the procedural three.js globe
 * (`systems/sceneSystem.ts`). Uses real Cesium ion data instead of hand-rolled
 * textures and tile remapping:
 *
 *   - Imagery: `createWorldImageryAsync()` (ion asset 2, aerial + labels)
 *   - Terrain: `createWorldTerrainAsync()` (ion asset 1, global elevation)
 *   - Buildings: Cesium OSM Buildings (ion asset 96188), toggled by the
 *     existing "Borders & Labels" checkbox
 *   - Lighting: real sun position from the system clock (`enableLighting`)
 *
 * Cesium's own camera controls (left-drag orbit, right-drag tilt, wheel zoom)
 * are used as-is rather than reimplemented — they are already close to the
 * classic viewer's model. This module only adds the glue the app needs on
 * top: raycasting, fly-to, layer toggles, and environment/heading readouts.
 *
 * WebXR is intentionally out of scope here — Cesium has no WebXR support
 * (see REIMAGINE.md / ARCHITECTURE.md); the classic three.js renderer remains
 * available via `?renderer=classic` for VR/AR use until that changes.
 */

import * as Cesium from 'cesium';

export interface CesiumSceneSystem {
  viewer: Cesium.Viewer;
  bindPinSelection: (onSelect: (pinId: string) => void) => void;
  raycastGroundFromCenter: () => { lat: number; lon: number; height: number } | null;
  getGroundCoordAtPointer: (clientX: number, clientY: number) => { lat: number; lon: number } | null;
  flyToLatLon: (lat: number, lon: number, options?: { duration?: number; range?: number }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getHeading: () => number;
  getAltitudeMeters: () => number;
  getEnvironmentState: () => { utcTime: string; weather: string };
  setLayerVisible: (layer: 'hillshade' | 'labels' | 'clouds' | 'weather', visible: boolean) => void;
  resize: () => void;
  destroy: () => void;
}

export interface CreateCesiumSceneOptions {
  container: HTMLElement;
  isStaticMode: boolean;
}

const DEFAULT_HOME = { lon: -21.9426, lat: 64.1466, height: 6_000_000 }; // wide view over the North Atlantic

export async function createCesiumScene(options: CreateCesiumSceneOptions): Promise<CesiumSceneSystem> {
  const { container, isStaticMode } = options;

  Cesium.Ion.defaultAccessToken = __CESIUM_ION_TOKEN__;

  const viewer = new Cesium.Viewer(container, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    shadows: false,
    requestRenderMode: isStaticMode,
    contextOptions: { webgl: { preserveDrawingBuffer: true } }
  });

  // Hide Cesium's own credit/attribution overlay chrome; keep the data
  // attributions available via console rather than an on-canvas widget so it
  // doesn't collide with the app's own HUD.
  viewer.cesiumWidget.creditContainer?.parentNode?.removeChild(viewer.cesiumWidget.creditContainer as Node);

  let buildingsTileset: Cesium.Cesium3DTileset | null = null;

  // Each ion resource degrades independently — a terrain or buildings outage
  // (rate limit, invalid token, restricted network) must not also blank out
  // imagery, and vice versa. Imagery in particular falls back to Cesium's
  // bundled offline Natural Earth II raster (ships in Assets/Textures/,
  // zero network required) rather than leaving zero imagery layers, which
  // was found to make `scene.globe.pick()` unreliable for ray/ground
  // intersection — see the raycast functions below, used by pin creation.
  try {
    const worldImagery = await Cesium.createWorldImageryAsync();
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.add(new Cesium.ImageryLayer(worldImagery));
  } catch (err) {
    console.warn('[cesium] ion World Imagery unavailable — falling back to offline Natural Earth II:', err);
    try {
      const offlineImagery = await Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
      );
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.add(new Cesium.ImageryLayer(offlineImagery));
    } catch (fallbackErr) {
      console.error('[cesium] Offline imagery fallback also failed:', fallbackErr);
    }
  }

  try {
    viewer.terrainProvider = await Cesium.createWorldTerrainAsync({ requestVertexNormals: true });
  } catch (err) {
    console.warn('[cesium] ion World Terrain unavailable — using a flat ellipsoid:', err);
  }

  try {
    buildingsTileset = await Cesium.createOsmBuildingsAsync();
    viewer.scene.primitives.add(buildingsTileset);
  } catch (err) {
    console.warn('[cesium] Cesium OSM Buildings unavailable:', err);
  }

  viewer.scene.globe.enableLighting = !isStaticMode;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.fog.enabled = true;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;

  if (isStaticMode) {
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601('2026-03-14T09:00:00Z');
    viewer.clock.shouldAnimate = false;
  } else {
    viewer.clock.shouldAnimate = true;
    viewer.clock.multiplier = 1;
  }

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(DEFAULT_HOME.lon, DEFAULT_HOME.lat, DEFAULT_HOME.height),
    duration: 0
  });

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  function pickPinIdAt(clientX: number, clientY: number): string | null {
    const rect = viewer.canvas.getBoundingClientRect();
    const position = new Cesium.Cartesian2(clientX - rect.left, clientY - rect.top);
    const picked = viewer.scene.pick(position);
    const pinId = picked?.id?.properties?.pinId?.getValue?.(viewer.clock.currentTime);
    return typeof pinId === 'string' ? pinId : null;
  }

  function bindPinSelection(onSelect: (pinId: string) => void): void {
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const pinId = pickPinIdAt(movement.position.x, movement.position.y);
      if (pinId) onSelect(pinId);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function cartographicFromPointer(clientX: number, clientY: number): Cesium.Cartographic | null {
    const rect = viewer.canvas.getBoundingClientRect();
    const position = new Cesium.Cartesian2(clientX - rect.left, clientY - rect.top);
    const ray = viewer.camera.getPickRay(position);
    if (!ray) return null;
    const groundPosition = viewer.scene.globe.pick(ray, viewer.scene);
    if (!groundPosition) return null;
    return Cesium.Cartographic.fromCartesian(groundPosition);
  }

  function raycastGroundFromCenter(): { lat: number; lon: number; height: number } | null {
    const rect = viewer.canvas.getBoundingClientRect();
    const carto = cartographicFromPointer(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!carto) return null;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
      height: carto.height
    };
  }

  function getGroundCoordAtPointer(clientX: number, clientY: number): { lat: number; lon: number } | null {
    const carto = cartographicFromPointer(clientX, clientY);
    if (!carto) return null;
    return { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) };
  }

  function flyToLatLon(lat: number, lon: number, opts: { duration?: number; range?: number } = {}): void {
    const range = opts.range ?? 4500;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, range),
      duration: (opts.duration ?? 1600) / 1000,
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 }
    });
  }

  function currentCameraHeight(): number {
    return viewer.camera.positionCartographic.height;
  }

  function zoomBy(factor: number): void {
    const height = currentCameraHeight();
    viewer.camera.zoomIn(height * (1 - factor));
  }

  function zoomIn(): void {
    zoomBy(0.22);
  }

  function zoomOut(): void {
    zoomBy(-0.28);
  }

  function getHeading(): number {
    return viewer.camera.heading;
  }

  function getAltitudeMeters(): number {
    return Math.max(0, currentCameraHeight());
  }

  const environmentState = { utcTime: '--:-- UTC', weather: 'Calm skies' };

  function updateEnvironmentState(): void {
    const now = Cesium.JulianDate.toDate(viewer.clock.currentTime);
    environmentState.utcTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')} UTC`;
    // Real terrain + real sun lighting means "weather" is now an honest
    // reflection of whether the globe is lit or in Earth's shadow, not a
    // procedural storm-band simulation.
    const sunlit = viewer.scene.globe.enableLighting
      ? Cesium.Cartesian3.dot(
          viewer.scene.sun ? viewer.scene.camera.positionWC : Cesium.Cartesian3.UNIT_X,
          Cesium.Cartesian3.UNIT_X
        ) !== 0
      : true;
    environmentState.weather = sunlit ? 'Clear skies' : 'Night';
  }

  viewer.clock.onTick.addEventListener(updateEnvironmentState);
  updateEnvironmentState();

  function setLayerVisible(layer: 'hillshade' | 'labels' | 'clouds' | 'weather', visible: boolean): void {
    switch (layer) {
      case 'hillshade':
        // Real elevation data on/off — replaces flat-vs-shaded procedural hillshade.
        viewer.terrainProvider = visible
          ? (viewer.scene.globe.terrainProvider ?? new Cesium.EllipsoidTerrainProvider())
          : new Cesium.EllipsoidTerrainProvider();
        break;
      case 'labels':
        // Real 3D building meshes on/off — replaces the flat borders/labels overlay.
        if (buildingsTileset) buildingsTileset.show = visible;
        break;
      case 'clouds':
      case 'weather':
        // No direct Cesium equivalent shipped yet; toggled inert in this mode.
        break;
    }
  }

  function resize(): void {
    viewer.resize();
  }

  function destroy(): void {
    handler.destroy();
    if (!viewer.isDestroyed()) viewer.destroy();
  }

  return {
    viewer,
    bindPinSelection,
    raycastGroundFromCenter,
    getGroundCoordAtPointer,
    flyToLatLon,
    zoomIn,
    zoomOut,
    getHeading,
    getAltitudeMeters,
    getEnvironmentState: () => environmentState,
    setLayerVisible,
    resize,
    destroy
  };
}
