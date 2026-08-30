/**
 * A Street View plate held in the off hand — the immersive answer to "was I
 * really here?".
 *
 * This archive is 290 memories that are overwhelmingly calendar events, trips
 * and orders, with essentially no photographs. Flying to one drops you onto
 * photorealistic tiles at low altitude, which is exactly the altitude that mesh
 * is worst at, so the moment of arrival is a melted building and a text card.
 * Street View is the only asset that can make the place look like the place.
 *
 * It is a *peek*, not an entry. The Static API returns flat JPEGs; true
 * panoramic entry needs either the tile endpoint (a licensing question) or a
 * cubemap stitched from four to six billed calls. A plate you glance down at
 * needs neither, and reads better anyway — you are still standing on the globe,
 * holding a photograph of the street.
 *
 * The imagery is fetched by `memory/streetview.ts`, unchanged and shared with
 * the desktop inspector: metadata is checked before any picture is billed, one
 * lookup covers an ~11 m cell, and concurrent callers share a single request. In
 * a session that matters twice over, because the plate re-targets as the viewer
 * looks around.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import type { AtlasMemory } from '../../model/atlasModel.js';
import { streetViewAvailable } from '../../memory/streetview.js';
import { useStreetView } from '../../story/useStreetView.js';
import { labelFontReady, type LabelCard } from './labelCard.js';
import { curvedPlateGeometry } from './curvedPlate.js';
import { drawPeekPlate } from './peekPlateTexture.js';
import { choosePeek, peekCredit, peekHand, PEEK_MIN_GAZE, type PeekCandidate } from './streetViewPeek.js';
import { earthToPlayer, geodeticToEarth, type WorldTransform } from './worldTransform.js';
import type { WorldHandle } from './useGlobeLocomotion.js';

/** Scene-graph name, so the plate is findable from outside React. */
export const PLATE_NAME = 'atlas-street-view-plate';
/** Plate chord width in player metres — a large phone, held at arm's length. */
const PLATE_WIDTH = 0.28;
/**
 * Where it floats relative to the off hand's grip, in grip space.
 *
 * Below the hand, not above it, because `WristMenu` already occupies the space
 * above: its panel is 0.3 m tall and centred 0.2 m up, so it fills grip+0.05 to
 * grip+0.35. Hanging the plate underneath turns the forearm into a stack — the
 * list of everywhere you have been, and beneath it a picture of the place you
 * are looking at right now.
 */
const HAND_OFFSET = new Vector3(0, -0.09, 0.02);
/**
 * Where it sits with no session — a flat browser window has no hands, and the
 * plate is the one part of this renderer that has to be checkable there too.
 * On the right, because the wrist menu parks itself on the left; in a window
 * they are two panels flanking the globe rather than two hands.
 */
const PARKED = new Vector3(0.46, 1.24, -0.92);
/** The picture's pixel size. Larger than the desktop hero: it is held closer. */
const SHOT_WIDTH = 640;
const SHOT_HEIGHT = 400;

const UP = new Vector3(0, 1, 0);
const _p = new Vector3();
const _n = new Vector3();
const _toHead = new Vector3();
const _forward = new Vector3();
const _bearing = new Vector3();
const _handPos = new Vector3();
const _handQuat = new Quaternion();
const _offset = new Vector3();
const _look = new Matrix4();

interface PeekPoint {
  memory: AtlasMemory;
  earth: Vector3;
}

/** Player-space position of a memory, or -1 when it is round the far side. */
function locate(t: WorldTransform, head: Vector3, point: PeekPoint, target: Vector3): number {
  earthToPlayer(t, point.earth, target);
  _n.copy(point.earth).normalize().applyQuaternion(t.quaternion);
  _toHead.copy(head).sub(target);
  if (_toHead.dot(_n) <= 0) return -1;
  return _toHead.length();
}

export interface StreetViewPlateProps {
  world: WorldHandle;
  memories: AtlasMemory[];
  focusedId: string | null;
  /** Which hand holds it. The other stays free to point and to grab. */
  hand?: XRHandedness;
}

export function StreetViewPlate({ world, memories, focusedId, hand = 'left' }: StreetViewPlateProps) {
  // No key, no plate. An empty panel saying the imagery is not configured is a
  // developer's problem shown to a person wearing a headset.
  const configured = useMemo(() => streetViewAvailable(), []);

  const points = useMemo<PeekPoint[]>(
    () =>
      memories
        .filter((m) => m.lat != null && m.lon != null)
        .map((m) => ({ memory: m, earth: geodeticToEarth(m.lat!, m.lon!, 0, new Vector3()) })),
    [memories],
  );

  const [peekId, setPeekId] = useState<string | null>(null);
  const chosen = useRef<string | null>(null);
  const nextScan = useRef(0);
  const candidates = useRef<PeekCandidate[]>([]);
  const handedness = useRef<XRHandedness[]>([]);

  const peekMemory = useMemo(
    () => (peekId ? (points.find((p) => p.memory.id === peekId)?.memory ?? null) : null),
    [points, peekId],
  );

  const { shot, status } = useStreetView(peekMemory, { width: SHOT_WIDTH, height: SHOT_HEIGHT });

  const [card, setCard] = useState<LabelCard | null>(null);
  const group = useRef<Group>(null);

  // Compose the plate's face. `checking` deliberately clears it rather than
  // holding the last one: the previous texture is disposed the moment this
  // effect re-runs, and a plate still pointing at it renders a memory that is
  // no longer the one being looked at.
  const shotUrl = shot?.url ?? null;
  useEffect(() => {
    if (!peekMemory || status === 'checking' || status === 'idle') {
      setCard(null);
      return;
    }
    let live = true;
    let made: LabelCard | null = null;
    const compose = (image: HTMLImageElement | null) => {
      if (!live) return;
      made = drawPeekPlate({
        image,
        title: peekMemory.title,
        place: peekMemory.place && peekMemory.place !== peekMemory.title ? peekMemory.place : undefined,
        when: [peekMemory.whenDate, peekMemory.whenTime].filter(Boolean).join(' · '),
        credit: shot ? peekCredit(shot.captured) : null,
        absence: 'No Street View here — indoors, private, or off the road',
      });
      setCard(made);
    };

    // Manrope has to be in the font set before anything is drawn, or the caption
    // bakes the platform fallback in permanently (see `labelFontReady`).
    void labelFontReady().then(() => {
      if (!live) return;
      if (!shotUrl) {
        compose(null);
        return;
      }
      const image = new Image();
      // Required: the composite is uploaded as a texture, and a tainted canvas
      // throws on upload rather than on draw.
      image.crossOrigin = 'anonymous';
      image.onload = () => compose(image);
      image.onerror = () => compose(null);
      image.src = shotUrl;
    });

    return () => {
      live = false;
      made?.texture.dispose();
    };
  }, [peekMemory, status, shot, shotUrl]);

  const geometry = useMemo(() => {
    if (!card) return null;
    return curvedPlateGeometry({ width: PLATE_WIDTH, height: PLATE_WIDTH / card.aspect });
  }, [card]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  useFrame((state, _delta, frame) => {
    // Hooks cannot be skipped by the early return below, so the cheapest place
    // to stop is here: with no key there is nothing to peek at, and the scan
    // would otherwise walk every memory four times a second for nothing.
    if (!configured) return;

    // Re-target a few times a second. The scan is the same horizon-and-gaze test
    // the pin labels run, and at 4 Hz over a few hundred memories it costs
    // nothing; doing it per frame would still cost nothing and gain nothing,
    // because the plate deliberately resists changing its mind (see `margin`).
    if (state.clock.elapsedTime > nextScan.current) {
      nextScan.current = state.clock.elapsedTime + 0.25;
      state.camera.getWorldDirection(_forward);
      const found = candidates.current;
      found.length = 0;
      for (const point of points) {
        if (locate(world.transform, world.head, point, _p) < 0) continue;
        const towards = _bearing.copy(_p).sub(world.head).normalize().dot(_forward);
        if (towards > PEEK_MIN_GAZE) found.push({ id: point.memory.id, towards });
      }
      const next = choosePeek({ focusedId, current: chosen.current, candidates: found });
      if (next !== chosen.current) {
        chosen.current = next;
        setPeekId(next);
      }
    }

    const node = group.current;
    if (!node) return;

    // Ride the off hand when there is one. Grip poses and the head are read in
    // the same reference space, so no XR-origin transform is needed here — the
    // same assumption `world.head` already makes.
    let held = false;
    const session = state.gl.xr.getSession?.();
    const space = state.gl.xr.getReferenceSpace?.();
    if (session && frame && space) {
      // `XRInputSourceArray` is iterable but not an Array, so no map/find here.
      const present = handedness.current;
      present.length = 0;
      for (const input of session.inputSources) present.push(input.handedness);
      const wanted = peekHand(present, hand);
      let source: XRInputSource | undefined;
      for (const input of session.inputSources) {
        if (input.handedness !== wanted) continue;
        source = input;
        break;
      }
      const grip = source?.gripSpace ? frame.getPose(source.gripSpace, space) : undefined;
      if (grip) {
        _handPos.set(grip.transform.position.x, grip.transform.position.y, grip.transform.position.z);
        _handQuat.set(
          grip.transform.orientation.x,
          grip.transform.orientation.y,
          grip.transform.orientation.z,
          grip.transform.orientation.w,
        );
        node.position.copy(_handPos).add(_offset.copy(HAND_OFFSET).applyQuaternion(_handQuat));
        held = true;
      }
    }
    if (!held) node.position.copy(PARKED);

    // Turn to face the head rather than inherit the wrist's roll. A plate that
    // rolls with the forearm is unreadable at exactly the moment you lift your
    // hand to read it.
    _look.lookAt(world.head, node.position, UP);
    node.quaternion.setFromRotationMatrix(_look);
  });

  if (!configured || !card || !geometry) return null;

  return (
    // Named, and carrying what it is showing: there is no DOM inside a session,
    // so `scene.getObjectByName` is the only way a test — or the emulator
    // console — can ask whether the right place is on the plate.
    <group
      ref={group}
      name={PLATE_NAME}
      userData={{ memoryId: peekMemory?.id ?? null, credit: shot ? peekCredit(shot.captured) : null, status }}
    >
      <mesh geometry={geometry} renderOrder={30} frustumCulled={false}>
        {/* Depth testing off, like every other player-space surface here: the
            plate is held in front of the viewer and must never be swallowed by
            the planet it is describing. */}
        <meshBasicMaterial
          map={card.texture}
          transparent
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
