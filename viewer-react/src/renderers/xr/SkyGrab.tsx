/**
 * Grab the sky and drag the sun — the immersive path's time control.
 *
 * The flat app has a scrubber; a headset has no DOM to put one in, and a
 * floating slider in a room is worse than the thing it stands for anyway. So
 * time is manipulated by moving the object that shows it. Hold your hand up
 * against the sky, pull the trigger, and sweep: the sun tracks your hand, the
 * terminator sweeps the globe under it, and the pins thin out to the memories
 * from around then. Carry on past a full revolution and the date steps — Google
 * Earth VR's overload, worth stealing because it makes "one more day" a
 * physical quantity rather than a keystroke.
 *
 * How it stays out of the way of the two gestures already on the controllers:
 *
 *  - **Grip** grabs the planet (`useGlobeLocomotion`). A sky drag ignores any
 *    hand whose grip is down, so grabbing the world never nudges the clock.
 *  - **Trigger over the planet** selects a memory (`MemoryPins`). The sky test
 *    is geometric — the line from the head through the hand has to *miss* the
 *    globe — so "pointing at a pin" and "reaching into the sky" can never both
 *    be true of the same hand.
 *
 * The angle is measured about the Earth's own spin axis, not the player's
 * vertical, because that is the circle the sun actually travels; `skyTime.ts`
 * owns that arithmetic and is unit-tested.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DirectionalLight, FrontSide, Mesh, Ray, ShaderMaterial, Sphere, Vector3 } from 'three';
import { EARTH_RADIUS_M } from './worldTransform.js';
import type { WorldHandle } from './useGlobeLocomotion.js';
import {
  advanceSkyDrag,
  angleAround,
  beginSkyDrag,
  clampToSpan,
  orthonormalBasis,
  skyDragTime,
  sunDirectionEarth,
  TURN_DAY_MS,
  TURN_YEAR_MS,
  type SkyDrag,
} from './skyTime.js';

const _head = new Vector3();
const _hand = new Vector3();
const _dir = new Vector3();
/** Direction to the measuring hand, held while the rest of the loop runs. */
const _first = new Vector3();
const _pole = new Vector3();
const _sun = new Vector3();
const _sunLocal = new Vector3();
const _ray = new Ray();
const _sphere = new Sphere();

/** ECEF north, which the world quaternion carries into player space. */
const EARTH_NORTH = new Vector3(0, 0, 1);

/** WGS84 polar/equatorial ratio — the same flattening `ImageryGlobe` applies. */
const POLAR_RATIO = 6_356_752.314245 / 6_378_137;
/** The night shell sits ~12.7 km up: clear of terrain, invisible from orbit. */
const NIGHT_SHELL = 1.002;

/** Is the trigger down on this source? (xr-standard: 0 = trigger, 1 = squeeze.) */
function triggerDown(source: XRInputSource): boolean {
  const b = source.gamepad?.buttons?.[0];
  return !!b && (b.pressed || b.value > 0.6);
}

/** Is the grip down? A gripping hand belongs to the globe, not to the sky. */
function gripDown(source: XRInputSource): boolean {
  const b = source.gamepad?.buttons?.[1];
  return !!b && (b.pressed || b.value > 0.6);
}

export interface SkyGrabOptions {
  /** The instant a new drag starts from. */
  currentMs: () => number;
  /** Archive bounds — a drag cannot leave the story it is scrubbing. */
  startMs: number;
  stopMs: number;
  /** Called with the scrubbed instant, at most once a frame. */
  onTime: (ms: number) => void;
  /** Called when the number of hands on the sky changes. */
  onHands?: (hands: number) => void;
}

/**
 * Read the sky grab every frame and report the instant it has reached.
 *
 * Priority -90: after locomotion (-100) has settled the world transform this
 * frame — the spin axis and the globe's silhouette both come from it — and
 * before the pin layer at 0 reads which memories are in the window.
 */
export function useSkyGrab(world: WorldHandle, opts: SkyGrabOptions): void {
  const drag = useRef<SkyDrag | null>(null);
  const hands = useRef(0);
  /**
   * The measuring frame, fixed at the moment the sky is taken hold of.
   *
   * Rebuilding it from the live world rotation each frame looks equivalent and
   * is not: the basis is derived from the Earth's pole, so anything that turns
   * the planet mid-drag — an easing fly-to, a snap turn, the *other* hand on
   * the grip — turns the frame too, and the measured angle changes with a hand
   * that never moved. Time then drifts on its own while the viewer stands
   * still, which is the worst possible failure for a control whose whole claim
   * is that you are holding the thing you are moving.
   */
  const basis = useRef({ u: new Vector3(1, 0, 0), v: new Vector3(0, 1, 0) });
  const { onTime, onHands, currentMs, startMs, stopMs } = opts;

  useFrame((state, _delta, frame) => {
    const xr = state.gl.xr;
    const session = xr.getSession?.();
    const space = xr.getReferenceSpace?.();

    const release = () => {
      if (hands.current === 0) return;
      hands.current = 0;
      drag.current = null;
      onHands?.(0);
    };

    if (!session || !frame || !space) {
      release();
      return;
    }

    _head.copy(world.head);
    _sphere.center.copy(world.transform.position);
    _sphere.radius = EARTH_RADIUS_M * world.transform.scale;

    // Collect the hands that are against the sky with the trigger down. Left
    // first, for the same reason the grab path takes them in a fixed order: a
    // set that reorders between frames makes the anchor jump.
    let held = 0;
    let first = false;
    // "Against the sky" is how a drag *starts*, not a condition it has to keep
    // satisfying. Re-testing every frame means a hand that sweeps across the
    // planet's silhouette — which a full revolution does, twice — drops the
    // grab there and silently re-anchors on the far side, turning one
    // continuous drag into two whose angles do not add up. Once you have hold
    // of the sky you keep it until you let go, the same contract the grip grab
    // makes with the globe.
    const engaged = hands.current > 0 && drag.current !== null;
    for (const wanted of ['left', 'right', 'none'] as const) {
      for (const source of session.inputSources) {
        if (source.handedness !== wanted || held === 2) continue;
        if (!triggerDown(source) || gripDown(source)) continue;
        // A hand pointing at a panel is not reaching for the sky. The globe
        // silhouette test below cannot tell the difference — a hand held down
        // by the off wrist is ~58 degrees off-axis and misses the globe just as
        // cleanly as a hand raised to the stars — so pressing a wrist-menu row
        // or a comfort toggle used to begin a sky drag on the same press. That
        // was not cosmetic: one frame of drag, or simply releasing, moves
        // `activeMs` off null, and nothing ever sets it back, so the scene
        // stayed clamped to a 30-day window with ~283 of 290 pins gone for the
        // rest of the session. The panels claim their hand ahead of this hook
        // by frame priority.
        if (world.uiHands.has(source.handedness)) continue;
        const pose = frame.getPose(source.gripSpace ?? source.targetRaySpace, space);
        if (!pose) continue;
        _hand.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
        _dir.copy(_hand).sub(_head);
        if (_dir.lengthSq() < 1e-8) continue;
        _dir.normalize();
        // Against the sky, not against the planet: the line of sight through
        // the hand has to miss the globe. This is the same test the eye makes,
        // which is why it needs no controller orientation — it works with a
        // tracked hand, a controller held any which way, and an emulator that
        // can only move a position.
        if (!engaged) {
          _ray.origin.copy(_head);
          _ray.direction.copy(_dir);
          if (_ray.intersectsSphere(_sphere)) continue;
        }

        // The first hand found is the one that measures; a second only changes
        // the gear, so a two-handed drag reads one angle rather than averaging
        // two that disagree.
        if (held === 0) {
          first = true;
          _first.copy(_dir);
        }
        held++;
      }
    }

    if (held === 0 || !first) {
      release();
      return;
    }

    // Re-anchor whenever the hand count changes: the gear changes with it, and
    // carrying the old anchor across would jump the date by a year. This is
    // also where the measuring frame is fixed, from the Earth's pole as it
    // stands at the instant of the grab.
    if (hands.current !== held || !drag.current) {
      hands.current = held;
      _pole.copy(EARTH_NORTH).applyQuaternion(world.transform.quaternion);
      orthonormalBasis(_pole, basis.current.u, basis.current.v);
      drag.current = beginSkyDrag(
        currentMs(),
        angleAround(_first, basis.current.u, basis.current.v),
        held >= 2 ? TURN_YEAR_MS : TURN_DAY_MS,
      );
      onHands?.(held);
      return;
    }

    advanceSkyDrag(drag.current, angleAround(_first, basis.current.u, basis.current.v));
    onTime(clampToSpan(skyDragTime(drag.current), startMs, stopMs));
  }, -90);
}

/**
 * The light the sun casts for the active instant.
 *
 * Only the light. The visible body belongs to `Celestials`, which puts the sun
 * and the moon on the same shell as the stars — one sun in the sky, drawn once,
 * with this key light agreeing with it because both read the same
 * `sunDirectionEarth`. What this adds is the shading the disc cannot: the
 * photorealistic tiles arrive with PBR materials, and a fixed key light leaves
 * a street at midnight lit from the same corner as one at noon.
 */
export function SkyLight({ world, timeMs }: { world: WorldHandle; timeMs: () => number }) {
  const light = useRef<DirectionalLight>(null);

  // `timeMs` is a getter, not a value. The scrubbed instant lives in a ref so
  // the light can follow on every frame of a drag; taking it as a prop would peg
  // it to React's re-render rate.
  useFrame(() => {
    sunDirectionEarth(timeMs(), _sun);
    _dir.copy(_sun).applyQuaternion(world.transform.quaternion);
    if (light.current) light.current.position.copy(world.head).addScaledVector(_dir, 8);
  });

  return <directionalLight ref={light} intensity={2.4} />;
}

/**
 * The night side of the planet.
 *
 * A directional light shades nothing here: the raster tiles arrive on basic
 * materials, so the Esri globe is unlit by construction. The terminator has to
 * be *drawn*, and a thin shell over the surface is both cheaper than
 * re-materialising every streamed tile and the same thing Cesium's globe shader
 * does one level down.
 *
 * Belongs inside the world group, so it turns and scales with the planet.
 */
export function NightShell({ world, timeMs }: { world: WorldHandle; timeMs: () => number }) {
  const shell = useRef<Mesh>(null);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uSun: { value: new Vector3(1, 0, 0) }, uColor: { value: new Color('#01080f') } },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uSun;
          uniform vec3 uColor;
          varying vec3 vDir;
          void main() {
            float d = dot(normalize(vDir), normalize(uSun));
            // Civil twilight runs about 6° past the geometric terminator; the
            // soft band is what stops this reading as a painted-on line.
            float night = smoothstep(0.12, -0.12, d);
            gl_FragColor = vec4(uColor, night * 0.82);
          }
        `,
        transparent: true,
        // Same reasoning as the pins: the tiles render in the transparency
        // pass, so an ordinary depth-tested overlay is painted over by the
        // ground it is shading. Order it explicitly instead.
        depthTest: false,
        depthWrite: false,
        side: FrontSide,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    sunDirectionEarth(timeMs(), _sun);
    // The geometry has its poles on Y (three's sphere) and carries the same
    // +90° X rotation as the globe body, so an ECEF vector reaches its local
    // frame as (x, z, -y).
    _sunLocal.set(_sun.x, _sun.z, -_sun.y);
    (material.uniforms.uSun!.value as Vector3).copy(_sunLocal);
    const node = shell.current;
    if (node) {
      // Hidden once the viewer is inside it: at street level you are *under*
      // the shell, and a dark sphere drawn around your head is not a night side.
      const radius = EARTH_RADIUS_M * NIGHT_SHELL * world.transform.scale;
      node.visible = world.head.distanceTo(world.transform.position) > radius;
    }
  });

  return (
    <mesh
      ref={shell}
      rotation={[Math.PI / 2, 0, 0]}
      scale={[1, POLAR_RATIO, 1]}
      renderOrder={10}
      frustumCulled={false}
      material={material}
    >
      <sphereGeometry args={[EARTH_RADIUS_M * NIGHT_SHELL, 96, 48]} />
    </mesh>
  );
}
