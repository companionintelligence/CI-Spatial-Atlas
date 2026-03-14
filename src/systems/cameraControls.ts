import * as THREE from 'three';

/**
 * Orbital camera controls — camera orbits a fixed globe at the origin.
 *
 * State: theta (longitude angle), phi (latitude angle), radius (distance).
 *   x = radius * cos(phi) * cos(theta)
 *   y = radius * sin(phi)
 *   z = radius * cos(phi) * sin(theta)
 *
 * Interactions:
 *   - Left drag  → rotate theta/phi (orbit)
 *   - Scroll     → zoom radius
 *   - Pinch      → zoom radius
 *   - onTap      → fired on click without drag (for pin selection)
 */

export interface CameraControlsOptions {
  theta?: number;
  phi?: number;
  radius?: number;
  minRadius?: number;
  maxRadius?: number;
  onTap?: (event: PointerEvent) => void;
}

interface FlightAnim {
  startAt: number;
  duration: number;
  fromTheta: number;
  fromPhi: number;
  fromRadius: number;
  toTheta: number;
  toPhi: number;
  toRadius: number;
}

export function createCameraControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  opts: CameraControlsOptions = {}
) {
  const minRadius = opts.minRadius ?? 1.32;
  const maxRadius = opts.maxRadius ?? 14;

  // Current displayed state (damped toward target)
  let theta = opts.theta ?? Math.PI / 2;
  let phi = opts.phi ?? 0.083;
  let radius = opts.radius ?? 4.215;

  // Target state
  let tTheta = theta;
  let tPhi = phi;
  let tRadius = radius;

  let flight: FlightAnim | null = null;

  // Drag state
  let dragActive = false;
  let dragMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragLastX = 0;
  let dragLastY = 0;

  // Touch / pinch state
  const activeTouches = new Map<number, { x: number; y: number }>();
  let prevPinchDist = 0;

  const clampPhi = (v: number) =>
    THREE.MathUtils.clamp(v, -Math.PI * 0.488, Math.PI * 0.488);

  function applyCamera(): void {
    const p = clampPhi(phi);
    camera.position.set(
      radius * Math.cos(p) * Math.cos(theta),
      radius * Math.sin(p),
      radius * Math.cos(p) * Math.sin(theta)
    );
    camera.lookAt(0, 0, 0);
  }

  function tick(time: number): void {
    if (flight) {
      const elapsed = time - flight.startAt;
      const t = Math.min(1, elapsed / flight.duration);
      const eased = t * t * (3 - 2 * t);

      // Shortest-path theta interpolation
      let dTheta = flight.toTheta - flight.fromTheta;
      while (dTheta > Math.PI) dTheta -= Math.PI * 2;
      while (dTheta < -Math.PI) dTheta += Math.PI * 2;

      tTheta = flight.fromTheta + dTheta * eased;
      tPhi = flight.fromPhi + (flight.toPhi - flight.fromPhi) * eased;
      tRadius = flight.fromRadius + (flight.toRadius - flight.fromRadius) * eased;

      if (t >= 1) {
        tTheta = flight.fromTheta + dTheta;
        tPhi = flight.toPhi;
        tRadius = flight.toRadius;
        flight = null;
      }
    }

    const damp = 0.13;
    theta += (tTheta - theta) * damp;
    phi = clampPhi(phi + (clampPhi(tPhi) - phi) * damp);
    radius += (tRadius - radius) * damp;

    applyCamera();
  }

  // -------------------------------------------------------------------------
  // Pointer handlers
  // -------------------------------------------------------------------------

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    dragActive = true;
    dragMoved = false;
    dragStartX = dragLastX = e.clientX;
    dragStartY = dragLastY = e.clientY;
    domElement.setPointerCapture(e.pointerId);
    domElement.classList.add('is-dragging');
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragActive) return;

    const dx = e.clientX - dragLastX;
    const dy = e.clientY - dragLastY;
    dragLastX = e.clientX;
    dragLastY = e.clientY;

    const totalMove =
      Math.abs(e.clientX - dragStartX) + Math.abs(e.clientY - dragStartY);
    if (totalMove > 4) dragMoved = true;
    if (!dragMoved) return;

    flight = null;
    tTheta -= dx * 0.008;
    tPhi = clampPhi(tPhi + dy * 0.0065);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragActive) return;
    domElement.releasePointerCapture(e.pointerId);
    domElement.classList.remove('is-dragging');
    const wasDrag = dragMoved;
    dragActive = false;
    dragMoved = false;

    if (!wasDrag) {
      opts.onTap?.(e);
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    if (!dragActive) return;
    domElement.releasePointerCapture(e.pointerId);
    domElement.classList.remove('is-dragging');
    dragActive = false;
    dragMoved = false;
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    flight = null;
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    tRadius = THREE.MathUtils.clamp(tRadius * factor, minRadius, maxRadius);
  }

  // -------------------------------------------------------------------------
  // Touch / pinch handlers
  // -------------------------------------------------------------------------

  function onTouchStart(e: TouchEvent): void {
    for (const t of e.changedTouches) {
      activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (activeTouches.size === 2) {
      const [a, b] = [...activeTouches.values()];
      prevPinchDist = Math.hypot(b.x - a.x, b.y - a.y);
    }
  }

  function onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of e.changedTouches) {
      activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (activeTouches.size === 2) {
      const [a, b] = [...activeTouches.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (prevPinchDist > 0 && dist > 0) {
        const factor = prevPinchDist / dist;
        tRadius = THREE.MathUtils.clamp(tRadius * factor, minRadius, maxRadius);
      }
      prevPinchDist = dist;
      flight = null;
    }
  }

  function onTouchEnd(e: TouchEvent): void {
    for (const t of e.changedTouches) {
      activeTouches.delete(t.identifier);
    }
    prevPinchDist = 0;
  }

  // -------------------------------------------------------------------------
  // Bind / unbind
  // -------------------------------------------------------------------------

  function bind(): void {
    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('pointermove', onPointerMove);
    domElement.addEventListener('pointerup', onPointerUp);
    domElement.addEventListener('pointercancel', onPointerCancel);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    domElement.addEventListener('touchstart', onTouchStart, { passive: true });
    domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    domElement.addEventListener('touchend', onTouchEnd, { passive: true });
  }

  function unbind(): void {
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('pointermove', onPointerMove);
    domElement.removeEventListener('pointerup', onPointerUp);
    domElement.removeEventListener('pointercancel', onPointerCancel);
    domElement.removeEventListener('wheel', onWheel);
    domElement.removeEventListener('touchstart', onTouchStart);
    domElement.removeEventListener('touchmove', onTouchMove);
    domElement.removeEventListener('touchend', onTouchEnd);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Fly camera to lat/lon (degrees) at given radius. */
  function flyTo(lat: number, lon: number, targetRadius: number, duration = 1400): void {
    const toTheta = THREE.MathUtils.degToRad(lon);
    const toPhi = clampPhi(THREE.MathUtils.degToRad(lat));
    flight = {
      startAt: performance.now(),
      duration,
      fromTheta: theta,
      fromPhi: phi,
      fromRadius: radius,
      toTheta,
      toPhi,
      toRadius: THREE.MathUtils.clamp(targetRadius, minRadius, maxRadius)
    };
    tTheta = toTheta;
    tPhi = toPhi;
    tRadius = flight.toRadius;
  }

  function zoomIn(): void {
    flight = null;
    tRadius = THREE.MathUtils.clamp(tRadius * 0.78, minRadius, maxRadius);
  }

  function zoomOut(): void {
    flight = null;
    tRadius = THREE.MathUtils.clamp(tRadius * 1.28, minRadius, maxRadius);
  }

  function getTheta(): number {
    return theta;
  }

  function getPhi(): number {
    return phi;
  }

  function getRadius(): number {
    return radius;
  }

  function cancelFlight(): void {
    flight = null;
  }

  bind();
  applyCamera();

  return {
    tick,
    flyTo,
    zoomIn,
    zoomOut,
    getTheta,
    getPhi,
    getRadius,
    cancelFlight,
    bind,
    unbind
  };
}

export type CameraControls = ReturnType<typeof createCameraControls>;
