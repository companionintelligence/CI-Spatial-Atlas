/**
 * Cesium application bootstrap — the Cesium-renderer counterpart to the
 * classic wiring in `main.ts`. Reuses the renderer-agnostic pieces
 * (`inputSystem.ts`, `scrapbook.ts` storage, `atlas/story.ts`,
 * `journeyController.ts`) and only replaces the three.js-specific rendering
 * layer (`sceneSystem.ts` + `scrapbookSystem.ts`) with Cesium equivalents.
 *
 * WebXR is not available here — Cesium has no WebXR support today. The XR
 * button slot instead links back to `?renderer=classic` for VR/AR use.
 */

import { fetchStory, storyToPins } from '../atlas/story';
import { createInputSystem } from '../systems/inputSystem';
import { createJourneyController } from '../systems/journeyController';
import type { InputElements } from '../types';
import { createCesiumScene, type CesiumSceneSystem } from './cesiumScene';
import { createCesiumScrapbookSystem } from './cesiumScrapbook';

export interface CesiumAppDom {
  appEl: HTMLElement;
  viewportEl: HTMLElement;
  inputElements: InputElements;
  envTimeEl: HTMLElement | null;
  envWeatherEl: HTMLElement | null;
  envBarTimeEl: HTMLElement | null;
  envBarWeatherEl: HTMLElement | null;
  envBarAltEl: HTMLElement | null;
  hudCoordsEl: HTMLElement | null;
  compassSvgEl: HTMLElement | null;
  zoomInBtn: HTMLButtonElement | null;
  zoomOutBtn: HTMLButtonElement | null;
  xrButtonsEl: HTMLElement | null;
  sidebarOpenBtn: HTMLButtonElement | null;
  sidebarCloseBtn: HTMLButtonElement | null;
  controlPanelEl: HTMLElement | null;
}

export interface CesiumAppOptions {
  isStaticMode: boolean;
  storyUrl: string | null;
}

export async function initCesiumApp(dom: CesiumAppDom, options: CesiumAppOptions): Promise<void> {
  const { appEl, viewportEl, inputElements } = dom;

  viewportEl.dataset.renderer = 'cesium';
  viewportEl.dataset.cesiumStatus = 'loading';

  function setSidebarCollapsed(collapsed: boolean): void {
    dom.controlPanelEl?.classList.toggle('collapsed', collapsed);
    if (dom.sidebarOpenBtn) dom.sidebarOpenBtn.style.display = collapsed ? 'flex' : 'none';
  }
  dom.sidebarCloseBtn?.addEventListener('click', () => setSidebarCollapsed(true));
  dom.sidebarOpenBtn?.addEventListener('click', () => setSidebarCollapsed(false));
  if (window.innerWidth < 768) setSidebarCollapsed(true);

  // No WebXR in Cesium mode — point users at the classic renderer instead of
  // silently omitting the buttons they'd expect from the Environment card.
  if (dom.xrButtonsEl) {
    const link = document.createElement('a');
    const classicUrl = new URL(window.location.href);
    classicUrl.searchParams.set('renderer', 'classic');
    link.href = classicUrl.toString();
    link.textContent = 'VR / AR (classic renderer)';
    link.id = 'vr-button';
    dom.xrButtonsEl.appendChild(link);
  }

  let scene: CesiumSceneSystem;
  try {
    scene = await createCesiumScene({ container: appEl, isStaticMode: options.isStaticMode });
    viewportEl.dataset.cesiumStatus = 'ready';
  } catch (err) {
    console.error('[cesium] Failed to initialise viewer:', err);
    viewportEl.dataset.cesiumStatus = 'error';
    return;
  }

  const scrapbook = createCesiumScrapbookSystem(scene.viewer);

  dom.zoomInBtn?.addEventListener('click', () => scene.zoomIn());
  dom.zoomOutBtn?.addEventListener('click', () => scene.zoomOut());

  (['hillshade', 'labels', 'clouds', 'weather'] as const).forEach((layer) => {
    const cb = document.getElementById(`layer-${layer}`) as HTMLInputElement | null;
    if (!cb) return;
    if (layer === 'clouds' || layer === 'weather') {
      cb.disabled = true;
      cb.title = 'Not available in Cesium mode yet — see docs/architecture.md';
      return;
    }
    cb.addEventListener('change', () => scene.setLayerVisible(layer, cb.checked));
  });

  scene.viewer.canvas.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dom.hudCoordsEl) return;
    const coord = scene.getGroundCoordAtPointer(e.clientX, e.clientY);
    if (coord) {
      const latStr = `${Math.abs(coord.lat).toFixed(4)}°${coord.lat >= 0 ? 'N' : 'S'}`;
      const lonStr = `${Math.abs(coord.lon).toFixed(4)}°${coord.lon >= 0 ? 'E' : 'W'}`;
      dom.hudCoordsEl.textContent = `${latStr}  ${lonStr}`;
    } else {
      dom.hudCoordsEl.textContent = '';
    }
  });
  scene.viewer.canvas.addEventListener('pointerleave', () => {
    if (dom.hudCoordsEl) dom.hudCoordsEl.textContent = '';
  });

  scene.bindPinSelection((pinId) => {
    scrapbook.selectPin(pinId);
    refreshUI('Pin selected from globe.');
  });

  function flyToPin(pin: ReturnType<typeof scrapbook.getSelectedPin>): void {
    if (!pin) return;
    scene.flyToLatLon(pin.lat, pin.lon, { duration: 1400, range: 4500 });
  }

  const journey = createJourneyController({
    getJourneyPins: () => scrapbook.getJourneyPins(),
    selectPin: (id) => scrapbook.selectPin(id),
    flyToPin,
    onStatus: (message) => refreshUI(message)
  });

  const inputSystem = createInputSystem(inputElements, {
    onAccountChange(accountName) {
      scrapbook.setActiveAccount(accountName);
      journey.stop();
    },
    onCreatePin(label) {
      const ground = scene.raycastGroundFromCenter();
      if (ground) scrapbook.addPinFromLatLon(ground.lat, ground.lon, ground.height, label);
      refreshUI('Pin created.');
    },
    onSelectPin(pinId) {
      scrapbook.selectPin(pinId);
      refreshUI('Pin selected.');
    },
    onSaveSelectedPin(updates) {
      scrapbook.updateSelectedPin(updates);
      refreshUI('Pin metadata saved.');
    },
    onDeleteSelectedPin() {
      scrapbook.deleteSelectedPin();
      refreshUI('Pin deleted.');
    },
    onFlyToSelectedPin() {
      flyToPin(scrapbook.getSelectedPin());
      refreshUI('Flying to selected pin.');
    },
    onStartJourney() {
      journey.start();
    },
    onStopJourney() {
      journey.stop();
    },
    onNextJourneyStop() {
      journey.next();
    }
  });

  function refreshUI(journeyStatus: string): void {
    inputSystem.renderState({
      activeAccount: scrapbook.getActiveAccount(),
      pins: scrapbook.getPins(),
      selectedPin: scrapbook.getSelectedPin(),
      journeyStatus
    });

    const env = scene.getEnvironmentState();
    if (dom.envTimeEl) dom.envTimeEl.textContent = env.utcTime;
    if (dom.envWeatherEl) dom.envWeatherEl.textContent = env.weather;
    if (dom.envBarTimeEl) dom.envBarTimeEl.textContent = env.utcTime;
    if (dom.envBarWeatherEl) dom.envBarWeatherEl.textContent = env.weather;

    if (dom.compassSvgEl) {
      const headingDeg = (scene.getHeading() * 180) / Math.PI;
      dom.compassSvgEl.style.transform = `rotate(${-headingDeg}deg)`;
    }
  }

  refreshUI('Journey idle.');

  function formatAltitude(m: number): string {
    if (m < 1000) return `${Math.round(m)} m`;
    const km = m / 1000;
    if (km < 10000) return `${km.toFixed(km < 100 ? 1 : 0)} km`;
    return `${(km / 1000).toFixed(1)}k km`;
  }

  window.setInterval(() => {
    const env = scene.getEnvironmentState();
    if (dom.envTimeEl) dom.envTimeEl.textContent = env.utcTime;
    if (dom.envWeatherEl) dom.envWeatherEl.textContent = env.weather;
    if (dom.envBarTimeEl) dom.envBarTimeEl.textContent = env.utcTime;
    if (dom.envBarWeatherEl) dom.envBarWeatherEl.textContent = env.weather;
    if (dom.envBarAltEl) dom.envBarAltEl.textContent = formatAltitude(scene.getAltitudeMeters());
    if (dom.compassSvgEl) {
      const headingDeg = (scene.getHeading() * 180) / Math.PI;
      dom.compassSvgEl.style.transform = `rotate(${-headingDeg}deg)`;
    }
  }, 200);

  window.addEventListener('resize', () => scene.resize());

  if (options.storyUrl) {
    void fetchStory(options.storyUrl).then((story) => {
      if (!story) {
        refreshUI('Story failed to load.');
        return;
      }
      document.title = `${story.title} · Companion Atlas`;
      scrapbook.loadPins(storyToPins(story));
      refreshUI(`Loaded story: ${story.title}`);
      const first = scrapbook.getSelectedPin();
      if (first) scene.flyToLatLon(first.lat, first.lon, { duration: 1600, range: 4500 });
    });
  }
}
