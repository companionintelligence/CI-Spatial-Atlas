/**
 * The comfort settings, inside the session.
 *
 * There is no DOM in an immersive session, so a settings screen in the page is
 * not a settings screen at all — by the time someone needs these controls they
 * are wearing the headset and feeling ill, and "take it off, find the browser
 * tab, come back" is not a recovery path. So the panel is scene geometry: a
 * card in player space, next to the credits panel, clickable with a controller
 * ray in a session and with the mouse in a flat window.
 *
 * Every toggle defaults on (see `DEFAULT_COMFORT`) and every change is written
 * to `localStorage` immediately, because the person who switches one off is
 * making a considered choice and should not have to make it again, while the
 * person who never opens this panel gets the careful defaults for ever.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { labelFontReady } from './labelCard.js';
import type { ComfortSettings } from './comfort.js';
import type { WorldHandle } from './useGlobeLocomotion.js';

const _viewer = new Vector3();
const _toViewer = new Vector3();
const _origin = new Vector3();
const _direction = new Vector3();
const _quat = new Quaternion();
const _ray = new Raycaster();

/**
 * Sources whose trigger was already down last frame, so a toggle fires on the
 * press edge and a held trigger does not flip it ninety times a second.
 */
const triggerHeld = new WeakSet<XRInputSource>();

interface Row {
  key: keyof ComfortSettings;
  label: string;
  hint: string;
}

const ROWS: Row[] = [
  { key: 'tunnel', label: 'Comfort tunnel', hint: 'Narrow the view, show the room, while moving' },
  { key: 'steadyStars', label: 'Steady stars', hint: 'Hold the sky still while the world turns' },
  { key: 'snapTurn', label: 'Snap turn', hint: 'Thumbstick turns the view in 30° steps' },
  { key: 'levelHorizon', label: 'Level horizon', hint: 'Keep the wrists from rolling the world' },
];

// Logical layout, in canvas pixels. Shared by the drawing and by the invisible
// click targets, so a row's picture and its hit box cannot drift apart.
const WIDTH = 380;
const PAD = 14;
const HEADER = 36;
const ROW_H = 44;
const HEIGHT = PAD * 2 + HEADER + ROWS.length * ROW_H;
const ASPECT = WIDTH / HEIGHT;

/** Centre of row `i` in canvas pixels — the one place the layout is decided. */
const rowCentre = (i: number) => PAD + HEADER + i * ROW_H + ROW_H / 2;

const SCALE = 2;
const FONT = "'Manrope', system-ui, -apple-system, sans-serif";
const INK = '#e8f2f4';
const MUTED = '#a3babf';
const ON = '#58ebbf';
const OFF = 'rgba(232, 242, 244, 0.22)';
const BACKING = 'rgba(4, 22, 32, 0.9)';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPanel(settings: ComfortSettings): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = BACKING;
  roundRect(ctx, 0, 0, WIDTH, HEIGHT, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(197, 232, 220, 0.24)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText('Comfort', PAD, PAD + 20);
  ctx.fillStyle = MUTED;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText('on unless you turn them off', PAD + 92, PAD + 20);

  ROWS.forEach((row, i) => {
    const top = PAD + HEADER + i * ROW_H;
    const on = settings[row.key];

    ctx.fillStyle = INK;
    ctx.font = `600 17px ${FONT}`;
    ctx.fillText(row.label, PAD, top + 18);
    ctx.fillStyle = MUTED;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText(row.hint, PAD, top + 34);

    // Toggle: a pill with the knob to the right when on. Colour alone would be
    // a poor signal here — it has to read at a glance, in a headset, from a
    // metre away, to someone who is already uncomfortable.
    const pillW = 42;
    const pillH = 22;
    const x = WIDTH - PAD - pillW;
    const y = top + 8;
    ctx.fillStyle = on ? ON : OFF;
    roundRect(ctx, x, y, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = on ? '#04202c' : '#e8f2f4';
    ctx.beginPath();
    ctx.arc(on ? x + pillW - pillH / 2 : x + pillH / 2, y + pillH / 2, pillH / 2 - 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

export interface ComfortPanelProps {
  world: WorldHandle;
  settings: ComfortSettings;
  onToggle: (key: keyof ComfortSettings) => void;
  /** Where it sits in player space. */
  position: [number, number, number];
  /** Panel height in player metres. */
  height?: number;
}

export function ComfortPanel({ world, settings, onToggle, position, height = 0.28 }: ComfortPanelProps) {
  const group = useRef<Group>(null);
  const targets = useRef<(Mesh | null)[]>([]);
  const highlight = useRef<Mesh>(null);
  const [texture, setTexture] = useState<CanvasTexture | null>(null);

  useEffect(() => {
    let live = true;
    let made: CanvasTexture | null = null;
    // Manrope may not have reached the font set yet; a card drawn before it has
    // bakes the platform fallback in for good.
    void labelFontReady().then(() => {
      if (!live) return;
      made = drawPanel(settings);
      setTexture(made);
    });
    return () => {
      live = false;
      made?.dispose();
    };
  }, [settings]);

  useFrame((state, _delta, frame) => {
    const node = group.current;
    if (!node) return;
    state.camera.getWorldPosition(_viewer);
    // Yaw only, like the credits panel: a control surface that rolls with the
    // head is both unreadable and, in a headset, faintly nauseating.
    _toViewer.subVectors(_viewer, node.position);
    node.rotation.set(0, Math.atan2(_toViewer.x, _toViewer.z), 0);

    // Controller rays, picked by hand.
    //
    // R3F's own pointer events reach these meshes from the mouse, and from the
    // mouse only: nothing in this app wires the controllers into the pointer
    // system, so a `onClick` alone is a control that works on a desk and does
    // nothing whatsoever in a headset — which for *these* controls would be the
    // worst place to find out. The wrist menu solves it the same way.
    const session = state.gl.xr.getSession?.();
    const space = state.gl.xr.getReferenceSpace?.();
    let hovered = -1;
    if (session && frame && space) {
      const meshes = targets.current.filter((m): m is Mesh => !!m);
      for (const source of session.inputSources) {
        const pose = source.targetRaySpace ? frame.getPose(source.targetRaySpace, space) : undefined;
        if (!pose) continue;
        const p = pose.transform.position;
        const o = pose.transform.orientation;
        _origin.set(p.x, p.y, p.z);
        _direction.set(0, 0, -1).applyQuaternion(_quat.set(o.x, o.y, o.z, o.w));
        _ray.set(_origin, _direction);
        const hit = _ray.intersectObjects(meshes, false)[0];
        const row = hit ? meshes.indexOf(hit.object as Mesh) : -1;
        if (row >= 0) hovered = row;

        // The trigger, on the press edge. The grip is the world grab and has to
        // stay free — reaching for a setting must never also seize the planet.
        const button = source.gamepad?.buttons?.[0];
        const down = !!button && (button.pressed || button.value > 0.6);
        const was = triggerHeld.has(source);
        if (down) triggerHeld.add(source);
        else triggerHeld.delete(source);
        if (down && !was && row >= 0) onToggle(ROWS[row]!.key);
      }
    }

    const mark = highlight.current;
    if (mark) {
      mark.visible = hovered >= 0;
      if (hovered >= 0) mark.position.y = height * (0.5 - rowCentre(hovered) / HEIGHT);
    }
  });

  const width = height * ASPECT;
  const rowHeight = (ROW_H / HEIGHT) * height;

  if (!texture) return null;
  return (
    <group ref={group} position={position}>
      <mesh renderOrder={26}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Where the ray is pointing. There is no haptic edge to a plane floating
          in the air, so without this the only feedback is the toggle flipping,
          which is too late to be aim. */}
      <mesh ref={highlight} renderOrder={27} visible={false}>
        <planeGeometry args={[width * 0.97, rowHeight]} />
        <meshBasicMaterial color="#72ddd4" transparent opacity={0.2} depthTest={false} depthWrite={false} />
      </mesh>
      {ROWS.map((row, i) => (
        // Invisible, but present: a mesh with `visible={false}` is skipped by
        // the raycaster, so the hit box is a fully transparent one instead.
        <mesh
          key={row.key}
          ref={(node) => {
            targets.current[i] = node;
          }}
          renderOrder={28}
          position={[0, height * (0.5 - rowCentre(i) / HEIGHT), 0.001]}
          onClick={(event) => {
            event.stopPropagation();
            // A drag that happens to finish over the panel is someone spinning
            // the globe, not someone changing a setting.
            if (world.dragged > 6) return;
            onToggle(row.key);
          }}
        >
          <planeGeometry args={[width, rowHeight]} />
          <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
