import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

/**
 * WebXR system — AR + VR support.
 *
 * Enables renderer.xr, creates entry buttons, and sets up XR controller
 * grab-to-rotate interaction (rotate the worldGroup in XR space).
 *
 * Call xrSystem.tick() inside the render loop.
 */
export interface XrSystem {
  vrButton: HTMLElement;
  arButton: HTMLElement;
  tick(): void;
}

export function createXrSystem(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  worldGroup: THREE.Group
): XrSystem {
  renderer.xr.enabled = true;

  // XR controllers
  const controller0 = renderer.xr.getController(0);
  const controller1 = renderer.xr.getController(1);
  scene.add(controller0, controller1);

  // Visual grip helpers (simple boxes)
  function makeGrip(index: number): THREE.Group {
    const grip = renderer.xr.getControllerGrip(index);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x8ab4ff, roughness: 0.6, metalness: 0.2 })
    );
    grip.add(box);
    scene.add(grip);
    return grip;
  }
  makeGrip(0);
  makeGrip(1);

  // Grab-to-rotate state
  let grabbing = false;
  let prevControllerPos = new THREE.Vector3();
  const controllerPos = new THREE.Vector3();

  controller0.addEventListener('selectstart', () => {
    grabbing = true;
    controller0.getWorldPosition(prevControllerPos);
  });
  controller0.addEventListener('selectend', () => {
    grabbing = false;
  });

  // Squeeze-to-zoom (delegated via custom event so cameraControls can react)
  controller0.addEventListener('squeezestart', () => {
    const evt = new CustomEvent('xr-squeeze-start', { bubbles: true });
    renderer.domElement.dispatchEvent(evt);
  });
  controller0.addEventListener('squeezeend', () => {
    const evt = new CustomEvent('xr-squeeze-end', { bubbles: true });
    renderer.domElement.dispatchEvent(evt);
  });

  function tick(): void {
    if (!grabbing) return;
    controller0.getWorldPosition(controllerPos);
    const delta = controllerPos.clone().sub(prevControllerPos);

    // Map controller lateral movement to globe Y-rotation
    if (delta.lengthSq() > 0.00001) {
      worldGroup.rotation.y += delta.x * 2.8;
      worldGroup.rotation.x = THREE.MathUtils.clamp(
        worldGroup.rotation.x - delta.y * 2.8,
        -Math.PI * 0.45,
        Math.PI * 0.45
      );
    }

    prevControllerPos.copy(controllerPos);
  }

  // Build entry buttons
  const viewportEl = document.getElementById('viewport') ?? document.body;

  let vrButton: HTMLElement;
  let arButton: HTMLElement;

  try {
    vrButton = VRButton.createButton(renderer);
    vrButton.id = 'vr-button';
  } catch {
    vrButton = document.createElement('button');
    vrButton.id = 'vr-button';
    vrButton.textContent = 'VR';
    vrButton.style.display = 'none';
  }

  try {
    arButton = ARButton.createButton(renderer, {
      requiredFeatures: [],
      optionalFeatures: ['dom-overlay', 'dom-overlay-for-handheld-ar'],
      domOverlay: { root: viewportEl as HTMLElement }
    });
    arButton.id = 'ar-button';
  } catch {
    arButton = document.createElement('button');
    arButton.id = 'ar-button';
    arButton.textContent = 'AR';
    arButton.style.display = 'none';
  }

  return { vrButton, arButton, tick };
}
