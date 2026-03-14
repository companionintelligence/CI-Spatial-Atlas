import * as THREE from 'three';

import type { Pin, ScrapbookData } from './types';

const STORAGE_KEY = 'ci-earth-scrapbook';

function isPin(value: unknown): value is Pin {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const pin = value as Record<string, unknown>;

  return (
    typeof pin.id === 'string' &&
    typeof pin.label === 'string' &&
    typeof pin.notes === 'string' &&
    typeof pin.mediaUrl === 'string' &&
    typeof pin.lat === 'number' &&
    typeof pin.lon === 'number' &&
    typeof pin.altitude === 'number' &&
    typeof pin.createdAt === 'string'
  );
}

function normalizeScrapbookData(value: unknown): ScrapbookData {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([accountName, pins]) => [
      accountName,
      Array.isArray(pins) ? pins.filter(isPin) : []
    ])
  );
}

export function loadAllScrapbookData(): ScrapbookData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return normalizeScrapbookData(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export function saveAllScrapbookData(data: ScrapbookData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getAccountPins(data: ScrapbookData, accountName: string): Pin[] {
  return Array.isArray(data[accountName]) ? data[accountName] : [];
}

export function setAccountPins(data: ScrapbookData, accountName: string, pins: Pin[]): ScrapbookData {
  return {
    ...data,
    [accountName]: pins
  };
}

export function cartesianToLatLon(position: THREE.Vector3, radius: number): {
  lat: number;
  lon: number;
  altitude: number;
} {
  const unit = position.clone().normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(unit.y));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(unit.z, unit.x));

  return {
    lat,
    lon,
    altitude: Number((position.length() - radius).toFixed(4))
  };
}

export function latLonToCartesian(lat: number, lon: number, radius: number): THREE.Vector3 {
  const latRad = THREE.MathUtils.degToRad(lat);
  const lonRad = THREE.MathUtils.degToRad(lon);

  const x = radius * Math.cos(latRad) * Math.cos(lonRad);
  const y = radius * Math.sin(latRad);
  const z = radius * Math.cos(latRad) * Math.sin(lonRad);

  return new THREE.Vector3(x, y, z);
}

export function renderPinList(listEl: HTMLUListElement, pins: Pin[]): void {
  listEl.innerHTML = '';

  if (pins.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'pin-empty';
    empty.textContent = 'No pins yet. Drop your first memory.';
    listEl.appendChild(empty);
    return;
  }

  pins
    .slice()
    .reverse()
    .forEach((pin) => {
      const item = document.createElement('li');
      item.className = 'pin-item';

      const title = document.createElement('h3');
      title.textContent = pin.label;

      const detail = document.createElement('p');
      const dateLabel = (pin.createdAt || '').slice(0, 10);
      detail.textContent = `${pin.lat.toFixed(2)}, ${pin.lon.toFixed(2)} • ${dateLabel}`;

      if (pin.mediaUrl) {
        const media = document.createElement('p');
        media.textContent = 'Media attached';
        item.appendChild(media);
      }

      item.appendChild(title);
      item.appendChild(detail);
      listEl.appendChild(item);
    });
}