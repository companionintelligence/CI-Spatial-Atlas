import type { Group, Vector3 } from 'three';

export interface Pin {
  id: string;
  label: string;
  notes: string;
  mediaUrl: string;
  lat: number;
  lon: number;
  altitude: number;
  createdAt: string;
}

export type ScrapbookData = Record<string, Pin[]>;

export interface PinUpdates {
  label: string;
  notes: string;
  mediaUrl: string;
}

export interface SceneConfig {
  camera: {
    fov: number;
    near: number;
    far: number;
    position: Vector3;
  };
  globe: {
    radius: number;
    segments: number;
    color: number;
    roughness: number;
    metalness: number;
  };
  atmosphere: {
    radius: number;
    color: number;
    opacity: number;
  };
  ring: {
    radius: number;
    tube: number;
    color: number;
  };
  scrapbook: {
    markerOffset: number;
    markerRadius: number;
    selectedMarkerRadius: number;
    stemRadius: number;
    stemLength: number;
    routeOffset: number;
    routeSegments: number;
    markerColor: number;
    selectedMarkerColor: number;
    stemColor: number;
    routeColor: number;
    routeOpacity: number;
    haloColor: number;
    rotationSpeed: number;
    maxTilt: number;
    idleSpin: number;
  };
}

export interface ViewportInteractionHandlers {
  onSelectPin?: (pinId: string) => void;
}

export interface SceneSystem {
  sceneConfig: SceneConfig;
  pinsGroup: Group;
  bindViewportInteractions: (handlers: ViewportInteractionHandlers) => void;
  startLoop: () => void;
  resize: () => void;
  flyToLatLon: (lat: number, lon: number, options?: { duration?: number; distance?: number }) => void;
  raycastGlobeFromCamera: () => Vector3;
  getEnvironmentState: () => {
    utcTime: string;
    weather: string;
  };
  render: () => void;
}

export interface CreateSceneSystemOptions {
  mountEl: HTMLElement;
  viewportEl: HTMLElement;
  isStaticMode: boolean;
}

export interface CreateScrapbookSystemOptions {
  sceneConfig: SceneConfig;
  pinsGroup: Group;
}

export interface InputElements {
  accountFormEl: HTMLFormElement;
  accountNameInputEl: HTMLInputElement;
  accountStatusEl: HTMLParagraphElement;
  scrapbookFormEl: HTMLFormElement;
  pinLabelInputEl: HTMLInputElement;
  pinListEl: HTMLUListElement;
  pinDetailFormEl: HTMLFormElement;
  pinDetailLabelEl: HTMLInputElement;
  pinDetailNotesEl: HTMLTextAreaElement;
  pinDetailMediaUrlEl: HTMLInputElement;
  pinDeleteBtnEl: HTMLButtonElement;
  pinFlyBtnEl: HTMLButtonElement;
  journeyStartBtnEl: HTMLButtonElement;
  journeyStopBtnEl: HTMLButtonElement;
  journeyNextBtnEl: HTMLButtonElement;
  journeyStatusEl: HTMLParagraphElement;
}

export interface InputHandlers {
  onAccountChange: (accountName: string) => void;
  onCreatePin: (label: string) => void;
  onSelectPin: (pinId: string) => void;
  onSaveSelectedPin: (updates: PinUpdates) => void;
  onDeleteSelectedPin: () => void;
  onFlyToSelectedPin: () => void;
  onStartJourney: () => void;
  onStopJourney: () => void;
  onNextJourneyStop: () => void;
}

export interface InputState {
  activeAccount: string;
  pins: Pin[];
  selectedPin: Pin | null;
  journeyStatus: string;
}