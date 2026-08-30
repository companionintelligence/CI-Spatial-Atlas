import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, CanvasTexture, Group, Vector3 } from 'three';
import { moonDirectionEarth, moonIllumination, sunDirectionEarth } from './skyTime.js';
import { skyRadius } from './skyShell.js';
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
 * Apparent size, as a multiple of the sky radius — so roughly the angle each
 * body subtends. Both are deliberately far larger than life: the real sun and
 * moon are about half a degree across, which at headset resolution is a couple
 * of pixels and reads as a stuck sub-pixel rather than a body in the sky.
 */
const SUN_ANGULAR_SIZE = 0.075;
const MOON_ANGULAR_SIZE = 0.05;

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

  // The stops are where the sun stops looking like a bright star. At 0.16 the
  // solid core was about 0.7 degrees inside a 4.3 degree quad — almost all of
  // the sprite was corona, so among 1400 stars the sun read as one of them that
  // happened to be yellow. A disc out to 0.36 gives a photosphere of roughly
  // 1.5 degrees with the corona still falling away around it.
  const sunMap = useMemo(
    () => discTexture('rgba(255,246,214,1)', 'rgba(255,196,92,0.55)', [0.36, 0.56, 1]),
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

    // Shared with the starfield: both were separately clipped away by hanging
    // the sky at a distance the live far plane does not reach. See skyShell.ts.
    const radius = skyRadius(state.camera);

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
