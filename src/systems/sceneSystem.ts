import * as THREE from 'three';

import { cartesianToLatLon, latLonToCartesian } from '../scrapbook';
import { createAtmosphereMesh } from './atmosphereSystem';
import { createCameraControls } from './cameraControls';
import {
  createCloudTexture,
  createEarthTexture,
  createEarthTileTexture,
  createNightLightsTexture,
  createWeatherTexture
} from './textureFactory';
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

export function createSceneSystem({ mountEl, viewportEl, isStaticMode }: CreateSceneSystemOptions) {
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
  mountEl.appendChild(renderer.domElement);

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  const starRand = seededRandomFactory(42);
  const starGeometry = new THREE.BufferGeometry();
  const starCount = 2200;
  const positions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount * 3; i += 3) {
    const spread = 55;
    positions[i]     = (starRand() - 0.5) * spread;
    positions[i + 1] = (starRand() - 0.5) * spread;
    positions[i + 2] = (starRand() - 0.5) * spread;
  }

  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xc8deff, size: 0.032, sizeAttenuation: true })
  );
  scene.add(stars);

  const earthRand = seededRandomFactory(43);
  const cloudRand = seededRandomFactory(44);
  const cityLightRand = seededRandomFactory(45);
  const weatherRand = seededRandomFactory(46);
  const earthFallbackTexture = createEarthTexture(earthRand);
  const earthTexture = isStaticMode ? earthFallbackTexture : createEarthTileTexture(earthFallbackTexture, 3);
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
      roughness: 0.68,
      metalness: 0.08
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
      opacity: 0.55,
      roughness: 0.9,
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
      opacity: 0.14,
      blending: THREE.AdditiveBlending
    })
  );
  worldGroup.add(weatherLayer);

  const weatherMaterial = weatherLayer.material as THREE.MeshBasicMaterial;

  // Atmosphere GLSL shader (replaces old BackSide glow spheres)
  const atmoSystem = createAtmosphereMesh(sceneConfig.globe.radius);
  worldGroup.add(atmoSystem.mesh);
  const sunDirection = new THREE.Vector3();

  const ambient = new THREE.HemisphereLight(0xc8dbff, 0x071325, 0.72);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffeedd, 1.4);
  sun.position.set(3.8, 1.7, 1.2);
  scene.add(sun);

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
    minRadius: 1.3, maxRadius: 14,
    onTap: (e: PointerEvent) => {
      if (!selectionHandler) return;
      const pinId = pickPinFromViewport(e.clientX, e.clientY);
      if (pinId) selectionHandler(pinId);
    }
  });

  // WebXR
  const xrSystem = createXrSystem(renderer, scene, worldGroup);
  renderer.domElement.addEventListener('xr-squeeze-start', () => controls.zoomIn());

  // 3D Tiles (silently disabled if token absent)
  let tilesSystem: Awaited<ReturnType<typeof initTilesSystem>> = null;
  void initTilesSystem(scene, camera, renderer, sceneConfig.globe.radius).then((sys) => { tilesSystem = sys; });

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

    cloudMaterial.opacity   = THREE.MathUtils.clamp(0.3  + weatherBand * 0.42, 0.25, 0.82);
    weatherMaterial.opacity = THREE.MathUtils.clamp(0.07 + weatherBand * 0.26, 0.07, 0.38);

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
    getHeading: () => controls.getTheta(),
    domElement: renderer.domElement,
    xrButtons:  { vrButton: xrSystem.vrButton, arButton: xrSystem.arButton },
    render
  };
}