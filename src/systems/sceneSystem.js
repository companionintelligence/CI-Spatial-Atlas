import * as THREE from 'three';
import { latLonToCartesian } from '../scrapbook.js';

function seededRandomFactory(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

export function createSceneSystem({ mountEl, viewportEl, isStaticMode }) {
  const sceneConfig = {
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
    }
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050f1f);

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

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(
      sceneConfig.globe.radius,
      sceneConfig.globe.segments,
      sceneConfig.globe.segments
    ),
    new THREE.MeshStandardMaterial({
      color: sceneConfig.globe.color,
      roughness: sceneConfig.globe.roughness,
      metalness: sceneConfig.globe.metalness
    })
  );
  scene.add(globe);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(sceneConfig.atmosphere.radius, 84, 84),
    new THREE.MeshBasicMaterial({
      color: sceneConfig.atmosphere.color,
      transparent: true,
      opacity: sceneConfig.atmosphere.opacity,
      side: THREE.BackSide
    })
  );
  scene.add(atmosphere);

  const orbitRing = new THREE.Mesh(
    new THREE.TorusGeometry(sceneConfig.ring.radius, sceneConfig.ring.tube, 22, 140),
    new THREE.MeshBasicMaterial({ color: sceneConfig.ring.color, transparent: true, opacity: 0.65 })
  );
  orbitRing.rotation.x = Math.PI * 0.43;
  scene.add(orbitRing);

  const ambient = new THREE.HemisphereLight(0xd9f2ff, 0x0b1e38, 0.92);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.35);
  sun.position.set(3.8, 1.9, 1.5);
  scene.add(sun);

  const pinsGroup = new THREE.Group();
  scene.add(pinsGroup);

  const lookTarget = new THREE.Vector3(0, 0, 0);

  let flight = null;

  function render() {
    renderer.render(scene, camera);
  }

  function resize() {
    const width = viewportEl.clientWidth;
    const height = viewportEl.clientHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function flyToLatLon(lat, lon, options = {}) {
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

  function update(time) {
    globe.rotation.y += 0.0014;
    atmosphere.rotation.y += 0.001;
    orbitRing.rotation.z += 0.0015;
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
      lookTarget.set(0, 0, 0);
    }

    camera.lookAt(lookTarget);

    render();
  }

  function raycastGlobeFromCamera() {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    const raycaster = new THREE.Raycaster(camera.position.clone(), direction.normalize());
    const hit = raycaster.intersectObject(globe, true)[0];
    if (hit) {
      return hit.point;
    }

    return direction.multiplyScalar(-sceneConfig.globe.radius);
  }

  function startLoop() {
    if (isStaticMode) {
      update(performance.now());
      return;
    }

    const animate = (time) => {
      update(time);
      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }

  return {
    sceneConfig,
    globe,
    pinsGroup,
    startLoop,
    resize,
    flyToLatLon,
    raycastGlobeFromCamera,
    render
  };
}
