import * as THREE from 'three';
import {
  cartesianToLatLon,
  getAccountPins,
  latLonToCartesian,
  loadAllScrapbookData,
  saveAllScrapbookData,
  setAccountPins
} from '../scrapbook.js';

function createPinMarker(pin, sceneConfig, isSelected) {
  const visuals = sceneConfig.scrapbook;
  const normal = latLonToCartesian(pin.lat, pin.lon, 1).normalize();
  const anchorPoint = latLonToCartesian(pin.lat, pin.lon, sceneConfig.globe.radius);
  const stemLength = visuals.stemLength + Math.max(pin.altitude || 0, 0) * 0.08;
  const markerRadius = isSelected ? visuals.selectedMarkerRadius : visuals.markerRadius;
  const markerPoint = anchorPoint
    .clone()
    .add(normal.clone().multiplyScalar(visuals.markerOffset + stemLength));

  const group = new THREE.Group();

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(visuals.stemRadius, visuals.stemRadius, stemLength, 10),
    new THREE.MeshBasicMaterial({ color: visuals.stemColor, transparent: true, opacity: 0.9 })
  );
  stem.position.copy(anchorPoint).add(normal.clone().multiplyScalar((visuals.markerOffset + stemLength) * 0.5));
  stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  group.add(stem);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(markerRadius, 18, 18),
    new THREE.MeshBasicMaterial({
      color: isSelected ? visuals.selectedMarkerColor : visuals.markerColor
    })
  );
  beacon.position.copy(markerPoint);
  group.add(beacon);

  if (isSelected) {
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(markerRadius * 1.7, markerRadius * 0.2, 12, 36),
      new THREE.MeshBasicMaterial({
        color: visuals.haloColor,
        transparent: true,
        opacity: 0.85
      })
    );
    halo.position.copy(markerPoint);
    halo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    group.add(halo);
  }

  return group;
}

function createJourneyRoute(pins, sceneConfig) {
  if (pins.length < 2) {
    return null;
  }

  const visuals = sceneConfig.scrapbook;
  const controlPoints = pins.map((pin) =>
    latLonToCartesian(pin.lat, pin.lon, sceneConfig.globe.radius + visuals.routeOffset)
  );
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal');
  const sampledPoints = curve.getPoints(Math.max(visuals.routeSegments, controlPoints.length * 18));
  const geometry = new THREE.BufferGeometry().setFromPoints(sampledPoints);

  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: visuals.routeColor,
      transparent: true,
      opacity: visuals.routeOpacity
    })
  );
}

export function createScrapbookSystem({ sceneConfig, pinsGroup }) {
  let scrapbookDb = loadAllScrapbookData();
  let activeAccount = 'earth-operator';
  let pins = getAccountPins(scrapbookDb, activeAccount);
  let selectedPinId = pins[0]?.id || null;

  function persist() {
    scrapbookDb = setAccountPins(scrapbookDb, activeAccount, pins);
    saveAllScrapbookData(scrapbookDb);
  }

  function setActiveAccount(accountName) {
    activeAccount = accountName;
    scrapbookDb = loadAllScrapbookData();
    pins = getAccountPins(scrapbookDb, activeAccount);
    selectedPinId = pins[0]?.id || null;
    renderPinsInScene();
  }

  function selectPin(pinId) {
    selectedPinId = pinId;
    renderPinsInScene();
  }

  function getSelectedPin() {
    return pins.find((pin) => pin.id === selectedPinId) || null;
  }

  function addPinFromWorldPoint(worldPoint, labelText) {
    const { lat, lon, altitude } = cartesianToLatLon(worldPoint, sceneConfig.globe.radius);

    const pin = {
      id: crypto.randomUUID(),
      label: labelText || 'Untitled Memory',
      notes: '',
      mediaUrl: '',
      lat,
      lon,
      altitude,
      createdAt: new Date().toISOString()
    };

    pins = [...pins, pin];
    selectedPinId = pin.id;
    persist();
    renderPinsInScene();
  }

  function updateSelectedPin(updates) {
    if (!selectedPinId) {
      return;
    }

    pins = pins.map((pin) => {
      if (pin.id !== selectedPinId) {
        return pin;
      }

      return {
        ...pin,
        label: updates.label?.trim() || pin.label,
        notes: updates.notes?.trim() || '',
        mediaUrl: updates.mediaUrl?.trim() || ''
      };
    });

    persist();
    renderPinsInScene();
  }

  function deleteSelectedPin() {
    if (!selectedPinId) {
      return;
    }

    pins = pins.filter((pin) => pin.id !== selectedPinId);
    selectedPinId = pins[0]?.id || null;

    persist();
    renderPinsInScene();
  }

  function getPins() {
    return pins;
  }

  function getActiveAccount() {
    return activeAccount;
  }

  function getJourneyPins() {
    return pins.slice().sort((a, b) => new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf());
  }

  function renderPinsInScene() {
    pinsGroup.clear();

    const journeyRoute = createJourneyRoute(getJourneyPins(), sceneConfig);
    if (journeyRoute) {
      pinsGroup.add(journeyRoute);
    }

    pins.forEach((pin) => {
      const isSelected = pin.id === selectedPinId;
      pinsGroup.add(createPinMarker(pin, sceneConfig, isSelected));
    });
  }

  renderPinsInScene();

  return {
    setActiveAccount,
    getActiveAccount,
    getPins,
    getSelectedPin,
    selectPin,
    addPinFromWorldPoint,
    updateSelectedPin,
    deleteSelectedPin,
    getJourneyPins,
    renderPinsInScene
  };
}
