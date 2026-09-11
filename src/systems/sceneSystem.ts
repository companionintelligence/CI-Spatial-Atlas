import * as THREE from 'three';

import { cartesianToLatLon, latLonToCartesian } from '../scrapbook';
import { createAtmosphereMesh } from './atmosphereSystem';
import { createCameraControls } from './cameraControls';
import {
  createCloudTexture,
  createEarthTexture,
  createEarthTileTexture,
  createNightLightsTexture,
  createOverlayTileTexture,
  createWeatherTexture,
  loadLocalTexturePack
} from './textureFactory';
import { selectHillshadeTileUrl, selectLabelsTileUrl } from './tileProvider';
import { createXrSystem } from './xrSystem';
import { initTilesSystem } from './tilesSystem';

import type { CreateSceneSystemOptions, SceneConfig, ViewportInteractionHandlers } from '../types';

interface EnvironmentState {
  utcTime: string;
  weather: string;
}

function seededRandomFactory(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

export function createSceneSystem({ mountEl, viewportEl, isStaticMode, imageryMode }: CreateSceneSystemOptions) {
  const useLocalSurface = isStaticMode || imageryMode === 'local';
  // 4096px interactive maps are useful on a desktop monitor but needlessly
  // expensive on a phone: eight compressed textures are transcoded before the
  // first stable frame. Use the deterministic 2048px pack on narrow screens;
  // the procedural surface is already visible while those assets arrive, and
  // a reload after rotation will select the appropriate desktop detail.
  const useCompactTextures = isStaticMode || (typeof window !== 'undefined' && window.innerWidth < 768);
  const sceneConfig: SceneConfig = {
    camera: {
      fov: 52,
      near: 0.05,
      far: 8000,
      position: new THREE.Vector3(0, 0.35, 4.2)
    },
    globe: {
      radius: 1.24,
      segments: 128,
      color: 0x2f8df3,
      roughness: 0.9,
      metalness: 0.06
    },
    atmosphere: {
      radius: 1.32,
      color: 0x82d5ff,
      opacity: 0.18
    },
    scrapbook: {
      markerOffset: 0.04,
      markerRadius: 0.026,
      selectedMarkerRadius: 0.034,
      stemRadius: 0.006,
      stemLength: 0.08,
      routeOffset: 0.055,
      routeSegments: 52,
      markerColor: 0xffb86f,
      selectedMarkerColor: 0xffdb90,
      stemColor: 0xffd78e,
      routeColor: 0x7af5ff,
      routeOpacity: 0.72,
      haloColor: 0xfff2ba,
      rotationSpeed: 0.008,
      maxTilt: Math.PI * 0.42,
      idleSpin: 0.0012
    }
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030a18);

  const camera = new THREE.PerspectiveCamera(
    sceneConfig.camera.fov,
    viewportEl.clientWidth / viewportEl.clientHeight,
    sceneConfig.camera.near,
    sceneConfig.camera.far
  );
  camera.position.copy(sceneConfig.camera.position);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(viewportEl.clientWidth, viewportEl.clientHeight);
  // Physically-based render pipeline
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  mountEl.appendChild(renderer.domElement);

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  viewportEl.dataset.imageryMode = useLocalSurface ? 'local' : 'live';
  viewportEl.dataset.localTextures = 'pending';

  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(78, 64, 48),
    new THREE.MeshBasicMaterial({
      color: 0x030915,
      side: THREE.BackSide,
      toneMapped: false
    })
  );
  scene.add(skyDome);

  const starRand = seededRandomFactory(42);
  const starGeometry = new THREE.BufferGeometry();
  const starCount = 1400;
  const positions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount * 3; i += 3) {
    const spread = 42;
    positions[i]     = (starRand() - 0.5) * spread;
    positions[i + 1] = (starRand() - 0.5) * spread;
    positions[i + 2] = (starRand() - 0.5) * spread;
  }

  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xd8e7ff, size: 0.034, sizeAttenuation: true, transparent: true, opacity: 0.38 })
  );
  scene.add(stars);

  const earthRand = seededRandomFactory(43);
  const cloudRand = seededRandomFactory(44);
  const cityLightRand = seededRandomFactory(45);
  const weatherRand = seededRandomFactory(46);
  const earthFallbackTexture = createEarthTexture(earthRand);
  const earthTexture = useLocalSurface ? earthFallbackTexture : createEarthTileTexture(earthFallbackTexture, 3);
  const cloudTexture = createCloudTexture(cloudRand);
  const nightLightsTexture = createNightLightsTexture(earthFallbackTexture, cityLightRand);
  const weatherTexture = createWeatherTexture(weatherRand);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(
      sceneConfig.globe.radius,
      sceneConfig.globe.segments,
      sceneConfig.globe.segments
    ),
    new THREE.MeshStandardMaterial({
      map: earthTexture,
      emissiveMap: nightLightsTexture,
      emissive: new THREE.Color(0xffa84a),
      emissiveIntensity: 0.02,
      roughness: 0.92,
      metalness: 0.02
    })
  );
  worldGroup.add(globe);

  const globeMaterial = globe.material as THREE.MeshStandardMaterial;

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(sceneConfig.globe.radius * 1.007, 96, 96),
    new THREE.MeshStandardMaterial({
      map: cloudTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.42,
      roughness: 0.82,
      metalness: 0
    })
  );
  worldGroup.add(clouds);

  const cloudMaterial = clouds.material as THREE.MeshStandardMaterial;

  const weatherLayer = new THREE.Mesh(
    new THREE.SphereGeometry(sceneConfig.globe.radius * 1.015, 80, 80),
    new THREE.MeshBasicMaterial({
      map: weatherTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.08,
      blending: THREE.AdditiveBlending
    })
  );
  worldGroup.add(weatherLayer);

  const weatherMaterial = weatherLayer.material as THREE.MeshBasicMaterial;

  // ── Overlay layers (hillshade + labels) ──────────────────────────────────
  // Skipped in static mode to keep deterministic test renders.
  let hillshadeLayer: THREE.Mesh | null = null;
  let labelsLayer: THREE.Mesh | null = null;

  if (!isStaticMode) {
    // Terrain hillshade — ESRI Elevation/World_Hillshade. Multiply-blended so
    // shadowed slopes darken the surface and lit slopes are near-identity.
    const hillshadeTexture = createOverlayTileTexture((z, x, y) => selectHillshadeTileUrl(z, x, y));
    hillshadeLayer = new THREE.Mesh(
      new THREE.SphereGeometry(sceneConfig.globe.radius * 1.0015, 96, 96),
      new THREE.MeshBasicMaterial({
        map: hillshadeTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.32,
        blending: THREE.MultiplyBlending
      })
    );
    worldGroup.add(hillshadeLayer);

    // Labels & borders — ESRI World Boundaries and Places. Transparent-PNG tiles
    // overlaid above the cloud layer so country names and borders are always visible.
    const labelsTexture = createOverlayTileTexture((z, x, y) => selectLabelsTileUrl(z, x, y));
    labelsLayer = new THREE.Mesh(
      new THREE.SphereGeometry(sceneConfig.globe.radius * 1.023, 96, 96),
      new THREE.MeshBasicMaterial({
        map: labelsTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.58,
        blending: THREE.NormalBlending
      })
    );
    worldGroup.add(labelsLayer);
  }

  // Atmosphere GLSL shader (replaces old BackSide glow spheres)
  const atmoSystem = createAtmosphereMesh(sceneConfig.globe.radius);
  worldGroup.add(atmoSystem.mesh);
  const sunDirection = new THREE.Vector3();

  const ambient = new THREE.HemisphereLight(0xbfd4ff, 0x040d1c, 0.5);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffefda, 0.98);
  sun.position.set(3.8, 1.7, 1.2);
  scene.add(sun);

  const sunBody = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 28, 28),
    new THREE.MeshBasicMaterial({ color: 0xffcb7f, toneMapped: false })
  );
  scene.add(sunBody);

  const moonBody = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 28, 28),
    new THREE.MeshBasicMaterial({ color: 0xbfc6d9, toneMapped: false })
  );
  scene.add(moonBody);

  const pinsGroup = new THREE.Group();
  worldGroup.add(pinsGroup);

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  const dayCycleMs   = 160000;
  const baseUtcHours = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
  const environmentState: EnvironmentState = { utcTime: '--:-- UTC', weather: 'Calm skies' };

  function setPointerFromViewport(clientX: number, clientY: number): void {
    const bounds = renderer.domElement.getBoundingClientRect();

    pointerNdc.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    pointerNdc.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
  }

  function intersectObjectsAtViewport(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    setPointerFromViewport(clientX, clientY);
    raycaster.setFromCamera(pointerNdc, camera);
    return raycaster.intersectObjects(objects, true);
  }

  function pickPinFromViewport(clientX: number, clientY: number): string | null {
    const hit = intersectObjectsAtViewport(clientX, clientY, [pinsGroup]).find(
      (entry) => typeof entry.object.userData.pinId === 'string'
    );
    return (hit?.object.userData.pinId as string | undefined) ?? null;
  }

  // Selection handler set via bindViewportInteractions
  let selectionHandler: ((pinId: string) => void) | null = null;

  // Camera controls — orbital: camera orbits fixed globe at origin.
  // Initial orbit matches legacy camera position (0, 0.35, 4.2).
  const controls = createCameraControls(camera, renderer.domElement, {
    theta: Math.PI / 2, phi: 0.083, radius: 4.215,
    minRadius: 1.15, maxRadius: 14,
    onTap: (e: PointerEvent) => {
      if (!selectionHandler) return;
      const pinId = pickPinFromViewport(e.clientX, e.clientY);
      if (pinId) selectionHandler(pinId);
    }
  });

  // WebXR
  const xrSystem = createXrSystem(renderer, scene, worldGroup);
  renderer.domElement.addEventListener('xr-squeeze-start', () => controls.zoomIn());

  // 3D Tiles (silently disabled if no token present). Skipped entirely under
  // ?static=1 — a "deterministic" test mode must never make network calls,
  // regardless of whether a token happens to be configured.
  let tilesSystem: Awaited<ReturnType<typeof initTilesSystem>> = null;
  if (!isStaticMode) {
    void initTilesSystem(scene, camera, renderer, sceneConfig.globe.radius, viewportEl).then((sys) => { tilesSystem = sys; });
  }

  void loadLocalTexturePack(renderer, useCompactTextures ? 'static' : 'interactive')
    .then((texturePack) => {
      if (useLocalSurface) {
        globeMaterial.map = texturePack.day;
      }
      globeMaterial.emissiveMap = texturePack.night;
      globeMaterial.normalMap = texturePack.normal;
      globeMaterial.roughnessMap = texturePack.roughness;
      globeMaterial.normalScale.set(0.72, 0.72);
      globeMaterial.needsUpdate = true;

      cloudMaterial.map = null;
      cloudMaterial.alphaMap = texturePack.clouds;
      cloudMaterial.color = new THREE.Color(0xf5f8ff);
      cloudMaterial.needsUpdate = true;

      const skyMaterial = skyDome.material as THREE.MeshBasicMaterial;
      skyMaterial.map = texturePack.sky;
      skyMaterial.needsUpdate = true;

      const sunMaterial = sunBody.material as THREE.MeshBasicMaterial;
      sunMaterial.map = texturePack.sun;
      sunMaterial.needsUpdate = true;

      const moonMaterial = moonBody.material as THREE.MeshBasicMaterial;
      moonMaterial.map = texturePack.moon;
      moonMaterial.needsUpdate = true;

      viewportEl.dataset.localTextures = 'ready';
      render();
    })
    .catch(() => {
      viewportEl.dataset.localTextures = 'error';
    });

  function bindViewportInteractions({ onSelectPin }: ViewportInteractionHandlers): void {
    selectionHandler = onSelectPin ?? null;
  }

  function render(): void {
    renderer.render(scene, camera);
  }

  function resize(): void {
    const width  = viewportEl.clientWidth;
    const height = viewportEl.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function flyToLatLon(
    lat: number,
    lon: number,
    options: { duration?: number; distance?: number } = {}
  ): void {
    const targetRadius = sceneConfig.globe.radius + (options.distance ?? 0.78);
    controls.flyTo(lat, lon, targetRadius, options.duration ?? 1400);
  }

  function update(time: number): void {
    const tDay = isStaticMode ? 0.37 : (time % dayCycleMs) / dayCycleMs;
    const simHours = (baseUtcHours + tDay * 24) % 24;
    const simH = Math.floor(simHours);
    const simM = Math.floor((simHours - simH) * 60);
    environmentState.utcTime = `${String(simH).padStart(2, '0')}:${String(simM).padStart(2, '0')} UTC`;

    const sunTheta = tDay * Math.PI * 2;
    const sunPos = new THREE.Vector3(
      Math.cos(sunTheta) * 4.8,
      Math.sin(sunTheta) * 2.6,
      Math.sin(sunTheta * 0.55) * 2.4
    );
    sun.position.copy(sunPos);
    sunDirection.copy(sunPos).normalize();

    sunBody.position.copy(sunDirection).multiplyScalar(18);
    moonBody.position.copy(sunDirection).multiplyScalar(-14);

    const sunAlt = THREE.MathUtils.clamp((sunPos.y + 2.6) / 5.2, 0, 1);
    ambient.intensity  = 0.38 + sunAlt * 0.55;
    sun.intensity      = 0.42 + sunAlt * 1.45;
    globeMaterial.emissiveIntensity = THREE.MathUtils.clamp(1 - sunAlt * 1.62, 0.02, 0.96);

    atmoSystem.updateSun(sunDirection);
    atmoSystem.updateCamera(camera.position);

    const weatherBand = isStaticMode
      ? 0.46
      : 0.5 + Math.sin(time * 0.00009) * 0.22 + Math.sin(time * 0.000033 + 1.4) * 0.16;

    let weatherLabel = 'Calm skies';
    if      (weatherBand > 0.74) weatherLabel = 'Storm fronts';
    else if (weatherBand > 0.58) weatherLabel = 'Cloudy';
    else if (weatherBand < 0.34) weatherLabel = 'Clear';
    environmentState.weather = weatherLabel;

    cloudMaterial.opacity   = THREE.MathUtils.clamp(0.2  + weatherBand * 0.28, 0.18, 0.55);
    weatherMaterial.opacity = THREE.MathUtils.clamp(0.03 + weatherBand * 0.12, 0.03, 0.16);

    controls.tick(time);
    xrSystem.tick();
    tilesSystem?.update(camera, renderer);
    renderer.render(scene, camera);
  }

  function raycastGlobeFromCamera(): THREE.Vector3 {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const rc  = new THREE.Raycaster(camera.position.clone(), dir.normalize());
    const hit = rc.intersectObject(globe, true)[0];
    return hit ? hit.point : dir.multiplyScalar(sceneConfig.globe.radius);
  }

  function getGlobeCoordAtPointer(
    clientX: number,
    clientY: number
  ): { lat: number; lon: number } | null {
    const hits = intersectObjectsAtViewport(clientX, clientY, [globe]);
    if (hits.length === 0) return null;
    const { lat, lon } = cartesianToLatLon(hits[0].point, sceneConfig.globe.radius);
    return { lat, lon };
  }

  function startLoop(): void {
    if (isStaticMode) { update(performance.now()); return; }
    renderer.setAnimationLoop((time) => update(time));
  }

  function setLayerVisible(layer: 'hillshade' | 'labels' | 'clouds' | 'weather', visible: boolean): void {
    switch (layer) {
      case 'hillshade': if (hillshadeLayer) hillshadeLayer.visible = visible; break;
      case 'labels':    if (labelsLayer)    labelsLayer.visible    = visible; break;
      case 'clouds':    clouds.visible      = visible; break;
      case 'weather':   weatherLayer.visible = visible; break;
    }
  }

  return {
    sceneConfig,
    globe,
    pinsGroup,
    worldGroup,
    bindViewportInteractions,
    pickPinFromViewport,
    startLoop,
    resize,
    flyToLatLon,
    raycastGlobeFromCamera,
    getGlobeCoordAtPointer,
    getEnvironmentState() { return environmentState; },
    zoomIn:     () => controls.zoomIn(),
    zoomOut:    () => controls.zoomOut(),
    getHeading: () => THREE.MathUtils.euclideanModulo(controls.getTheta() - Math.PI / 2, Math.PI * 2),
    getRadius:  () => controls.getRadius(),
    domElement: renderer.domElement,
    xrButtons:  { vrButton: xrSystem.vrButton, arButton: xrSystem.arButton },
    setLayerVisible,
    render
  };
}
