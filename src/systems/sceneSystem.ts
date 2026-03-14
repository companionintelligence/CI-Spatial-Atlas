import * as THREE from 'three';

import { latLonToCartesian } from '../scrapbook';
import {
  createCloudTexture,
  createEarthTexture,
  createEarthTileTexture,
  createNightLightsTexture,
  createWeatherTexture
} from './textureFactory';

import type { CreateSceneSystemOptions, SceneConfig, ViewportInteractionHandlers } from '../types';

interface FlightState {
  startAt: number;
  duration: number;
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
}

interface DragState {
  active: boolean;
  moved: boolean;
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  selectionHandler: ((pinId: string) => void) | null;
}

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
      near: 0.1,
      far: 8000,
      position: new THREE.Vector3(0, 0.35, 4.2)
    },
    globe: {
      radius: 1.24,
      segments: 120,
      color: 0x2f8df3,
      roughness: 0.9,
      metalness: 0.06
    },
    atmosphere: {
      radius: 1.32,
      color: 0x82d5ff,
      opacity: 0.18
    },
    ring: {
      radius: 1.45,
      tube: 0.02,
      color: 0x93ffe7
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

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(viewportEl.clientWidth, viewportEl.clientHeight);
  mountEl.appendChild(renderer.domElement);

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  const rand = seededRandomFactory(42);
  const starGeometry = new THREE.BufferGeometry();
  const starCount = 1800;
  const positions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount * 3; i += 3) {
    const spread = 55;
    positions[i] = (rand() - 0.5) * spread;
    positions[i + 1] = (rand() - 0.5) * spread;
    positions[i + 2] = (rand() - 0.5) * spread;
  }

  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xb5dbff, size: 0.035, sizeAttenuation: true })
  );
  scene.add(stars);

  const earthRand = seededRandomFactory(43);
  const cloudRand = seededRandomFactory(44);
  const cityLightRand = seededRandomFactory(45);
  const weatherRand = seededRandomFactory(46);
  const earthFallbackTexture = createEarthTexture(earthRand);
  const earthTexture = isStaticMode ? earthFallbackTexture : createEarthTileTexture(earthFallbackTexture, 2);
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
      emissive: new THREE.Color(0xffc46a),
      emissiveIntensity: 0.02,
      roughness: 0.72,
      metalness: 0.11
    })
  );
  worldGroup.add(globe);

  const globeMaterial = globe.material as THREE.MeshStandardMaterial;

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(sceneConfig.globe.radius * 1.006, 80, 80),
    new THREE.MeshStandardMaterial({
      map: cloudTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.58,
      roughness: 0.9,
      metalness: 0
    })
  );
  worldGroup.add(clouds);

  const cloudMaterial = clouds.material as THREE.MeshStandardMaterial;

  const weatherLayer = new THREE.Mesh(
    new THREE.SphereGeometry(sceneConfig.globe.radius * 1.014, 80, 80),
    new THREE.MeshBasicMaterial({
      map: weatherTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.16,
      blending: THREE.AdditiveBlending
    })
  );
  worldGroup.add(weatherLayer);

  const weatherMaterial = weatherLayer.material as THREE.MeshBasicMaterial;

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(sceneConfig.atmosphere.radius, 84, 84),
    new THREE.MeshBasicMaterial({
      color: sceneConfig.atmosphere.color,
      transparent: true,
      opacity: sceneConfig.atmosphere.opacity,
      side: THREE.BackSide
    })
  );
  worldGroup.add(atmosphere);

  const atmosphereMaterial = atmosphere.material as THREE.MeshBasicMaterial;

  const atmosphereGlow = new THREE.Mesh(
    new THREE.SphereGeometry(sceneConfig.atmosphere.radius * 1.06, 84, 84),
    new THREE.MeshBasicMaterial({
      color: 0x5ab8ff,
      transparent: true,
      opacity: 0.09,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  worldGroup.add(atmosphereGlow);

  const ambient = new THREE.HemisphereLight(0xc8dbff, 0x071325, 0.84);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(3.8, 1.7, 1.2);
  scene.add(sun);

  const pinsGroup = new THREE.Group();
  worldGroup.add(pinsGroup);

  const lookTarget = new THREE.Vector3(0, 0, 0);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  const dragState: DragState = {
    active: false,
    moved: false,
    lastX: 0,
    lastY: 0,
    startX: 0,
    startY: 0,
    selectionHandler: null
  };

  let flight: FlightState | null = null;
  const dayCycleMs = 160000;
  const baseUtcHours = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
  const environmentState: EnvironmentState = {
    utcTime: '--:-- UTC',
    weather: 'Calm skies'
  };

  function requestRender(): void {
    camera.lookAt(lookTarget);
    render();
  }

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

    return (hit?.object.userData.pinId as string | undefined) || null;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    dragState.active = true;
    dragState.moved = false;
    dragState.startX = event.clientX;
    dragState.startY = event.clientY;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    renderer.domElement.classList.add('is-dragging');
    renderer.domElement.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragState.active) {
      return;
    }

    const deltaX = event.clientX - dragState.lastX;
    const deltaY = event.clientY - dragState.lastY;
    const movement = Math.abs(event.clientX - dragState.startX) + Math.abs(event.clientY - dragState.startY);

    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;

    if (movement > 4) {
      dragState.moved = true;
    }

    if (!dragState.moved) {
      return;
    }

    flight = null;
    worldGroup.rotation.y += deltaX * sceneConfig.scrapbook.rotationSpeed;
    worldGroup.rotation.x = THREE.MathUtils.clamp(
      worldGroup.rotation.x + deltaY * sceneConfig.scrapbook.rotationSpeed,
      -sceneConfig.scrapbook.maxTilt,
      sceneConfig.scrapbook.maxTilt
    );

    requestRender();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragState.active) {
      return;
    }

    renderer.domElement.classList.remove('is-dragging');
    renderer.domElement.releasePointerCapture(event.pointerId);

    if (!dragState.moved && dragState.selectionHandler) {
      const pinId = pickPinFromViewport(event.clientX, event.clientY);
      if (pinId) {
        dragState.selectionHandler(pinId);
      }
    }

    dragState.active = false;
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!dragState.active) {
      return;
    }

    renderer.domElement.classList.remove('is-dragging');
    renderer.domElement.releasePointerCapture(event.pointerId);
    dragState.active = false;
  }

  function bindViewportInteractions({ onSelectPin }: ViewportInteractionHandlers): void {
    dragState.selectionHandler = onSelectPin || null;

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);
  }

  function render(): void {
    renderer.render(scene, camera);
  }

  function resize(): void {
    const width = viewportEl.clientWidth;
    const height = viewportEl.clientHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function flyToLatLon(lat: number, lon: number, options: { duration?: number; distance?: number } = {}): void {
    const duration = options.duration ?? 1400;
    const distance = options.distance ?? 0.78;

    const point = latLonToCartesian(lat, lon, sceneConfig.globe.radius);
    const normal = point.clone().normalize();

    flight = {
      startAt: performance.now(),
      duration,
      fromPosition: camera.position.clone(),
      fromTarget: lookTarget.clone(),
      toPosition: point.clone().add(normal.multiplyScalar(distance)),
      toTarget: point
    };
  }

  function update(time: number): void {
    const tDay = isStaticMode ? 0.37 : (time % dayCycleMs) / dayCycleMs;
    const simHours = (baseUtcHours + tDay * 24) % 24;
    const simHourInt = Math.floor(simHours);
    const simMinuteInt = Math.floor((simHours - simHourInt) * 60);
    environmentState.utcTime = `${String(simHourInt).padStart(2, '0')}:${String(simMinuteInt).padStart(2, '0')} UTC`;

    const sunTheta = tDay * Math.PI * 2;
    sun.position.set(
      Math.cos(sunTheta) * 4.2,
      Math.sin(sunTheta) * 2.35,
      Math.sin(sunTheta * 0.56) * 2.2
    );
    const sunAltitude = THREE.MathUtils.clamp((sun.position.y + 2.35) / 4.7, 0, 1);
    ambient.intensity = 0.42 + sunAltitude * 0.58;
    sun.intensity = 0.45 + sunAltitude * 1.35;
    globeMaterial.emissiveIntensity = THREE.MathUtils.clamp(1 - sunAltitude * 1.55, 0.02, 0.95);

    const weatherBand = isStaticMode
      ? 0.46
      : 0.5 + Math.sin(time * 0.00009) * 0.22 + Math.sin(time * 0.000033 + 1.4) * 0.16;

    let weatherLabel = 'Calm skies';
    if (weatherBand > 0.74) {
      weatherLabel = 'Storm fronts';
    } else if (weatherBand > 0.58) {
      weatherLabel = 'Cloudy';
    } else if (weatherBand < 0.34) {
      weatherLabel = 'Clear';
    }

    environmentState.weather = weatherLabel;
    const cloudOpacity = THREE.MathUtils.clamp(0.35 + weatherBand * 0.42, 0.3, 0.82);
    cloudMaterial.opacity = cloudOpacity;
    weatherMaterial.opacity = THREE.MathUtils.clamp(0.08 + weatherBand * 0.28, 0.08, 0.42);
    atmosphereMaterial.opacity = THREE.MathUtils.clamp(0.14 + weatherBand * 0.14, 0.12, 0.32);

    globe.rotation.y += 0.0014;
    clouds.rotation.y += 0.0009;
    weatherLayer.rotation.y += 0.0016;
    atmosphere.rotation.y += 0.001;
    stars.rotation.y += 0.00008;

    if (flight) {
      const elapsed = time - flight.startAt;
      const t = Math.min(1, elapsed / flight.duration);
      const eased = t * t * (3 - 2 * t);

      camera.position.lerpVectors(flight.fromPosition, flight.toPosition, eased);
      lookTarget.lerpVectors(flight.fromTarget, flight.toTarget, eased);

      if (t >= 1) {
        flight = null;
      }
    } else if (!isStaticMode) {
      camera.position.x = Math.sin(time * 0.00035) * 0.18;
      worldGroup.rotation.y += sceneConfig.scrapbook.idleSpin;
      lookTarget.set(0, 0, 0);
    }

    camera.lookAt(lookTarget);

    render();
  }

  function raycastGlobeFromCamera(): THREE.Vector3 {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    const cameraRaycaster = new THREE.Raycaster(camera.position.clone(), direction.normalize());
    const hit = cameraRaycaster.intersectObject(globe, true)[0];
    if (hit) {
      return hit.point;
    }

    return direction.multiplyScalar(-sceneConfig.globe.radius);
  }

  function startLoop(): void {
    if (isStaticMode) {
      update(performance.now());
      return;
    }

    const animate = (time: number) => {
      update(time);
      window.requestAnimationFrame(animate);
    };

    window.requestAnimationFrame(animate);
  }

  return {
    sceneConfig,
    globe,
    pinsGroup,
    bindViewportInteractions,
    pickPinFromViewport,
    startLoop,
    resize,
    flyToLatLon,
    raycastGlobeFromCamera,
    getEnvironmentState() {
      return environmentState;
    },
    render
  };
}