import './style.css';
import { renderWorkflowList } from './workflow.js';
import { createSceneSystem } from './systems/sceneSystem.js';
import { createScrapbookSystem } from './systems/scrapbookSystem.js';
import { createInputSystem } from './systems/inputSystem.js';

const appEl = document.getElementById('app');
const viewportEl = document.getElementById('viewport');
const workflowListEl = document.getElementById('workflow-list');
const accountFormEl = document.getElementById('account-form');
const accountStatusEl = document.getElementById('account-status');
const accountNameInputEl = document.getElementById('account-name');
const scrapbookFormEl = document.getElementById('scrapbook-form');
const pinLabelInputEl = document.getElementById('pin-label');
const pinListEl = document.getElementById('pin-list');
const pinDetailFormEl = document.getElementById('pin-detail-form');
const pinDetailLabelEl = document.getElementById('pin-detail-label');
const pinDetailNotesEl = document.getElementById('pin-detail-notes');
const pinDetailMediaUrlEl = document.getElementById('pin-detail-media-url');
const pinDeleteBtnEl = document.getElementById('pin-delete-btn');
const pinFlyBtnEl = document.getElementById('pin-fly-btn');
const journeyStartBtnEl = document.getElementById('journey-start-btn');
const journeyStopBtnEl = document.getElementById('journey-stop-btn');
const journeyNextBtnEl = document.getElementById('journey-next-btn');
const journeyStatusEl = document.getElementById('journey-status');

renderWorkflowList(workflowListEl);

const isStaticMode = new URLSearchParams(window.location.search).get('static') === '1';
const sceneSystem = createSceneSystem({ mountEl: appEl, viewportEl, isStaticMode });
const scrapbookSystem = createScrapbookSystem({
  sceneConfig: sceneSystem.sceneConfig,
  pinsGroup: sceneSystem.pinsGroup
});

let journeyIntervalId = null;
let journeyIndex = 0;

function flyToPin(pin) {
  if (!pin) {
    return;
  }

  sceneSystem.flyToLatLon(pin.lat, pin.lon, {
    duration: 1400,
    distance: 0.84
  });
}

function stopJourney() {
  if (journeyIntervalId) {
    clearInterval(journeyIntervalId);
    journeyIntervalId = null;
  }

  refreshUI('Journey idle.');
}

function nextJourneyStop() {
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

function startJourney() {
  stopJourney();
  journeyIndex = 0;
  nextJourneyStop();
  journeyIntervalId = setInterval(nextJourneyStop, 2600);
}

const inputSystem = createInputSystem(
  {
    accountFormEl,
    accountNameInputEl,
    accountStatusEl,
    scrapbookFormEl,
    pinLabelInputEl,
    pinListEl,
    pinDetailFormEl,
    pinDetailLabelEl,
    pinDetailNotesEl,
    pinDetailMediaUrlEl,
    pinDeleteBtnEl,
    pinFlyBtnEl,
    journeyStartBtnEl,
    journeyStopBtnEl,
    journeyNextBtnEl,
    journeyStatusEl
  },
  {
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
  }
);

function refreshUI(journeyStatus) {
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
