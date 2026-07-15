import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { storyEntities, type Story, type Item } from '@companion-atlas/story';

const EARTH_RADIUS_M = 6_371_000;
const xrStore = createXRStore();

/** WGS84 (deg) → three.js Cartesian on a sphere of the given radius. */
function llaToXYZ(lat: number, lon: number, height = 0): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const r = EARTH_RADIUS_M + height;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

function positionOf(item: Item): { lat: number; lon: number; height?: number } | null {
  if ('position' in item && item.position) return item.position;
  if (item.type === 'track') return { lat: item.path[0]!.lat, lon: item.path[0]!.lon, height: item.path[0]!.height };
  return null;
}

/**
 * Immersive WebXR renderer (R3F). Cesium has no WebXR, so headsets get the same
 * Story on a three.js globe — ported from CI-Earth-2's working @react-three/xr
 * path. A shared `storyEntities` list keeps this in lockstep with the Cesium
 * renderer. Scaffold: globe + entity pins; grab-locomotion + billboards to port.
 */
export function XRStoryScene({ story }: { story: Story }) {
  const pins = useMemo(
    () => storyEntities(story).map((e) => ({ id: e.id, pos: positionOf(e) })).filter((p) => p.pos),
    [story],
  );

  return (
    <>
      <button onClick={() => xrStore.enterVR()}>Enter VR</button>
      <Canvas camera={{ near: 1, far: 1e13, position: [0, 0, EARTH_RADIUS_M * 3] }}>
        <XR store={xrStore}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[1, 1, 1]} />
          <mesh>
            <sphereGeometry args={[EARTH_RADIUS_M, 64, 64]} />
            <meshStandardMaterial color="#1b4a6b" />
          </mesh>
          {pins.map((p) => {
            const [x, y, z] = llaToXYZ(p.pos!.lat, p.pos!.lon, (p.pos!.height ?? 0) + 50_000);
            return (
              <mesh key={p.id} position={[x, y, z]}>
                <sphereGeometry args={[40_000, 12, 12]} />
                <meshStandardMaterial color="#ffcc33" emissive="#aa7700" />
              </mesh>
            );
          })}
        </XR>
      </Canvas>
    </>
  );
}
