import './style.css';

import { createInputSystem } from './systems/inputSystem';
import { createSceneSystem } from './systems/sceneSystem';
import { createScrapbookSystem } from './systems/scrapbookSystem';
import type { InputElements } from './types';
import { renderWorkflowList } from './workflow';

function getElementByIdOrThrow<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }

  return element as T;
}

const appEl = getElementByIdOrThrow<HTMLDivElement>('app');
const viewportEl = getElementByIdOrThrow<HTMLElement>('viewport');
const workflowListEl = getElementByIdOrThrow<HTMLUListElement>('workflow-list');

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

renderWorkflowList(workflowListEl);

const isStaticMode = new URLSearchParams(window.location.search).get('static') === '1';
const sceneSystem = createSceneSystem({ mountEl: appEl, viewportEl, isStaticMode });
const scrapbookSystem = createScrapbookSystem({
  sceneConfig: sceneSystem.sceneConfig,
  pinsGroup: sceneSystem.pinsGroup
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
}

refreshUI('Journey idle.');
sceneSystem.startLoop();

window.addEventListener('resize', () => {
  sceneSystem.resize();
});