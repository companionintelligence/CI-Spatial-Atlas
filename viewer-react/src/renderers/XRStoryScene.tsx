import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import type { Story } from '@companion-atlas/story';
import { deriveModel, type AtlasMemory } from '../model/atlasModel.js';
import { GlobeScene } from './xr/GlobeScene.js';
import { initialTileSource, type TileSource } from './xr/ImageryGlobe.js';

/**
 * Immersive WebXR renderer (R3F).
 *
 * Cesium has no WebXR (ADR-0001), so headsets get the same Story on a three.js
 * globe — but "the same Story" has to mean the same Earth, not a coloured
 * sphere. This renderer streams real imagery as 3D Tiles, is driven by
 * Google Earth VR's grab locomotion, and puts each memory's title and date on a
 * card you can read from where you are standing.
 *
 * The parts, in the order they matter:
 *
 *  - `xr/worldTransform.ts` — the player-space ↔ Earth-space transform, and the
 *    reason planet-scale coordinates survive float32 poses. Unit-tested.
 *  - `xr/useGlobeLocomotion.ts` — grip to grab, two grips to zoom; plus mouse
 *    fallbacks so the same state machine is usable in a flat browser window.
 *  - `xr/ImageryGlobe.tsx` — Esri World Imagery (keyless) or Google
 *    Photorealistic 3D Tiles, through NASA-AMMOS `3d-tiles-renderer`.
 *  - `xr/MemoryPins.tsx` — pins at real coordinates, sized by angle, with
 *    readable cards for the ones being looked at.
 *
 * URL switches: `?renderer=xr` forces this renderer, `?tiles=esri|google`
 * chooses the imagery, `?emulate=1` runs the WebXR device emulator so a session
 * can be entered (and driven) without a headset.
 */
const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

export const xrStore = createXRStore({
  // `iwer` normally only stands in for a headset on `localhost`; `?emulate=1`
  // turns it on anywhere, which is the nearest thing to a real XR session
  // (poses, grips, stereo) available from a dev server on 127.0.0.1 or a LAN
  // address. Two things to know before relying on it: iwer refuses to replace a
  // native `navigator.xr`, so a browser that ships WebXR without hardware needs
  // that property hidden first; and as of @iwer/devui 2.x its debug overlay
  // bundles its own older three and throws `material.onBuild is not a function`
  // against three 0.183, which stops the frame loop. It gets you into a
  // session, not through one.
  emulate: params.get('emulate') === '1' ? { inject: true, syntheticEnvironment: false } : undefined,
  // Foveation trades edge sharpness for fill rate. The globe's detail is where
  // the viewer is looking, so this is nearly free.
  foveation: 0.4,
});

export interface XRStorySceneProps {
  story: Story;
  /** Pre-derived memories, when the caller already has them. */
  memories?: AtlasMemory[];
  focusedId?: string | null;
  onPick?: (memory: AtlasMemory) => void;
}

export function XRStoryScene({ story, memories, focusedId, onPick }: XRStorySceneProps) {
  const model = useMemo(() => memories ?? deriveModel(story).memories, [story, memories]);
  const [focused, setFocused] = useState<string | null>(focusedId ?? null);
  const [source, setSource] = useState<TileSource>(initialTileSource);
  const [credits, setCredits] = useState<string[]>([]);
  const [vrSupported, setVrSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (focusedId !== undefined) setFocused(focusedId);
  }, [focusedId]);

  useEffect(() => {
    let live = true;
    const xr = navigator.xr;
    if (!xr) {
      setVrSupported(false);
      return;
    }
    void xr
      .isSessionSupported('immersive-vr')
      .then((ok) => live && setVrSupported(ok))
      .catch(() => live && setVrSupported(false));
    return () => {
      live = false;
    };
  }, []);

  const focus = useCallback(
    (memory: AtlasMemory) => {
      setFocused(memory.id);
      onPick?.(memory);
    },
    [onPick],
  );

  // Photorealistic tiles need the Map Tiles API enabled on the key, which is a
  // separate switch from the other Maps products Atlas uses. Falling back keeps
  // a misconfigured key from leaving the viewer staring at an empty sky.
  const onSourceFailed = useCallback((failed: TileSource) => {
    if (failed === 'google') setSource('esri');
  }, []);

  return (
    <div style={styles.root}>
      <Canvas
        style={styles.canvas}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        // `rotation` is load-bearing: without it R3F aims the default camera at
        // the scene origin, which here is the floor between the viewer's feet —
        // the globe sits in front of them at eye height and never enters the
        // frustum, so the scene renders black with nothing to explain it.
        //
        // Near/far are re-derived every frame from where the viewer is
        // (`depthRange`); these are only what the first frame uses.
        camera={{ fov: 62, near: 0.02, far: 400, position: [0, 1.6, 0], rotation: [0, 0, 0] }}
      >
        <XR store={xrStore}>
          <GlobeScene
            memories={model}
            focusedId={focused}
            onFocus={focus}
            source={source}
            onSourceFailed={onSourceFailed}
            onAttributions={setCredits}
          />
        </XR>
      </Canvas>

      <div style={styles.chrome}>
        <button type="button" style={styles.enter} onClick={() => void xrStore.enterVR()}>
          Enter VR
        </button>
        <span style={styles.note}>
          {vrSupported === false
            ? 'No headset detected — drag to turn the globe, scroll to zoom.'
            : 'Drag to turn the globe, scroll to zoom.'}
        </span>
      </div>

      {/* Third-party imagery: the credit is a condition of using it. In a
          session there is no DOM, so the scene carries it too (see InfoPanel). */}
      <div style={styles.credit}>{credits.join(' · ')}</div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'absolute',
    inset: 0,
    background: 'var(--background, #041620)',
    color: 'var(--foreground, #e8f2f4)',
    fontFamily: "var(--font-sans, 'Manrope', system-ui, sans-serif)",
  },
  canvas: { position: 'absolute', inset: 0, touchAction: 'none' },
  chrome: {
    position: 'absolute',
    top: 16,
    left: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    pointerEvents: 'none',
  },
  enter: {
    pointerEvents: 'auto',
    background: 'var(--primary, #c5e8dc)',
    color: 'var(--primary-foreground, #041620)',
    border: 'none',
    borderRadius: 999,
    padding: '10px 20px',
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: 0.2,
    cursor: 'pointer',
  },
  note: { fontSize: 12, opacity: 0.7 },
  credit: {
    position: 'absolute',
    bottom: 10,
    left: 16,
    right: 16,
    fontSize: 11,
    opacity: 0.6,
    pointerEvents: 'none',
  },
};
