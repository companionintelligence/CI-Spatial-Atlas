import './style.css';

import { fetchStory, storyToPins } from './atlas/story';
import { createInputSystem } from './systems/inputSystem';
import { createSceneSystem } from './systems/sceneSystem';
import { createScrapbookSystem } from './systems/scrapbookSystem';
import type { ImageryMode, InputElements } from './types';
import { renderWorkflowList } from './workflow';

function getElementByIdOrThrow<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }

  return element as T;
}

function getElementById<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const appEl = getElementByIdOrThrow<HTMLDivElement>('app');
const viewportEl = getElementByIdOrThrow<HTMLElement>('viewport');
const workflowListEl = getElementById<HTMLUListElement>('workflow-list');
const envTimeEl       = getElementById<HTMLElement>('env-time');
const envWeatherEl    = getElementById<HTMLElement>('env-weather');
const envBarTimeEl    = getElementById<HTMLElement>('env-bar-time');
const envBarWeatherEl = getElementById<HTMLElement>('env-bar-weather');
const hudCoordsEl     = getElementById<HTMLElement>('hud-coords');
const envBarAltEl     = getElementById<HTMLElement>('env-bar-alt');
const sidebarOpenBtn  = getElementById<HTMLButtonElement>('sidebar-open');
const sidebarCloseBtn = getElementById<HTMLButtonElement>('sidebar-close');
const controlPanelEl  = getElementById<HTMLElement>('control-panel');
const compassSvgEl    = getElementById<HTMLElement>('compass-svg');
const zoomInBtn       = getElementById<HTMLButtonElement>('zoom-in-btn');
const zoomOutBtn      = getElementById<HTMLButtonElement>('zoom-out-btn');
const xrButtonsEl     = getElementById<HTMLElement>('hud-xr-buttons');

const elements: InputElements = {
  accountFormEl: getElementByIdOrThrow<HTMLFormElement>('account-form'),
  accountNameInputEl: getElementByIdOrThrow<HTMLInputElement>('account-name'),
  accountStatusEl: getElementByIdOrThrow<HTMLParagraphElement>('account-status'),
  scrapbookFormEl: getElementByIdOrThrow<HTMLFormElement>('scrapbook-form'),
  pinLabelInputEl: getElementByIdOrThrow<HTMLInputElement>('pin-label'),
  pinListEl: getElementByIdOrThrow<HTMLUListElement>('pin-list'),
  pinDetailFormEl: getElementByIdOrThrow<HTMLFormElement>('pin-detail-form'),
  pinDetailLabelEl: getElementByIdOrThrow<HTMLInputElement>('pin-detail-label'),
  pinDetailNotesEl: getElementByIdOrThrow<HTMLTextAreaElement>('pin-detail-notes'),
  pinDetailMediaUrlEl: getElementByIdOrThrow<HTMLInputElement>('pin-detail-media-url'),
  pinDeleteBtnEl: getElementByIdOrThrow<HTMLButtonElement>('pin-delete-btn'),
  pinFlyBtnEl: getElementByIdOrThrow<HTMLButtonElement>('pin-fly-btn'),
  journeyStartBtnEl: getElementByIdOrThrow<HTMLButtonElement>('journey-start-btn'),
  journeyStopBtnEl: getElementByIdOrThrow<HTMLButtonElement>('journey-stop-btn'),
  journeyNextBtnEl: getElementByIdOrThrow<HTMLButtonElement>('journey-next-btn'),
  journeyStatusEl: getElementByIdOrThrow<HTMLParagraphElement>('journey-status')
};

if (workflowListEl) {
  renderWorkflowList(workflowListEl);
}

// -------------------------------------------------------------------------
// Sidebar toggle (desktop: width collapse; mobile: bottom-sheet)
// -------------------------------------------------------------------------
function setSidebarCollapsed(collapsed: boolean): void {
  controlPanelEl?.classList.toggle('collapsed', collapsed);
  if (sidebarOpenBtn) {
    sidebarOpenBtn.style.display = collapsed ? 'flex' : 'none';
  }
}

sidebarCloseBtn?.addEventListener('click', () => setSidebarCollapsed(true));
sidebarOpenBtn?.addEventListener('click',  () => setSidebarCollapsed(false));

// On mobile (bottom-sheet mode) start with sidebar hidden so the globe is unobstructed.
if (window.innerWidth < 768) {
  setSidebarCollapsed(true);
}

const searchParams = new URLSearchParams(window.location.search);
const isStaticMode = searchParams.get('static') === '1';

function resolveImageryMode(): ImageryMode {
  const requestedMode = searchParams.get('imagery');
  if (requestedMode === 'local' || requestedMode === 'live') {
    return requestedMode;
  }

  return isStaticMode ? 'local' : 'live';
}

const imageryMode = resolveImageryMode();
const sceneSystem = createSceneSystem({ mountEl: appEl, viewportEl, isStaticMode, imageryMode });
const scrapbookSystem = createScrapbookSystem({
  sceneConfig: sceneSystem.sceneConfig,
  pinsGroup: sceneSystem.pinsGroup
});

// XR buttons into HUD container
if (xrButtonsEl) {
  xrButtonsEl.appendChild(sceneSystem.xrButtons.vrButton);
  xrButtonsEl.appendChild(sceneSystem.xrButtons.arButton);
}

// Zoom HUD buttons
zoomInBtn?.addEventListener('click',  () => sceneSystem.zoomIn());
zoomOutBtn?.addEventListener('click', () => sceneSystem.zoomOut());

// Layer toggle checkboxes
(['hillshade', 'labels', 'clouds', 'weather'] as const).forEach((layer) => {
  const cb = document.getElementById(`layer-${layer}`) as HTMLInputElement | null;
  if (cb) {
    cb.addEventListener('change', () => sceneSystem.setLayerVisible(layer, cb.checked));
  }
});

// Lat/lon readout on pointer move over globe
sceneSystem.domElement.addEventListener('pointermove', (e: PointerEvent) => {
  if (!hudCoordsEl) return;
  const coord = sceneSystem.getGlobeCoordAtPointer(e.clientX, e.clientY);
  if (coord) {
    const latStr = `${Math.abs(coord.lat).toFixed(4)}°${coord.lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(coord.lon).toFixed(4)}°${coord.lon >= 0 ? 'E' : 'W'}`;
    hudCoordsEl.textContent = `${latStr}  ${lonStr}`;
  }
});

sceneSystem.bindViewportInteractions({
  onSelectPin(pinId) {
    scrapbookSystem.selectPin(pinId);
    refreshUI('Pin selected from globe.');
  }
});

let journeyIntervalId: number | null = null;
let journeyIndex = 0;

function flyToPin(pin: ReturnType<typeof scrapbookSystem.getSelectedPin> | null): void {
  if (!pin) {
    return;
  }

  sceneSystem.flyToLatLon(pin.lat, pin.lon, {
    duration: 1400,
    distance: 0.84
  });
}

function stopJourney(): void {
  if (journeyIntervalId !== null) {
    window.clearInterval(journeyIntervalId);
    journeyIntervalId = null;
  }

  refreshUI('Journey idle.');
}

function nextJourneyStop(): void {
  const journeyPins = scrapbookSystem.getJourneyPins();

  if (journeyPins.length === 0) {
    refreshUI('No journey points. Create pins first.');
    return;
  }

  if (journeyIndex >= journeyPins.length) {
    journeyIndex = 0;
  }

  const nextPin = journeyPins[journeyIndex];
  scrapbookSystem.selectPin(nextPin.id);
  flyToPin(nextPin);
  journeyIndex += 1;
  refreshUI(`Journey stop ${journeyIndex}/${journeyPins.length}: ${nextPin.label}`);
}

function startJourney(): void {
  stopJourney();
  journeyIndex = 0;
  nextJourneyStop();
  journeyIntervalId = window.setInterval(nextJourneyStop, 2600);
}

const inputSystem = createInputSystem(elements, {
  onAccountChange(accountName) {
    scrapbookSystem.setActiveAccount(accountName);
    stopJourney();
    refreshUI('Journey idle.');
  },
  onCreatePin(label) {
    const worldPoint = sceneSystem.raycastGlobeFromCamera();
    scrapbookSystem.addPinFromWorldPoint(worldPoint, label);
    refreshUI('Pin created.');
  },
  onSelectPin(pinId) {
    scrapbookSystem.selectPin(pinId);
    refreshUI('Pin selected.');
  },
  onSaveSelectedPin(updates) {
    scrapbookSystem.updateSelectedPin(updates);
    refreshUI('Pin metadata saved.');
  },
  onDeleteSelectedPin() {
    scrapbookSystem.deleteSelectedPin();
    refreshUI('Pin deleted.');
  },
  onFlyToSelectedPin() {
    flyToPin(scrapbookSystem.getSelectedPin());
    refreshUI('Flying to selected pin.');
  },
  onStartJourney() {
    startJourney();
  },
  onStopJourney() {
    stopJourney();
  },
  onNextJourneyStop() {
    nextJourneyStop();
  }
});

function refreshUI(journeyStatus: string): void {
  inputSystem.renderState({
    activeAccount: scrapbookSystem.getActiveAccount(),
    pins: scrapbookSystem.getPins(),
    selectedPin: scrapbookSystem.getSelectedPin(),
    journeyStatus
  });

  const env = sceneSystem.getEnvironmentState();
  if (envTimeEl)       envTimeEl.textContent    = env.utcTime;
  if (envWeatherEl)    envWeatherEl.textContent  = env.weather;
  if (envBarTimeEl)    envBarTimeEl.textContent  = env.utcTime;
  if (envBarWeatherEl) envBarWeatherEl.textContent = env.weather;

  // Rotate compass SVG to match camera heading
  if (compassSvgEl) {
    const headingDeg = (sceneSystem.getHeading() * 180) / Math.PI;
    compassSvgEl.style.transform = `rotate(${-headingDeg}deg)`;
  }
}

refreshUI('Journey idle.');
sceneSystem.startLoop();

// -------------------------------------------------------------------------
// Atlas story mode — `?story=<url>` loads a Companion Atlas 4D story document
// and renders its time-ordered scenes as a scrapbook journey on the globe.
// Inert without the param, so default rendering and visual baselines hold.
// -------------------------------------------------------------------------
const storyUrl = searchParams.get('story');
if (storyUrl) {
  void fetchStory(storyUrl).then((story) => {
    if (!story) {
      refreshUI('Story failed to load.');
      return;
    }

    document.title = `${story.title} · Companion Atlas`;
    scrapbookSystem.loadPins(storyToPins(story));
    refreshUI(`Loaded story: ${story.title}`);

    const first = scrapbookSystem.getSelectedPin();
    if (first) {
      sceneSystem.flyToLatLon(first.lat, first.lon, { duration: 1600, distance: 0.84 });
    }
  });
}

// -------------------------------------------------------------------------
// Live HUD tick — update env-bar and compass independently of pin events
// so time/weather/altitude/heading are always current while orbiting.
// -------------------------------------------------------------------------
const GLOBE_RADIUS_UNITS = sceneSystem.sceneConfig.globe.radius; // 1.24
const EARTH_RADIUS_KM = 6371;
const KM_PER_UNIT = EARTH_RADIUS_KM / GLOBE_RADIUS_UNITS;

function formatAltitude(km: number): string {
  if (km < 1)      return `${Math.round(km * 1000)} m`;
  if (km < 100)    return `${km.toFixed(1)} km`;
  if (km < 10000)  return `${Math.round(km).toLocaleString()} km`;
  return `${(km / 1000).toFixed(1)}k km`;
}

window.setInterval(() => {
  const env = sceneSystem.getEnvironmentState();
  if (envBarTimeEl)    envBarTimeEl.textContent    = env.utcTime;
  if (envBarWeatherEl) envBarWeatherEl.textContent  = env.weather;

  const altKm = Math.max(0, (sceneSystem.getRadius() - GLOBE_RADIUS_UNITS) * KM_PER_UNIT);
  if (envBarAltEl) envBarAltEl.textContent = formatAltitude(altKm);

  if (compassSvgEl) {
    const headingDeg = (sceneSystem.getHeading() * 180) / Math.PI;
    compassSvgEl.style.transform = `rotate(${-headingDeg}deg)`;
  }
}, 200);

window.addEventListener('resize', () => {
  sceneSystem.resize();
});