/**
 * Memory pins on the immersive globe: a marker at the real coordinate, and a
 * readable card for the ones you are looking at.
 *
 * Two things make this different from dropping meshes into the world group.
 *
 * **Pins live in player space, not Earth space.** Their positions are computed
 * from ECEF every frame through the world transform, in float64, and what
 * reaches the GPU is always a few metres from the viewer. Parented under the
 * world group instead, a pin's model-view matrix would carry the full ~6.4e6 m
 * ECEF offset into float32 and the marker would visibly swim once you zoomed in
 * past a few kilometres.
 *
 * **They are sized by angle, not by distance.** A pin is scaled by its distance
 * from the head, so it subtends a constant angle: legible from orbit, and still
 * the same size when you are standing next to it. A fixed world size is either
 * invisible at one end of the zoom range or the size of a country at the other.
 *
 * Pins draw with depth testing off — the same call the Cesium renderer makes
 * with `disableDepthTestDistance` — so terrain never buries them. Correctness
 * comes from an explicit horizon test instead: a pin is drawn only when the
 * viewer is above its tangent plane, which is exactly "on this side of the
 * planet".
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { AtlasMemory } from '../../model/atlasModel.js';
import { earthToPlayer, geodeticToEarth, type WorldTransform } from './worldTransform.js';
import { drawLabelCard, labelFontReady, type LabelCard } from './labelCard.js';
import type { WorldHandle } from './useGlobeLocomotion.js';

const TEAL = new Color('#72ddd4');
const MINT = new Color('#58ebbf');

/** Pin radius as a fraction of its distance from the head (≈1° across). */
const PIN_ANGLE = 0.009;
/** Card height as a fraction of its distance — about 5° tall, comfortably read. */
const CARD_ANGLE = 0.09;

const _p = new Vector3();
const _n = new Vector3();
const _toHead = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _scale = new Vector3();
const _forward = new Vector3();
const _cameraQuat = new Quaternion();

interface PinPoint {
  memory: AtlasMemory;
  earth: Vector3;
}

/** Place a pin in player space; returns its distance from the head, or -1 if it
 *  is over the horizon. */
function locate(t: WorldTransform, head: Vector3, point: PinPoint, target: Vector3): number {
  earthToPlayer(t, point.earth, target);
  // Horizon test: the viewer must be on the outward side of the tangent plane
  // at the pin. The normal is an Earth-space direction, so it comes across into
  // player space with the world's rotation.
  _n.copy(point.earth).normalize().applyQuaternion(t.quaternion);
  _toHead.copy(head).sub(target);
  if (_toHead.dot(_n) <= 0) return -1;
  return _toHead.length();
}

/**
 * Choose which memories get a card.
 *
 * Scoring alone is not enough. A real archive is dozens of visits to the same
 * few places, so the highest-scoring memories are usually the same street
 * corner over and over: six cards land on top of each other and none of them
 * can be read. Take them best-first and drop any that would sit within a card's
 * width of one already taken — the standard map-labelling greedy, in angle
 * rather than pixels so it holds at every zoom and in stereo.
 *
 * `directions` are unit vectors from the head to each candidate.
 */
function declutter(
  scores: Map<string, number>,
  directions: Map<string, Vector3>,
  limit: number,
  focusedId: string | null,
): string[] {
  const order = [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)!);
  // The focused memory is the one thing the viewer explicitly asked to see, so
  // it claims its space first and everything else works around it.
  if (focusedId && scores.has(focusedId)) order.unshift(focusedId);

  const taken: Vector3[] = [];
  const chosen: string[] = [];
  // A card is roughly three times wider than it is tall, so the exclusion is
  // sized off its width, not its height.
  const minCos = Math.cos(CARD_ANGLE * 2.6);
  for (const id of order) {
    if (chosen.length >= limit) break;
    if (chosen.includes(id)) continue;
    const dir = directions.get(id);
    if (!dir) continue;
    if (taken.some((other) => other.dot(dir) > minCos)) continue;
    taken.push(dir);
    chosen.push(id);
  }
  return chosen;
}

export interface MemoryPinsProps {
  world: WorldHandle;
  memories: AtlasMemory[];
  focusedId: string | null;
  onPick?: (memory: AtlasMemory) => void;
  /** How many cards to show at once. More than a handful is unreadable. */
  maxLabels?: number;
}

export function MemoryPins({ world, memories, focusedId, onPick, maxLabels = 6 }: MemoryPinsProps) {
  const points = useMemo<PinPoint[]>(
    () =>
      memories
        .filter((m) => m.lat != null && m.lon != null)
        .map((m) => ({ memory: m, earth: geodeticToEarth(m.lat!, m.lon!, 0, new Vector3()) })),
    [memories],
  );

  const dots = useRef<InstancedMesh>(null);
  const [labelled, setLabelled] = useState<string[]>([]);
  const nextRank = useRef(0);
  const scores = useRef<Map<string, number>>(new Map());
  const visible = useRef<Map<string, Vector3>>(new Map());
  // One reusable direction vector per memory: the ranking pass runs four times
  // a second over every pin, and cloning there is a few thousand short-lived
  // Vector3s a second for the GC to sweep up mid-session.
  const bearings = useMemo(() => points.map(() => new Vector3()), [points]);

  // Colour is set on change rather than per frame: instanceColor uploads the
  // whole buffer, and the only thing that moves is which pin is focused.
  useLayoutEffect(() => {
    const mesh = dots.current;
    if (!mesh) return;
    points.forEach((p, i) => mesh.setColorAt(i, p.memory.id === focusedId ? MINT : TEAL));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [points, focusedId]);

  useFrame((state) => {
    const mesh = dots.current;
    if (!mesh) return;
    const t = world.transform;
    const head = world.head;

    const rank = state.clock.elapsedTime > nextRank.current;
    if (rank) {
      visible.current.clear();
      scores.current.clear();
      state.camera.getWorldDirection(_forward);
    }

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      const distance = locate(t, head, point, _p);
      if (distance < 0) {
        _m.makeScale(0, 0, 0);
      } else {
        const size = Math.max(distance * PIN_ANGLE, 1e-4);
        _m.compose(_p, _q.identity(), _scale.setScalar(size));
        if (rank) {
          // Score by how close the pin is to where the viewer is looking, so
          // the cards that appear are the ones being looked at.
          const bearing = bearings[i]!.copy(_p).sub(head).normalize();
          const towards = bearing.dot(_forward);
          if (towards > 0.55) {
            scores.current.set(point.memory.id, towards);
            visible.current.set(point.memory.id, bearing);
          }
        }
      }
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;

    if (rank) {
      nextRank.current = state.clock.elapsedTime + 0.25;
      const next = declutter(scores.current, visible.current, maxLabels, focusedId);
      if (next.length !== labelled.length || next.some((id, i) => labelled[i] !== id)) setLabelled(next);
    }
  });

  const pick = onPick
    ? (event: ThreeEvent<MouseEvent>) => {
        const index = event.instanceId;
        if (index == null) return;
        event.stopPropagation();
        // A drag that happens to finish over a pin still fires a click; the
        // person was spinning the globe, not choosing this memory.
        if (world.dragged > 6) return;
        onPick(points[index]!.memory);
      }
    : undefined;

  if (points.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={dots}
        args={[undefined, undefined, points.length]}
        frustumCulled={false}
        renderOrder={20}
        onClick={pick}
      >
        <sphereGeometry args={[1, 10, 8]} />
        {/* `transparent` is not about opacity here. The raster tiles ship with
            transparent materials, so they render in the transparency pass —
            after every opaque object, whatever its renderOrder. An opaque pin
            is therefore drawn first and then painted over by the ground it is
            standing on. Joining the same pass puts renderOrder back in charge. */}
        <meshBasicMaterial transparent depthTest={false} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {labelled.map((id) => {
        const point = points.find((p) => p.memory.id === id);
        return point ? (
          <PinLabel key={id} world={world} point={point} focused={id === focusedId} />
        ) : null;
      })}
    </group>
  );
}

/**
 * One memory's card. Billboarded to the viewer and floated just above its pin,
 * far enough that the marker stays visible under it.
 */
function PinLabel({ world, point, focused }: { world: WorldHandle; point: PinPoint; focused: boolean }) {
  const mesh = useRef<Mesh>(null);
  const [card, setCard] = useState<LabelCard | null>(null);
  const { title, whenDate, whenTime, place } = point.memory;

  useEffect(() => {
    let live = true;
    let made: LabelCard | null = null;
    const when = [whenDate, whenTime].filter(Boolean).join(' · ');
    // Manrope may not have reached the font set yet; drawing before it has
    // bakes the platform fallback into the texture for good.
    void labelFontReady().then(() => {
      if (!live) return;
      made = drawLabelCard({
        title,
        when,
        place: place && place !== title ? place : undefined,
        accent: focused ? '#58ebbf' : '#72ddd4',
      });
      setCard(made);
    });
    return () => {
      live = false;
      made?.texture.dispose();
    };
  }, [title, whenDate, whenTime, place, focused]);

  useFrame((state) => {
    const node = mesh.current;
    if (!node || !card) return;
    const distance = locate(world.transform, world.head, point, _p);
    node.visible = distance > 0;
    if (distance < 0) return;

    state.camera.getWorldQuaternion(_cameraQuat);
    node.quaternion.copy(_cameraQuat);
    const height = distance * CARD_ANGLE;
    node.scale.set(height * card.aspect, height, 1);
    // Sit the card above the pin along the *screen's* up axis, so it never
    // overlaps the marker whichever way the viewer's head is tilted.
    _n.set(0, 1, 0).applyQuaternion(_cameraQuat);
    node.position.copy(_p).addScaledVector(_n, height * 0.75);
  });

  if (!card) return null;
  return (
    <mesh ref={mesh} renderOrder={21} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={card.texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
