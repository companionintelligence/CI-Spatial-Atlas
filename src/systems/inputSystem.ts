import { renderPinList } from '../scrapbook';

import type { InputElements, InputHandlers, InputState } from '../types';

export function createInputSystem(elements: InputElements, handlers: InputHandlers): {
  renderState: (state: InputState) => void;
} {
  const {
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
  } = elements;

  accountFormEl.addEventListener('submit', (event) => {
    event.preventDefault();
    const accountName = accountNameInputEl.value.trim() || 'earth-operator';
    accountNameInputEl.value = accountName;
    handlers.onAccountChange(accountName);
  });

  scrapbookFormEl.addEventListener('submit', (event) => {
    event.preventDefault();
    const label = pinLabelInputEl.value.trim() || 'Untitled Memory';
    handlers.onCreatePin(label);
  });

  pinDetailFormEl.addEventListener('submit', (event) => {
    event.preventDefault();
    handlers.onSaveSelectedPin({
      label: pinDetailLabelEl.value,
      notes: pinDetailNotesEl.value,
      mediaUrl: pinDetailMediaUrlEl.value
    });
  });

  pinDeleteBtnEl.addEventListener('click', () => {
    handlers.onDeleteSelectedPin();
  });

  pinFlyBtnEl.addEventListener('click', () => {
    handlers.onFlyToSelectedPin();
  });

  journeyStartBtnEl.addEventListener('click', () => {
    handlers.onStartJourney();
  });

  journeyStopBtnEl.addEventListener('click', () => {
    handlers.onStopJourney();
  });

  journeyNextBtnEl.addEventListener('click', () => {
    handlers.onNextJourneyStop();
  });

  function renderState(state: InputState): void {
    accountStatusEl.textContent = `Active account: ${state.activeAccount}`;

    renderPinList(pinListEl, state.pins);

    const pinRows = pinListEl.querySelectorAll<HTMLLIElement>('.pin-item');
    pinRows.forEach((row, index) => {
      const pin = state.pins[state.pins.length - 1 - index];
      row.dataset.pinId = pin.id;
      row.tabIndex = 0;
      row.addEventListener('click', () => handlers.onSelectPin(pin.id));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handlers.onSelectPin(pin.id);
        }
      });

      if (pin.id === state.selectedPin?.id) {
        row.classList.add('selected');
      }
    });

    if (state.selectedPin) {
      pinDetailLabelEl.value = state.selectedPin.label || '';
      pinDetailNotesEl.value = state.selectedPin.notes || '';
      pinDetailMediaUrlEl.value = state.selectedPin.mediaUrl || '';

      pinDeleteBtnEl.disabled = false;
      pinFlyBtnEl.disabled = false;
    } else {
      pinDetailLabelEl.value = '';
      pinDetailNotesEl.value = '';
      pinDetailMediaUrlEl.value = '';

      pinDeleteBtnEl.disabled = true;
      pinFlyBtnEl.disabled = true;
    }

    journeyStatusEl.textContent = state.journeyStatus;
  }

  return {
    renderState
  };
}