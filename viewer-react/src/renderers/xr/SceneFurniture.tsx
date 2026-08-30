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
import { BufferAttribute, BufferGeometry, Mesh, Points, Vector3 } from 'three';
import { drawInfoCard, labelFontReady, type LabelCard } from './labelCard.js';
import type { WorldHandle } from './useGlobeLocomotion.js';

const _viewer = new Vector3();
const _toViewer = new Vector3();

/**
 * Stars, on a unit sphere in player space.
 *
 * A unit sphere rather than a distant one because the depth range moves with
 * the viewer — anything pinned at a fixed distance is either clipped while
 * holding the globe or lost inside the planet at street level. Drawing them
 * first with depth testing off puts them behind everything regardless.
 *
 * They carry the world's rotation but not its position or scale, so spinning
 * the planet spins the sky with it.
 */
export function Starfield({ world, count = 1400 }: { world: WorldHandle; count?: number }) {
  const points = useRef<Points>(null);
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

  useFrame(() => {
    if (points.current) points.current.quaternion.copy(world.transform.quaternion);
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
