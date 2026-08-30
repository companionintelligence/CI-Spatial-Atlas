/**
 * The immersive scene: a real Earth you can pick up.
 *
 * Everything inside the `<Canvas>` lives here. The pieces are deliberately
 * separate — `worldTransform` owns the maths, `useGlobeLocomotion` owns the
 * input, `ImageryGlobe` owns the tiles, `MemoryPins` owns the memories — and
 * this file is what wires them into one scene and decides where the viewer
 * arrives.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import { useXR, useXRStore } from '@react-three/xr';
import type { AtlasMemory } from '../../model/atlasModel.js';
import { ImageryGlobe, type TileSource } from './ImageryGlobe.js';
import { MemoryPins } from './MemoryPins.js';
import { InfoPanel, Starfield } from './SceneFurniture.js';
import { flyTo, useFlatGlobeControls, useGlobeLocomotion, type WorldHandle } from './useGlobeLocomotion.js';
import {
  createWorldTransform,
  DEFAULT_LIMITS,
  EARTH_RADIUS_M,
  frameGlobe,
  type WorldTransform,
} from './worldTransform.js';

/**
 * Where the globe sits when you arrive: an arm's length ahead, a little below
 * eye level, and small enough to see all of. Standing height is a guess until
 * the headset reports a pose, and a guess is fine — the framing is rebuilt from
 * the real head position on the first fly-to.
 */
const HOME = {
  // Just below eye height and just over a metre out: close enough to reach and
  // grab, far enough that the whole planet is inside a 60°-ish field of view on
  // a flat screen as well as in a headset.
  centre: new Vector3(0, 1.52, -1.15),
  head: new Vector3(0, 1.6, 0),
  radius: 0.45,
};

function centroid(memories: AtlasMemory[]): { lat: number; lon: number } {
  // Average on the sphere, not in degrees: memories either side of the date
  // line average to the middle of the Atlantic if you average longitudes.
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const m of memories) {
    if (m.lat == null || m.lon == null) continue;
    const lat = (m.lat * Math.PI) / 180;
    const lon = (m.lon * Math.PI) / 180;
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
    n++;
  }
  if (n === 0) return { lat: 20, lon: 0 };
  return {
    lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
    lon: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

export interface GlobeSceneProps {
  memories: AtlasMemory[];
  focusedId: string | null;
  onFocus: (memory: AtlasMemory) => void;
  source: TileSource;
  onSourceFailed: (source: TileSource) => void;
  onAttributions?: (lines: string[]) => void;
}

export function GlobeScene({
  memories,
  focusedId,
  onFocus,
  source,
  onSourceFailed,
  onAttributions,
}: GlobeSceneProps) {
  const globe = useRef<Group>(null);
  const session = useXR((state) => state.session);
  const origin = useXR((state) => state.origin);

  const world = useMemo<WorldHandle>(
    () => ({
      transform: createWorldTransform(),
      limits: DEFAULT_LIMITS,
      head: HOME.head.clone(),
      hands: 0,
      flight: null,
      dragged: 0,
    }),
    [],
  );

  const home = useMemo(() => centroid(memories), [memories]);

  // Arrive looking at the person's own memories. Once, when they first land: a
  // later story swap must not yank the globe out of the viewer's hands.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || memories.length === 0) return;
    arrived.current = true;
    frameGlobe(world.transform, { ...home, centre: HOME.centre, facing: HOME.head, radius: HOME.radius });
  }, [home, memories.length, world]);

  // A dev-only handle on the live scene. There is no other way to drive this
  // renderer from a test: the interesting state is a mutable transform updated
  // per frame inside a canvas, and the emulated-headset path (`?emulate=1`)
  // needs something to poke at from outside React.
  const r3f = useThree();
  const store = useXRStore();
  useEffect(() => {
    const env = (import.meta as unknown as { env: Record<string, unknown> }).env;
    if (!env.DEV) return;
    const w = window as unknown as { __atlasXR?: unknown };
    w.__atlasXR = { world, three: r3f, store, memories };
    return () => {
      delete w.__atlasXR;
    };
  }, [world, r3f, store, memories]);

  useGlobeLocomotion(world, globe, { origin: () => origin });
  // Mouse control is the flat-window fallback; inside a session the controllers
  // are the input and the canvas sees no pointer events anyway.
  useFlatGlobeControls(world, !session);

  const focus = useCallback(
    (memory: AtlasMemory) => {
      onFocus(memory);
      if (memory.lat == null || memory.lon == null) return;
      // Turn the planet to bring this memory round to face the viewer, leaving
      // where the globe sits and how big it is exactly as they were. A click
      // should reorient, not teleport — and holding position and scale fixed
      // means this reads correctly at every zoom, from the globe in your hands
      // to a street corner.
      const to: WorldTransform = createWorldTransform();
      frameGlobe(to, {
        lat: memory.lat,
        lon: memory.lon,
        centre: world.transform.position,
        facing: world.head,
        radius: EARTH_RADIUS_M * world.transform.scale,
      });
      flyTo(world, to);
    },
    [onFocus, world],
  );

  const [credits, setCredits] = useState<string[]>([]);
  const takeAttributions = useCallback(
    (lines: string[]) => {
      setCredits(lines);
      onAttributions?.(lines);
    },
    [onAttributions],
  );

  const panel = useMemo(
    () => [
      ...(session
        ? ['Squeeze a grip to grab the world and drag it', 'Grab with both hands, pull apart to zoom']
        : ['Drag to turn the globe · scroll to zoom', 'Press Enter VR to reach out and grab it']),
      ...credits,
    ],
    [session, credits],
  );

  return (
    <>
      {/* Space, not the page behind the canvas. Without an explicit clear
          colour the sky is transparent, and on a flat screen the globe floats
          on whatever the document's light-mode background happens to be. */}
      <color attach="background" args={['#020c14']} />
      {/* Photorealistic tiles arrive with PBR materials and need lighting; the
          raster globe is unlit and ignores these. */}
      <ambientLight intensity={1.6} />
      <directionalLight intensity={2.2} position={[1, 1.5, 1]} />
      <Starfield world={world} />

      <group ref={globe}>
        <ImageryGlobe source={source} onFailed={onSourceFailed} onAttributions={takeAttributions} />
      </group>

      <MemoryPins world={world} memories={memories} focusedId={focusedId} onPick={focus} />

      {/* Just under the globe and inside a 60° field of view: the imagery
          credit has to be readable in the headset, where there is no DOM to
          put it in, without the wearer having to look at the floor. */}
      <InfoPanel heading="Companion Atlas" lines={panel} position={[0, 1.02, -1.2]} height={0.14} />
    </>
  );
}
