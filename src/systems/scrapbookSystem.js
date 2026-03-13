import * as THREE from 'three';
import {
  cartesianToLatLon,
  getAccountPins,
  latLonToCartesian,
  loadAllScrapbookData,
  saveAllScrapbookData,
  setAccountPins
} from '../scrapbook.js';

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

    pins.forEach((pin) => {
      const point = latLonToCartesian(pin.lat, pin.lon, sceneConfig.globe.radius + 0.04);
      const isSelected = pin.id === selectedPinId;

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(isSelected ? 0.032 : 0.025, 14, 14),
        new THREE.MeshBasicMaterial({ color: isSelected ? 0xffdb90 : 0xffb86f })
      );

      mesh.position.copy(point);
      pinsGroup.add(mesh);
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
