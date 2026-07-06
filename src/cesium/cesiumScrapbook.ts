/**
 * Cesium-backed scrapbook — the successor to `systems/scrapbookSystem.ts`.
 * Same data model and localStorage persistence (via `scrapbook.ts`, reused
 * unchanged), rendered as Cesium `Entity` pins + a polyline route instead of
 * three.js meshes. Pin icons are built with Cesium's `PinBuilder` for a
 * proper map-pin look instead of the old sphere-and-halo beacons.
 */

import * as Cesium from 'cesium';

import { getAccountPins, loadAllScrapbookData, saveAllScrapbookData, setAccountPins } from '../scrapbook';
import type { Pin, PinUpdates } from '../types';

const PIN_COLOR = Cesium.Color.fromCssColorString('#ffb86f');
const SELECTED_PIN_COLOR = Cesium.Color.fromCssColorString('#ffdb90');
const ROUTE_COLOR = Cesium.Color.fromCssColorString('#7af5ff').withAlpha(0.75);

export interface CesiumScrapbookSystem {
  setActiveAccount: (accountName: string) => void;
  getActiveAccount: () => string;
  getPins: () => Pin[];
  getSelectedPin: () => Pin | null;
  selectPin: (pinId: string) => void;
  loadPins: (nextPins: Pin[]) => void;
  addPinFromLatLon: (lat: number, lon: number, height: number, labelText: string) => void;
  updateSelectedPin: (updates: PinUpdates) => void;
  deleteSelectedPin: () => void;
  getJourneyPins: () => Pin[];
}

export function createCesiumScrapbookSystem(viewer: Cesium.Viewer): CesiumScrapbookSystem {
  const pinBuilder = new Cesium.PinBuilder();
  let scrapbookDb = loadAllScrapbookData();
  let activeAccount = 'earth-operator';
  let pins = getAccountPins(scrapbookDb, activeAccount);
  let selectedPinId = pins[0]?.id || null;

  const pinDataSource = new Cesium.CustomDataSource('scrapbook-pins');
  const routeDataSource = new Cesium.CustomDataSource('scrapbook-route');
  viewer.dataSources.add(pinDataSource);
  viewer.dataSources.add(routeDataSource);

  function persist(): void {
    scrapbookDb = setAccountPins(scrapbookDb, activeAccount, pins);
    saveAllScrapbookData(scrapbookDb);
  }

  function getJourneyPins(): Pin[] {
    return pins.slice().sort((a, b) => new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf());
  }

  async function pinIconDataUrl(color: Cesium.Color): Promise<string> {
    const canvas = await pinBuilder.fromColor(color, 48);
    return canvas.toDataURL();
  }

  function renderPinsInScene(): void {
    pinDataSource.entities.removeAll();
    routeDataSource.entities.removeAll();

    const journeyPins = getJourneyPins();
    if (journeyPins.length >= 2) {
      routeDataSource.entities.add(
        new Cesium.Entity({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(
              journeyPins.flatMap((p) => [p.lon, p.lat, Math.max(p.altitude, 0) + 50])
            ),
            width: 2.5,
            material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: ROUTE_COLOR }),
            clampToGround: false,
            arcType: Cesium.ArcType.GEODESIC
          }
        })
      );
    }

    for (const pin of pins) {
      const isSelected = pin.id === selectedPinId;
      const color = isSelected ? SELECTED_PIN_COLOR : PIN_COLOR;

      void pinIconDataUrl(color).then((image) => {
        pinDataSource.entities.add(
          new Cesium.Entity({
            position: Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, Math.max(pin.altitude, 0)),
            properties: { pinId: pin.id },
            billboard: {
              image,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              scale: isSelected ? 1.15 : 1.0,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
              text: pin.label,
              font: '600 14px "Avenir Next", sans-serif',
              pixelOffset: new Cesium.Cartesian2(0, -52),
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.fromCssColorString('#05122a'),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              show: isSelected
            }
          })
        );
      });
    }
  }

  function setActiveAccount(accountName: string): void {
    activeAccount = accountName;
    scrapbookDb = loadAllScrapbookData();
    pins = getAccountPins(scrapbookDb, activeAccount);
    selectedPinId = pins[0]?.id || null;
    renderPinsInScene();
  }

  function selectPin(pinId: string): void {
    selectedPinId = pinId;
    renderPinsInScene();
  }

  function loadPins(nextPins: Pin[]): void {
    pins = nextPins;
    selectedPinId = pins[0]?.id || null;
    renderPinsInScene();
  }

  function getSelectedPin(): Pin | null {
    return pins.find((pin) => pin.id === selectedPinId) || null;
  }

  function addPinFromLatLon(lat: number, lon: number, height: number, labelText: string): void {
    const pin: Pin = {
      id: crypto.randomUUID(),
      label: labelText || 'Untitled Memory',
      notes: '',
      mediaUrl: '',
      lat,
      lon,
      altitude: Number(height.toFixed(2)),
      createdAt: new Date().toISOString()
    };

    pins = [...pins, pin];
    selectedPinId = pin.id;
    persist();
    renderPinsInScene();
  }

  function updateSelectedPin(updates: PinUpdates): void {
    if (!selectedPinId) return;

    pins = pins.map((pin) =>
      pin.id !== selectedPinId
        ? pin
        : {
            ...pin,
            label: updates.label?.trim() || pin.label,
            notes: updates.notes?.trim() || '',
            mediaUrl: updates.mediaUrl?.trim() || ''
          }
    );

    persist();
    renderPinsInScene();
  }

  function deleteSelectedPin(): void {
    if (!selectedPinId) return;
    pins = pins.filter((pin) => pin.id !== selectedPinId);
    selectedPinId = pins[0]?.id || null;
    persist();
    renderPinsInScene();
  }

  renderPinsInScene();

  return {
    setActiveAccount,
    getActiveAccount: () => activeAccount,
    getPins: () => pins,
    getSelectedPin,
    selectPin,
    loadPins,
    addPinFromLatLon,
    updateSelectedPin,
    deleteSelectedPin,
    getJourneyPins
  };
}
