/**
 * The comfort tunnel, and the room it opens onto.
 *
 * Google Earth VR's "Tunnel Vision" is two things, and the second is the one
 * everyone drops when they reimplement it. The first is the obvious half:
 * narrow the field of view while the world is moving, because peripheral
 * optical flow drives vection far harder than the centre does, so cutting the
 * periphery removes most of the provocation for a small loss of view.
 *
 * The second half is what the periphery is *replaced with*. Blacking it out
 * leaves nothing to be still against. Earth VR shows a wireframe grid standing
 * in for the floor of the room the person is physically in — and the tracking
 * system knows exactly where that is. In WebXR the same thing is a grid drawn
 * in the `local-floor` reference space: it does not move when the world moves,
 * because it is not in the world. Turn the planet and the room stays exactly
 * where the inner ear says it is.
 *
 * Two implementation notes worth keeping:
 *
 *  - **The vignette is computed per fragment in view space**, not baked into a
 *    texture or a screen-space quad. `-normalize(viewPosition).z` gives the
 *    angle from the eye's own view axis, which is correct per eye under the
 *    off-axis projections WebXR hands out, and correct at any field of view. It
 *    also means the shell's *position* only has to cover the view, not be
 *    centred on the eye — so the 3 cm of interpupillary offset costs nothing.
 *  - **The room grid is at the scene root**, which is player space, which is
 *    the session's reference space: `XRAtlasApp` never moves the XR origin (the
 *    world moves instead — see `worldTransform.ts`). Anything parented under
 *    the world group would inherit the very motion this is here to sit still
 *    against.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, BufferAttribute, BufferGeometry, Color, LineSegments, Mesh, ShaderMaterial } from 'three';
import type { WorldHandle } from './useGlobeLocomotion.js';
import {
  approach,
  DEFAULT_COMFORT,
  motionAmount,
  TUNNEL_FALL_S,
  TUNNEL_FEATHER_RAD,
  TUNNEL_RISE_S,
  tunnelInnerAngle,
} from './comfort.js';

/** How far out the shell sits. Inside the near plane's reach at every zoom. */
const SHELL_RADIUS = 0.6;

/** Half the room, metres, and the cell size of the floor grid. */
const FLOOR_EXTENT = 4;
const FLOOR_STEP = 0.5;
/** A waist-to-head-high cage, so the periphery has something at eye level too. */
const CAGE_RADIUS = 3.2;
const CAGE_HEIGHT = 2.4;
const CAGE_SPOKES = 24;
const CAGE_RINGS = [0.8, 1.6, 2.4];

const VERTEX = /* glsl */ `
  varying vec3 vView;
  #ifdef ATLAS_FADE
    attribute float aFade;
    varying float vFade;
  #endif
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = mv.xyz;
    #ifdef ATLAS_FADE
      vFade = aFade;
    #endif
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uAmount;
  uniform float uInner;
  uniform float uFeather;
  uniform float uMaxAlpha;
  uniform vec3 uColor;
  varying vec3 vView;
  #ifdef ATLAS_FADE
    varying float vFade;
  #endif
  void main() {
    // Angle between this fragment and the eye's view axis. Per eye, per frame,
    // no uniforms: the view matrix already encodes which eye is drawing.
    float angle = acos(clamp(-normalize(vView).z, -1.0, 1.0));
    float edge = smoothstep(uInner, uInner + uFeather, angle);
    float alpha = uAmount * edge * uMaxAlpha;
    #ifdef ATLAS_FADE
      alpha *= vFade;
    #endif
    if (alpha <= 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function makeTunnelMaterial(color: string, maxAlpha: number, fadeAttribute: boolean): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uAmount: { value: 0 },
      uInner: { value: tunnelInnerAngle(0) },
      uFeather: { value: TUNNEL_FEATHER_RAD },
      uMaxAlpha: { value: maxAlpha },
      uColor: { value: new Color(color) },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: BackSide,
  });
  if (fadeAttribute) material.defines = { ATLAS_FADE: '' };
  return material;
}

/**
 * Floor grid plus a low cage, split into short segments.
 *
 * Short segments because the fade is a vertex attribute: one 8 m line has only
 * two endpoints to interpolate between, so it would come out flat rather than
 * dimming towards the edges of the room.
 */
function buildRoomGrid(): BufferGeometry {
  const positions: number[] = [];
  const fades: number[] = [];

  const floorFade = (x: number, z: number) => {
    const r = Math.hypot(x, z) / FLOOR_EXTENT;
    return Math.max(0, 1 - r * r);
  };
  const push = (
    ax: number, ay: number, az: number, af: number,
    bx: number, by: number, bz: number, bf: number,
  ) => {
    positions.push(ax, ay, az, bx, by, bz);
    fades.push(af, bf);
  };

  const steps = Math.round((FLOOR_EXTENT * 2) / FLOOR_STEP);
  for (let i = 0; i <= steps; i++) {
    const at = -FLOOR_EXTENT + i * FLOOR_STEP;
    for (let j = 0; j < steps; j++) {
      const a = -FLOOR_EXTENT + j * FLOOR_STEP;
      const b = a + FLOOR_STEP;
      push(a, 0, at, floorFade(a, at), b, 0, at, floorFade(b, at));
      push(at, 0, a, floorFade(at, a), at, 0, b, floorFade(at, b));
    }
  }

  // The cage is dimmer than the floor: it is a hint that the room has walls,
  // not a set of walls.
  const cageFade = (y: number) => 0.42 * Math.max(0, 1 - y / (CAGE_HEIGHT * 1.35));
  for (let i = 0; i < CAGE_SPOKES; i++) {
    const angle = (i / CAGE_SPOKES) * Math.PI * 2;
    const x = Math.cos(angle) * CAGE_RADIUS;
    const z = Math.sin(angle) * CAGE_RADIUS;
    const rungs = 6;
    for (let r = 0; r < rungs; r++) {
      const y0 = (r / rungs) * CAGE_HEIGHT;
      const y1 = ((r + 1) / rungs) * CAGE_HEIGHT;
      push(x, y0, z, cageFade(y0), x, y1, z, cageFade(y1));
    }
  }
  for (const y of CAGE_RINGS) {
    const segments = 48;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      push(
        Math.cos(a) * CAGE_RADIUS, y, Math.sin(a) * CAGE_RADIUS, cageFade(y),
        Math.cos(b) * CAGE_RADIUS, y, Math.sin(b) * CAGE_RADIUS, cageFade(y),
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('aFade', new BufferAttribute(new Float32Array(fades), 1));
  return geometry;
}

/**
 * Both halves of the tunnel, sharing one eased amount.
 *
 * The amount is a ref driven from `useFrame`, never React state: this changes
 * every frame while the world is moving, and a re-render per frame in a 90 Hz
 * renderer is how an XR app starts dropping frames.
 */
export function ComfortField({ world }: { world: WorldHandle }) {
  const shell = useRef<Mesh>(null);
  const grid = useRef<LineSegments>(null);
  const amount = useRef(0);

  const shellMaterial = useMemo(() => makeTunnelMaterial('#000509', 0.94, false), []);
  const gridMaterial = useMemo(() => makeTunnelMaterial('#9fd6e0', 0.85, true), []);
  const gridGeometry = useMemo(() => buildRoomGrid(), []);

  useEffect(
    () => () => {
      shellMaterial.dispose();
      gridMaterial.dispose();
      gridGeometry.dispose();
    },
    [shellMaterial, gridMaterial, gridGeometry],
  );

  useFrame((_state, delta) => {
    const comfort = world.comfort ?? DEFAULT_COMFORT;
    // A fly-to always counts, whatever its measured speed: it is a passive ride
    // the viewer is not steering, which is the case the tunnel exists for.
    const target = comfort.tunnel
      ? Math.max(motionAmount(world.motion?.vection ?? 0), world.flight ? 1 : 0)
      : 0;
    const next = approach(amount.current, target, delta, TUNNEL_RISE_S, TUNNEL_FALL_S);
    amount.current = next;

    const inner = tunnelInnerAngle(next);
    shellMaterial.uniforms.uAmount!.value = next;
    shellMaterial.uniforms.uInner!.value = inner;
    gridMaterial.uniforms.uAmount!.value = next;
    gridMaterial.uniforms.uInner!.value = inner;

    const visible = next > 0.002;
    if (shell.current) {
      shell.current.visible = visible;
      // This frame's head pose, from the XR frame — not the camera's world
      // matrix, which three only updates once rendering starts and which is
      // therefore a frame behind here.
      shell.current.position.copy(world.head);
    }
    if (grid.current) grid.current.visible = visible;
  });

  return (
    <>
      {/* 900/901: both draw after the globe and the pins, and the grid draws
          over the scrim so the room reads through the darkened periphery. */}
      <mesh ref={shell} renderOrder={900} frustumCulled={false} material={shellMaterial} visible={false}>
        <sphereGeometry args={[SHELL_RADIUS, 24, 16]} />
      </mesh>
      <lineSegments
        ref={grid}
        renderOrder={901}
        frustumCulled={false}
        geometry={gridGeometry}
        material={gridMaterial}
        visible={false}
      />
    </>
  );
}
