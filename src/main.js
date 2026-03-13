import * as THREE from 'three';
import './style.css';
import { renderWorkflowList } from './workflow.js';
import {
  cartesianToLatLon,
  getAccountPins,
  latLonToCartesian,
  loadAllScrapbookData,
  renderPinList,
  saveAllScrapbookData,
  setAccountPins
} from './scrapbook.js';

const appEl = document.getElementById('app');
const workflowListEl = document.getElementById('workflow-list');
const accountFormEl = document.getElementById('account-form');
const accountStatusEl = document.getElementById('account-status');
const accountNameInputEl = document.getElementById('account-name');
const scrapbookFormEl = document.getElementById('scrapbook-form');
const pinLabelInputEl = document.getElementById('pin-label');
const pinListEl = document.getElementById('pin-list');

renderWorkflowList(workflowListEl);

let activeAccount = accountNameInputEl.value.trim() || 'earth-operator';
let scrapbookDb = loadAllScrapbookData();
let pins = getAccountPins(scrapbookDb, activeAccount);

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
  window.innerWidth / window.innerHeight,
  sceneConfig.camera.near,
  sceneConfig.camera.far
);
camera.position.copy(sceneConfig.camera.position);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
appEl.appendChild(renderer.domElement);

const starGeometry = new THREE.BufferGeometry();
const starCount = 1800;
const positions = new Float32Array(starCount * 3);

for (let i = 0; i < starCount * 3; i += 3) {
  const spread = 55;
  positions[i] = (Math.random() - 0.5) * spread;
  positions[i + 1] = (Math.random() - 0.5) * spread;
  positions[i + 2] = (Math.random() - 0.5) * spread;
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

const pinsGroup = new THREE.Group();
scene.add(pinsGroup);

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

function renderPinsInScene(currentPins) {
  pinsGroup.clear();

  currentPins.forEach((pin) => {
    const point = latLonToCartesian(pin.lat, pin.lon, sceneConfig.globe.radius + 0.04);

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xffb86f })
    );

    mesh.position.copy(point);
    pinsGroup.add(mesh);
  });
}

renderPinsInScene(pins);
renderPinList(pinListEl, pins);

const isStaticMode = new URLSearchParams(window.location.search).get('static') === '1';

function animate() {
  globe.rotation.y += 0.0015;
  atmosphere.rotation.y += 0.0011;
  orbitRing.rotation.z += 0.0016;
  stars.rotation.y += 0.00008;

  camera.position.x = Math.sin(performance.now() * 0.00035) * 0.18;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

if (isStaticMode) {
  renderer.render(scene, camera);
} else {
  animate();
}

accountFormEl.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = accountNameInputEl.value.trim();
  const accountName = value || 'earth-operator';
  activeAccount = accountName;

  accountNameInputEl.value = accountName;
  accountStatusEl.textContent = `Active account: ${accountName}`;

  scrapbookDb = loadAllScrapbookData();
  pins = getAccountPins(scrapbookDb, activeAccount);
  renderPinsInScene(pins);
  renderPinList(pinListEl, pins);
});

accountStatusEl.textContent = `Active account: ${accountNameInputEl.value.trim() || 'earth-operator'}`;

scrapbookFormEl.addEventListener('submit', (event) => {
  event.preventDefault();

  const labelText = pinLabelInputEl.value.trim() || 'Untitled Memory';
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  const origin = camera.position.clone();
  const raycaster = new THREE.Raycaster(origin, direction.normalize());
  const hit = raycaster.intersectObject(globe, true)[0];

  let worldPoint;
  if (hit) {
    worldPoint = hit.point;
  } else {
    worldPoint = direction.multiplyScalar(-sceneConfig.globe.radius).add(new THREE.Vector3(0, 0, 0));
  }

  const { lat, lon, altitude } = cartesianToLatLon(worldPoint, sceneConfig.globe.radius);

  const pin = {
    id: crypto.randomUUID(),
    label: labelText,
    lat,
    lon,
    altitude,
    createdAt: new Date().toISOString()
  };

  pins = [...pins, pin];
  scrapbookDb = setAccountPins(scrapbookDb, activeAccount, pins);
  saveAllScrapbookData(scrapbookDb);

  renderPinsInScene(pins);
  renderPinList(pinListEl, pins);
});

window.addEventListener('resize', () => {
  const viewportEl = document.getElementById('viewport');
  const width = viewportEl.clientWidth;
  const height = viewportEl.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

const viewportEl = document.getElementById('viewport');
renderer.setSize(viewportEl.clientWidth, viewportEl.clientHeight);
