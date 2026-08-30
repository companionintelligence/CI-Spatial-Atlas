import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, CanvasTexture, Group, Vector3 } from 'three';
import { moonDirectionEarth, moonIllumination, sunDirectionEarth } from './skyTime.js';
import type { WorldHandle } from './useGlobeLocomotion.js';

/**
 * The sun and the moon, on the same shell as the stars.
 *
 * The scene already computes a sun direction to light the globe, but nothing
 * drew the body itself: the planet had a day side and a terminator with no
 * visible cause, which reads as a lighting bug rather than a sky. Putting the
 * disc where the light comes from is what makes the terminator legible — and it
 * gives the grab-the-sky time gesture something to actually grab.
 *
 * Both bodies carry the world's rotation but not its position or scale, exactly
 * as the starfield does, so spinning the planet sweeps the sky over it and
 * zooming does not fly you into the sun.
 */

/**
 * Where on the view frustum to hang the sky, as a fraction of the live far
 * plane rather than a fixed distance.
 *
 * A constant radius does not work here: `depthRange` re-derives near/far every
 * frame from the world's scale, and at globe scale far is only about 13 m, so
 * bodies parked at a "safely distant" 260 m sat exactly on the far plane and
 * were clipped away — the sky rendered black with the sun and moon present,
 * visible and correctly positioned, which is a maddening thing to debug from a
 * screenshot. Measured NDC z of 1.0 is what gave it away.
 *
 * Depth testing is off and these draw first, so they read as behind everything
 * regardless of their actual distance; only staying inside the frustum matters.
 */
const SKY_FRACTION_OF_FAR = 0.45;

/**
 * Apparent size, as a multiple of the sky radius — so roughly the angle each
 * body subtends. Both are deliberately far larger than life: the real sun and
 * moon are about half a degree across, which at headset resolution is a couple
 * of pixels and reads as a stuck sub-pixel rather than a body in the sky.
 */
const SUN_ANGULAR_SIZE = 0.075;
const MOON_ANGULAR_SIZE = 0.05;

/**
 * The far plane a perspective projection matrix is really enforcing.
 *
 * With m10 = (f+n)/(n-f) and m14 = 2fn/(n-f), f falls out as m14 / (m10 + 1).
 */
function projectionFar(e: ArrayLike<number>): number {
  const denom = e[10]! + 1;
  const far = Math.abs(denom) < 1e-9 ? Infinity : e[14]! / denom;
  return Number.isFinite(far) && far > 0 ? far : 1000;
}

const _sun = new Vector3();
const _moon = new Vector3();

/** A soft radial disc, drawn once and reused for both bodies. */
function discTexture(inner: string, outer: string, stops: [number, number, number]): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(stops[0], inner);
  g.addColorStop(stops[1], outer);
  g.addColorStop(stops[2], 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

export function Celestials({ world, timeMs, visible = true }: {
  world: WorldHandle;
  /** The instant the sky is showing — the same clock the sun lighting uses. */
  timeMs: number;
  /** False in AR, where the real sky is behind the passthrough. */
  visible?: boolean;
}) {
  const group = useRef<Group>(null);
  const sunSprite = useRef<Group>(null);
  const moonSprite = useRef<Group>(null);

  const sunMap = useMemo(
    () => discTexture('rgba(255,246,214,1)', 'rgba(255,196,92,0.55)', [0.16, 0.34, 1]),
    [],
  );
  // The moon's own disc is dimmer and tighter — no corona.
  const moonMap = useMemo(
    () => discTexture('rgba(232,238,246,1)', 'rgba(150,170,196,0.35)', [0.42, 0.62, 1]),
    [],
  );

  useFrame((state) => {
    const g = group.current;
    if (!g || !visible) return;

    // Ride with the viewer so the sky never falls outside the frustum as the
    // world is scaled and the depth range moves under it.
    state.camera.getWorldPosition(g.position);

    // The far plane must come from the projection matrix, not from
    // `camera.far`. The depth range is only pushed into the matrix when it has
    // moved materially (an `updateProjectionMatrix` per frame is not free, and
    // in XR every change costs a `session.updateRenderState`), so the property
    // routinely runs ahead of the matrix that actually does the clipping.
    // Trusting the property put the bodies at 6.2 m inside a nominal 13.7 m
    // far plane and still clipped them, at an NDC z of 1.018.
    const radius = Math.max(1, projectionFar(state.camera.projectionMatrix.elements) * SKY_FRACTION_OF_FAR);

    // Same treatment as the starfield: rotation only. Position and scale would
    // drag the sky along with the planet.
    g.quaternion.copy(world.transform.quaternion);

    // Children are in the group's local space, so the group's own position must
    // not be added again here, and `lookAt` — which takes world coordinates —
    // aims at the group's origin, i.e. the viewer.
    if (sunSprite.current) {
      sunDirectionEarth(timeMs, _sun);
      sunSprite.current.position.copy(_sun).multiplyScalar(radius);
      sunSprite.current.lookAt(g.position);
      // The geometry is a unit quad, so scale is angular size: a disc of
      // SUN_ANGULAR_SIZE radians at this radius. Bigger than the real half a
      // degree, which is a pinprick in a headset and reads as a dead pixel.
      sunSprite.current.scale.setScalar(radius * SUN_ANGULAR_SIZE);
    }
    if (moonSprite.current) {
      moonDirectionEarth(timeMs, _moon);
      moonSprite.current.position.copy(_moon).multiplyScalar(radius);
      moonSprite.current.lookAt(g.position);
      // Fade the disc with how much of it is lit, so a new moon shrinks away
      // rather than hanging there as a full grey coin. Never quite zero:
      // earthshine leaves the dark limb faintly visible in reality too.
      const lit = 0.3 + 0.7 * moonIllumination(timeMs);
      moonSprite.current.scale.setScalar(radius * MOON_ANGULAR_SIZE * lit);
    }
  });

  if (!visible) return null;

  return (
    <group ref={group} renderOrder={-999} frustumCulled={false}>
      <group ref={sunSprite}>
        <mesh>
          <planeGeometry args={[1, 1]} />
          {/* Additive and depth-free, in the same pre-globe queue as the stars:
              a transparent-pass sprite with depth testing off paints over the
              planet instead of sitting behind it. */}
          <meshBasicMaterial
            map={sunMap}
            transparent
            blending={AdditiveBlending}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>

      <group ref={moonSprite}>
        <mesh>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={moonMap}
            transparent
            blending={AdditiveBlending}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
