/**
 * The bits of the immersive scene that are neither planet nor memory: stars,
 * and the panel that carries the imagery credit and the control hints.
 *
 * Both live in *player* space rather than under the world group, which is the
 * point — they must stay the same size and in the same place however far the
 * planet has been zoomed or spun.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, Mesh, Points, PointsMaterial, Vector3 } from 'three';
import { drawInfoCard, labelFontReady, type LabelCard } from './labelCard.js';
import type { WorldHandle } from './useGlobeLocomotion.js';
import {
  approach,
  DEFAULT_COMFORT,
  motionAmount,
  STAR_FALL_S,
  STAR_RISE_S,
  starfieldFollowsWorld,
} from './comfort.js';

const _viewer = new Vector3();
const _toViewer = new Vector3();

const STAR_INK = new Color('#bcd9e2');
/** The scene's clear colour — fading a star to it is fading it to nothing. */
const VOID_INK = new Color('#020c14');

/**
 * Stars, on a unit sphere in player space.
 *
 * A unit sphere rather than a distant one because the depth range moves with
 * the viewer — anything pinned at a fixed distance is either clipped while
 * holding the globe or lost inside the planet at street level. Drawing them
 * first with depth testing off puts them behind everything regardless.
 *
 * They carry the world's rotation but not its position or scale, so spinning
 * the planet spins the sky with it — which is astronomically right and, while
 * the world is *moving*, the single most provocative thing this scene could do.
 * A one-handed orbit turns the planet, the pins and the sky together: the whole
 * visual field rotates and there is no static reference left anywhere, which is
 * the textbook recipe for rotational vection and the sickness that follows it.
 *
 * So the stars are a rest frame first and an ephemeris second. Above a rotation
 * threshold they stop following the world and fade towards the background;
 * below it they fade back in and re-lock, and the re-lock happens while they
 * are under 5% brightness so the correction is never seen (`STAR_HIDDEN`).
 */
export function Starfield({ world, count = 1400 }: { world: WorldHandle; count?: number }) {
  const points = useRef<Points>(null);
  const dim = useRef(0);
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform on the sphere: a naive lat/lon pick clumps at the poles.
      const z = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - z * z);
      const theta = Math.random() * Math.PI * 2;
      positions.set([r * Math.cos(theta), r * Math.sin(theta), z], i * 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    return geo;
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_state, delta) => {
    const node = points.current;
    if (!node) return;
    const comfort = world.comfort ?? DEFAULT_COMFORT;
    // Rotation only. A world that is being dragged or zoomed does not drag the
    // sky with it, so the stars are still a valid rest frame and there is
    // nothing to hide.
    const target = comfort.steadyStars ? motionAmount(world.motion?.angular ?? 0) : 0;
    dim.current = approach(dim.current, target, delta, STAR_RISE_S, STAR_FALL_S);
    if (starfieldFollowsWorld(dim.current)) node.quaternion.copy(world.transform.quaternion);
    // Fade by colour, not opacity: `transparent` would move the stars into the
    // transparency pass, where depth-tested-off geometry drawn after the globe
    // paints straight over the planet (see the material below).
    (node.material as PointsMaterial).color.lerpColors(VOID_INK, STAR_INK, 1 - dim.current);
  });

  return (
    <points ref={points} geometry={geometry} renderOrder={-1000} frustumCulled={false}>
      {/* Opaque, so it stays in the queue that draws before the globe; with
          depth testing off, a transparent one would paint over the planet. */}
      <pointsMaterial
        size={1.6}
        sizeAttenuation={false}
        color="#bcd9e2"
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

export interface InfoPanelProps {
  heading: string;
  lines: string[];
  /** Where it sits in player space. */
  position: [number, number, number];
  /** Panel height in player metres. */
  height?: number;
}

/** A flat panel that turns to face the viewer but stays put. */
export function InfoPanel({ heading, lines, position, height = 0.16 }: InfoPanelProps) {
  const mesh = useRef<Mesh>(null);
  const [card, setCard] = useState<LabelCard | null>(null);
  const key = lines.join('\n');

  useEffect(() => {
    let live = true;
    let made: LabelCard | null = null;
    void labelFontReady().then(() => {
      if (!live) return;
      made = drawInfoCard(heading, lines);
      setCard(made);
    });
    return () => {
      live = false;
      made?.texture.dispose();
    };
    // Redraw on content, not on the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heading, key]);

  useFrame((state) => {
    const node = mesh.current;
    if (!node) return;
    state.camera.getWorldPosition(_viewer);
    // Face the viewer, but stay upright: a panel that rolls with the head is
    // unreadable and, in a headset, faintly nauseating.
    _toViewer.subVectors(_viewer, node.position);
    node.rotation.set(0, Math.atan2(_toViewer.x, _toViewer.z), 0);
  });

  if (!card) return null;
  return (
    <mesh ref={mesh} position={position} renderOrder={25}>
      <planeGeometry args={[height * card.aspect, height]} />
      <meshBasicMaterial map={card.texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
