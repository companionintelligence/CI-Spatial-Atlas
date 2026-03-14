import * as THREE from 'three';

const STORAGE_KEY = 'ci-earth-scrapbook';

export function loadAllScrapbookData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveAllScrapbookData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getAccountPins(data, accountName) {
  return Array.isArray(data[accountName]) ? data[accountName] : [];
}

export function setAccountPins(data, accountName, pins) {
  return {
    ...data,
    [accountName]: pins
  };
}

export function cartesianToLatLon(position, radius) {
  const unit = position.clone().normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(unit.y));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(unit.z, unit.x));

  return {
    lat,
    lon,
    altitude: Number((position.length() - radius).toFixed(4))
  };
}

export function latLonToCartesian(lat, lon, radius) {
  const latRad = THREE.MathUtils.degToRad(lat);
  const lonRad = THREE.MathUtils.degToRad(lon);

  const x = radius * Math.cos(latRad) * Math.cos(lonRad);
  const y = radius * Math.sin(latRad);
  const z = radius * Math.cos(latRad) * Math.sin(lonRad);

  return new THREE.Vector3(x, y, z);
}

export function renderPinList(listEl, pins) {
  listEl.innerHTML = '';

  if (pins.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'pin-empty';
    empty.textContent = 'No pins yet. Drop your first memory.';
    listEl.appendChild(empty);
    return;
  }

  pins.slice().reverse().forEach((pin) => {
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
