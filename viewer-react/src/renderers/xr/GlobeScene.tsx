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
import { nearestMemory, solarLocal, type AtlasMemory } from '../../model/atlasModel.js';
import { ComfortField } from './ComfortField.js';
import { ComfortPanel } from './ComfortPanel.js';
import { ImageryGlobe, type TileSource } from './ImageryGlobe.js';
import { MemoryPins } from './MemoryPins.js';
import { Celestials } from './Celestials.js';
import { InfoPanel, Starfield } from './SceneFurniture.js';
import { clearAlphaFor, skyboxVisible, type XRMode } from './sessionMode.js';
import { NightShell, SkyLight, useSkyGrab } from './SkyGrab.js';
import { MEMORY_WINDOW_MS, memoriesInWindow } from './skyTime.js';
import { StreetViewPlate } from './StreetViewPlate.js';
import { WristMenu } from './WristMenu.js';
import { createWorldMotion, loadComfort, saveComfort, type ComfortSettings } from './comfort.js';
import { framingForMemory, renderedRadius, travelRadius } from './memoryIndex.js';
import {
  cancelFlight,
  flyTo,
  useFlatGlobeControls,
  useGlobeLocomotion,
  type WorldHandle,
} from './useGlobeLocomotion.js';
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

/** Scratch for the travel framing; `travel` runs on a click, not per frame, but
 *  the file's habit of not allocating in the render path is worth keeping. */
const _forward = new Vector3();

/**
 * Which hand points at the wrist menu. Right-handed by default, `?hand=left`
 * for the other — a left-hander pointing with their off hand is the difference
 * between a menu that works and one that never gets used.
 */
const DOMINANT_HAND: XRHandedness =
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('hand') === 'left'
    ? 'left'
    : 'right');

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

/**
 * Keep the renderer's clear alpha in step with the session mode.
 *
 * `clearAlphaFor` has existed since AR mode was added and was never called, so
 * the canvas was created with `alpha: true` and then cleared opaque anyway —
 * which is exactly the failure the flag was meant to prevent. In an
 * `immersive-ar` session the composite needs a transparent clear or the
 * passthrough never shows through.
 */
function AlphaForMode({ mode }: { mode: XRMode }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const alpha = clearAlphaFor(mode);
    gl.setClearAlpha(alpha);
    return () => gl.setClearAlpha(1);
  }, [gl, mode]);
  return null;
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
  const mode = useXR((state) => state.mode);
  const sky = skyboxVisible(mode);
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
      motion: createWorldMotion(),
      comfort: loadComfort(),
      uiHands: new Set<XRHandedness>(),
    }),
    [],
  );

  // Comfort settings live in two places on purpose: React state, so the panel
  // redraws, and `world.comfort`, because everything that acts on them runs
  // inside `useFrame` and must see a toggle on the next *frame*, not the next
  // render.
  const [comfort, setComfort] = useState<ComfortSettings>(() => world.comfort);
  useEffect(() => {
    world.comfort = comfort;
    saveComfort(comfort);
  }, [comfort, world]);

  const toggleComfort = useCallback(
    (key: keyof ComfortSettings) => {
      // Reaching for a control counts as input, and input stops a fly-to.
      cancelFlight(world);
      setComfort((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    [world],
  );

  const home = useMemo(() => centroid(memories), [memories]);

  // ————— time, the second axis —————
  //
  // The immersive path used to show all 290 memories from all eight years at
  // once, which is the reason the pin layer needs a hard label cap: with no
  // notion of *when*, every visit to the same street corner is drawn on top of
  // every other. Grabbing the sky turns time on (see SkyGrab.tsx). Until it is
  // grabbed nothing changes — all pins, flat lighting — because arriving inside
  // a one-month window would look like an archive that had lost its data.
  const span = useMemo(() => {
    let startMs = Infinity;
    let stopMs = -Infinity;
    for (const m of memories) {
      if (!Number.isFinite(m.timeMs)) continue;
      startMs = Math.min(startMs, m.timeMs);
      stopMs = Math.max(stopMs, m.timeMs);
    }
    return Number.isFinite(startMs) ? { startMs, stopMs } : { startMs: 0, stopMs: 0 };
  }, [memories]);

  // The live instant is a ref, not state: the terminator has to move every
  // frame while a hand is dragging it, and re-rendering React at 90 Hz to
  // animate a shader uniform would be absurd. `activeMs` is the throttled
  // mirror — the value the pin window, the readout and the sky bodies are
  // allowed to change on.
  const liveMs = useRef(span.stopMs);
  const lastPush = useRef(0);
  const [activeMs, setActiveMs] = useState<number | null>(null);
  // The sun and moon show the instant being looked at, so grabbing the sky to
  // scrub time visibly moves the bodies that cause the lighting.
  const skyMs = activeMs ?? span.stopMs;
  useEffect(() => {
    liveMs.current = span.stopMs;
  }, [span.stopMs]);

  const getLiveMs = useCallback(() => liveMs.current, []);

  // 80 ms ≈ 12 mirrors a second. Fast enough that the sun `Celestials` draws
  // from this value tracks the hand dragging it rather than stepping, cheap
  // enough that re-filtering a few hundred memories and redrawing one canvas
  // card at that rate costs nothing next to the frame itself.
  const takeTime = useCallback((ms: number) => {
    liveMs.current = ms;
    const now = performance.now();
    if (now - lastPush.current < 80) return;
    lastPush.current = now;
    setActiveMs(ms);
  }, []);

  // Flush on release, so letting go always lands the readout and the pin window
  // on the instant the hand actually stopped at, not up to 200 ms short of it.
  const takeHands = useCallback((hands: number) => {
    if (hands === 0) setActiveMs(liveMs.current);
  }, []);

  useSkyGrab(world, {
    currentMs: () => liveMs.current,
    startMs: span.startMs,
    stopMs: span.stopMs,
    onTime: takeTime,
    onHands: takeHands,
  });

  // What the pins show: everything, until time is switched on.
  const windowed = useMemo(
    () => (activeMs == null ? memories : memoriesInWindow(memories, activeMs)),
    [memories, activeMs],
  );

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
    w.__atlasXR = {
      world,
      three: r3f,
      store,
      memories,
      // The sky-grab's live instant and the window it selects, so a driven
      // emulator can assert on numbers rather than on a screenshot.
      time: () => liveMs.current,
      windowed: () => windowed,
    };
    return () => {
      delete w.__atlasXR;
    };
  }, [world, r3f, store, memories, windowed]);

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

  /**
   * Travel, as the wrist menu means it.
   *
   * `focus` above turns the planet where it stands, which is right for a pin
   * you can already see and reach. A memory chosen from the list is neither:
   * it may be on the far side, the globe may have been shoved out of arm's
   * reach, and the viewer may be zoomed into a street six thousand miles away.
   * So this rebuilds the whole framing — the memory an arm's length ahead, the
   * globe back at a size you can hold — and eases into it (`flyTo`) rather than
   * cutting, because a cut across the planet is the one thing that reliably
   * makes people take a headset off.
   */
  const travel = useCallback(
    (memory: AtlasMemory) => {
      onFocus(memory);
      if (memory.lat == null || memory.lon == null) return;
      const to: WorldTransform = createWorldTransform();
      framingForMemory(to, {
        lat: memory.lat,
        lon: memory.lon,
        head: world.head,
        forward: r3f.camera.getWorldDirection(_forward),
        radius: travelRadius(renderedRadius(world.transform)),
      });
      flyTo(world, to);
    },
    [onFocus, r3f, world],
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
        ? [
            'Squeeze a grip to grab the world and drag it',
            'Grab with both hands, pull apart to zoom',
            'Reach into the sky and pull the trigger to drag the sun',
            ...(comfort.snapTurn ? ['Thumbstick left or right to turn 30°'] : []),
          ]
        : ['Drag to turn the globe · scroll to zoom', 'Press Enter VR to reach out and grab it']),
      ...credits,
    ],
    [session, credits, comfort.snapTurn],
  );

  // The date and time, in the scene, because there is nowhere else to put it.
  // Read as local solar time at the memories being looked at — the same reading
  // the flat app's Time Machine gives — so the clock agrees with the terminator
  // rather than with the browser's timezone.
  const clock = useMemo(() => {
    if (activeMs == null) return null;
    const near = nearestMemory(windowed.length ? windowed : memories, activeMs);
    const when = solarLocal(activeMs, near?.lon);
    const days = Math.round(MEMORY_WINDOW_MS / 86_400_000);
    return {
      heading: when.whenDate,
      lines: [
        `${when.whenTime} · ${when.tod}`,
        `${windowed.length} ${windowed.length === 1 ? 'memory' : 'memories'} within ±${days} days`,
        'One turn of the sky = a day · both hands = a year',
      ],
    };
  }, [activeMs, windowed, memories]);

  return (
    <>
      {/* Space, not the page behind the canvas. Without an explicit clear
          colour the sky is transparent, and on a flat screen the globe floats
          on whatever the document's light-mode background happens to be.
          In AR there must be no background at all: an opaque clear paints over
          the passthrough feed, so the room the mode exists to show is replaced
          by a flat dark rectangle. `AlphaForMode` handles the clear alpha the
          same way — both halves are needed, since a null background still
          clears to alpha 1 by default. */}
      {sky && <color attach="background" args={['#020c14']} />}
      <AlphaForMode mode={mode} />
      {/* Photorealistic tiles arrive with PBR materials and need lighting; the
          raster globe is unlit and ignores these. Once the sky has been grabbed
          the fixed key light gives way to the real sun for that instant. */}
      <ambientLight intensity={1.6} />
      {activeMs == null ? (
        <directionalLight intensity={2.2} position={[1, 1.5, 1]} />
      ) : (
        <SkyLight world={world} timeMs={getLiveMs} />
      )}
      {/* The sky is scenery in VR and an occluder in AR — see sessionMode.ts. */}
      {sky && <Starfield world={world} />}
      {sky && <Celestials world={world} timeMs={skyMs} />}

      <group ref={globe}>
        <ImageryGlobe source={source} onFailed={onSourceFailed} onAttributions={takeAttributions} />
        {/* Inside the world group, so the terminator turns and scales with the
            planet instead of being re-derived from the transform every frame. */}
        {activeMs == null ? null : <NightShell world={world} timeMs={getLiveMs} />}
      </group>

      <MemoryPins world={world} memories={windowed} focusedId={focusedId} onPick={focus} />

      {/* The reachability half of the experience. Pins show what is in front of
          you; this is how you get to the other 284. */}
      <WristMenu world={world} memories={memories} onTravel={travel} dominant={DOMINANT_HAND} />

      {/* Arrival, which the tiles cannot give on their own. At the altitude a
          memory sits at, photorealistic mesh is at its worst — and most of these
          memories have no photograph of their own — so the only asset that can
          make the place look like the place is Street View. It hangs under the
          wrist menu on the same off hand: the list of where you have been, and
          beneath it what the one you are looking at actually looks like. */}
      <StreetViewPlate
        world={world}
        memories={memories}
        focusedId={focusedId}
        hand={DOMINANT_HAND === 'left' ? 'right' : 'left'}
      />

      {/* Just under the globe and inside a 60° field of view: the imagery
          credit has to be readable in the headset, where there is no DOM to
          put it in, without the wearer having to look at the floor. */}
      <InfoPanel heading="Companion Atlas" lines={panel} position={[0, 1.02, -1.2]} height={0.14} />

      {/* Above the globe rather than below it, where the sun is: the date has
          to be legible without looking away from the hand that is moving it. */}
      {clock ? (
        <InfoPanel heading={clock.heading} lines={clock.lines} position={[0, 2.04, -1.15]} height={0.15} />
      ) : null}

      {/* The tunnel and the room grid it opens onto. Last in the scene because
          it draws over everything, which is the point of it. */}
      <ComfortField world={world} />

      {/* Beside the credits, not buried in a menu: someone who needs these is
          already wearing the headset and already uncomfortable. */}
      <ComfortPanel
        world={world}
        settings={comfort}
        onToggle={toggleComfort}
        position={[-0.72, 1.16, -1.02]}
      />
    </>
  );
}
