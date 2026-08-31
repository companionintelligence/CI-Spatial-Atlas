/**
 * The off-hand menu: every memory, reachable.
 *
 * Before this, the immersive path drew 290 pins and could label six of them,
 * and the only way to reach a seventh was to grab the planet and go looking.
 * `flyTo` had existed in the locomotion module the whole time with no caller.
 *
 * The shape is the one VR has settled on for "a list you consult without
 * leaving what you are doing": a panel riding the non-dominant hand, pointed at
 * with the other. It borrows nothing from the desktop shell's palette except
 * the idea — there is no DOM inside a session, so the rows are drawn on a
 * canvas through `labelCard.ts`, the same way every other readable surface in
 * this scene is.
 *
 * Three things it deliberately does not do:
 *
 *  - **No continuous locomotion.** Selecting a memory is one eased flight to a
 *    fixed framing and then stillness. Wander ships no continuous translation
 *    at all and holds Meta's "Comfortable" rating for it; a globe you already
 *    hold in your hands has even less excuse for sliding a viewer around.
 *  - **No keyboard.** Voice when the browser has it (`voiceSearch.ts`), and a
 *    complete keyboard-free path — sort, category, initial, pager — when it
 *    does not, which includes the emulator this is tested in.
 *  - **No state of its own worth testing.** What the rows say and what they do
 *    is `memoryIndex.ts`, pure and unit-tested; this file is the panel, the
 *    wrist, and the ray.
 *
 * How big it is, how far off the hand it hangs and when it is up at all are in
 * `wristPanel.ts` — the arithmetic that decides whether this is a thing you
 * hold or a wall you stand behind, with the measurements that settled it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { MeshBasicMaterial } from 'three';
import type { AtlasMemory } from '../../model/atlasModel.js';
import { drawInfoCard, labelFontReady, rowAtPoint, type LabelCard } from './labelCard.js';
import {
  applyAction,
  buildMenu,
  initialMenuState,
  viewAnchor,
  type MenuAction,
  type MenuState,
} from './memoryIndex.js';
import type { WorldHandle } from './useGlobeLocomotion.js';
import { dictate, voiceSearchAvailable, type Dictation } from './voiceSearch.js';
import {
  fadeTowards,
  glanceVisible,
  panelHeight,
  panelLift,
  PANEL_PX,
  PANEL_WIDTH,
} from './wristPanel.js';

/**
 * Where it sits with no session — off to the left of the globe, which is how
 * `?renderer=xr` in an ordinary window stays a usable (and checkable) build.
 */
const FLAT_POSITION = new Vector3(-0.46, 1.4, -0.92);

const RAD2DEG = 180 / Math.PI;
/** The hovered row's tint at full fade. */
const HIGHLIGHT_OPACITY = 0.22;

const other = (hand: XRHandedness): XRHandedness => (hand === 'left' ? 'right' : 'left');

const _p = new Vector3();
const _q = new Quaternion();
const _offset = new Vector3();
const _rayO = new Vector3();
const _rayQ = new Quaternion();
const _rayD = new Vector3();
const _n = new Vector3();
const _hit = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _up = new Vector3();
const _basis = new Matrix4();
const _inv = new Quaternion();
const _gaze = new Vector3();
const _toHand = new Vector3();

function sourceFor(session: XRSession, handedness: XRHandedness): XRInputSource | undefined {
  for (const source of session.inputSources) if (source.handedness === handedness) return source;
  return undefined;
}

/** Pose of one hand's grip or pointing ray, in the session's reference space. */
function readPose(
  session: XRSession,
  frame: XRFrame,
  space: XRReferenceSpace,
  handedness: XRHandedness,
  which: 'grip' | 'ray',
  position: Vector3,
  quaternion: Quaternion,
): boolean {
  const source = sourceFor(session, handedness);
  if (!source) return false;
  const target = which === 'grip' ? (source.gripSpace ?? source.targetRaySpace) : source.targetRaySpace;
  const pose = frame.getPose(target, space);
  if (!pose) return false;
  position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
  quaternion.set(
    pose.transform.orientation.x,
    pose.transform.orientation.y,
    pose.transform.orientation.z,
    pose.transform.orientation.w,
  );
  return true;
}

/**
 * Trigger, and only the trigger.
 *
 * The grip is spoken for: it grabs the world (`useGlobeLocomotion`). Splitting
 * them this way is what lets a viewer hold the planet with one hand and pick
 * from the list with the other without the two fighting.
 */
function triggerPressed(session: XRSession, handedness: XRHandedness): boolean {
  const button = sourceFor(session, handedness)?.gamepad?.buttons?.[0];
  return !!button && (button.pressed || button.value > 0.5);
}

export interface WristMenuProps {
  world: WorldHandle;
  memories: AtlasMemory[];
  /** Selecting a row calls this; the scene decides how to fly there. */
  onTravel: (memory: AtlasMemory) => void;
  /** Which hand points. The panel rides the other one. */
  dominant?: XRHandedness;
}

export function WristMenu({ world, memories, onTravel, dominant = 'right' }: WristMenuProps) {
  const root = useRef<Group>(null);
  const panel = useRef<Mesh>(null);
  const highlight = useRef<Mesh>(null);
  const hovered = useRef(-1);
  /** Where the off hand's grip was this frame, for the dev handle to report. */
  const grip = useRef(new Vector3());
  /** Degrees between the gaze and the hand, and whether that is enough to show it. */
  const glance = useRef(0);
  const shown = useRef(true);
  /** 0–1 fade, so the panel arrives and leaves rather than blinking. */
  const lit = useRef(1);
  /** Row the trigger went down on, or -1. See the release-edge note in `useFrame`. */
  const armed = useRef(-1);
  const wasPressed = useRef(false);
  const dictation = useRef<Dictation | null>(null);
  const [card, setCard] = useState<LabelCard | null>(null);
  const [state, setState] = useState<MenuState>(() => initialMenuState());

  useEffect(() => {
    setState((s) => ({ ...s, voiceAvailable: voiceSearchAvailable() }));
    return () => dictation.current?.cancel();
  }, []);

  const view = useMemo(() => buildMenu(memories, state), [memories, state]);

  const listen = useCallback(() => {
    if (dictation.current) {
      dictation.current.cancel();
      dictation.current = null;
      setState((s) => ({ ...s, listening: false }));
      return;
    }
    const session = dictate((text) => {
      dictation.current = null;
      setState((s) => (text ? { ...s, text, page: 0, listening: false } : { ...s, listening: false }));
    });
    dictation.current = session;
    if (session) setState((s) => ({ ...s, listening: true }));
  }, []);

  const dispatch = useCallback(
    (action: MenuAction) => {
      if (action.kind === 'select') {
        onTravel(action.memory);
        return;
      }
      if (action.kind === 'voice') {
        listen();
        return;
      }
      setState((s) => {
        const next = applyAction(s, action);
        // "Nearest" has to mean nearest to what you are looking at *now*, so the
        // origin is sampled at the moment the viewer asks for it rather than
        // tracked live — a list that reorders itself under the pointer as the
        // globe drifts is unusable.
        return next.order === 'nearby' && s.order !== 'nearby'
          ? { ...next, origin: viewAnchor(world.transform, world.head) }
          : next;
      });
    },
    [listen, onTravel, world],
  );

  const fire = useCallback(
    (index: number) => {
      const row = view.rows[index];
      if (row) dispatch(row.action);
    },
    [dispatch, view],
  );

  useEffect(() => {
    let live = true;
    let made: LabelCard | null = null;
    void labelFontReady().then(() => {
      if (!live) return;
      made = drawInfoCard(
        view.heading,
        view.rows.map((r) => r.label),
        PANEL_PX,
        PANEL_PX,
      );
      setCard(made);
    });
    return () => {
      live = false;
      made?.texture.dispose();
    };
  }, [view]);

  // A dev handle on the live menu, for the same reason `GlobeScene` exposes one:
  // driving a controller ray onto a specific row from a test is a lot of
  // arithmetic to prove something the pure tests already cover, and this makes
  // "select row 7, assert the world moved" a two-line check in a real session.
  useEffect(() => {
    const env = (import.meta as unknown as { env: Record<string, unknown> }).env;
    if (!env.DEV) return;
    const w = window as unknown as { __atlasWristMenu?: unknown };
    w.__atlasWristMenu = {
      heading: view.heading,
      rows: view.rows.map((r) => `${r.action.kind}: ${r.label}`),
      total: view.total,
      pages: view.pages,
      select: (i: number) => fire(i),
      point: (i: number) => {
        hovered.current = i;
      },
      /** Which row the controller ray is on right now. */
      hovered: () => hovered.current,
      /** Where the panel is this frame, so a test can aim a real ray at a row. */
      pose: () =>
        root.current && card
          ? {
              position: root.current.position.toArray(),
              quaternion: root.current.quaternion.toArray(),
              width: PANEL_WIDTH,
              height: panelHeight(card.aspect),
              rows: card.rows,
            }
          : null,
      /** The hand it rides, so a check can measure the panel against the wrist. */
      grip: () => grip.current.toArray(),
      /** Why the panel is or is not up right now. */
      glance: () => ({ angleDeg: glance.current, shown: shown.current, opacity: lit.current }),
    };
    return () => {
      delete w.__atlasWristMenu;
    };
  }, [view, fire, card]);

  useFrame((frameState, delta, frame) => {
    const group = root.current;
    if (!group || !card) return;

    const xr = frameState.gl.xr;
    const session = xr.getSession?.() ?? undefined;
    const space = xr.getReferenceSpace?.() ?? undefined;
    const off = other(dominant);
    const height = panelHeight(card.aspect);

    // --- where the panel is ------------------------------------------------
    const onHand = !!(session && frame && space && readPose(session, frame, space, off, 'grip', _p, _q));
    if (onHand) {
      // Straight up from the hand, in world space, by its own half-height and a
      // finger's width — enough that the bottom edge clears the fingers and no
      // more. Deliberately *not* up the grip's own axis, which is what the flat
      // 0.2 m this replaces did: a naturally held controller tilts forward, so
      // its +Y runs up and back, and the lift swung the panel towards the face
      // instead of raising it. Measured, from a hand 0.46 m away it left the
      // panel 0.31 m from the eye. Up is up.
      group.position.copy(_p).add(_offset.set(0, panelLift(height), 0));
      grip.current.copy(_p);
      _up.set(0, 1, 0).applyQuaternion(_q); // roll with the wrist
    } else {
      group.position.copy(FLAT_POSITION);
      _up.set(0, 1, 0);
    }

    // Turn to the head. A wrist panel that keeps a fixed angle to the forearm
    // is only readable at one wrist rotation; turning it means a glance is
    // enough, which is the whole point of putting it on a hand.
    _z.copy(world.head).sub(group.position);
    if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1);
    _z.normalize();
    _x.copy(_up).cross(_z);
    if (_x.lengthSq() < 1e-8) _x.copy(_up.set(0, 1, 0)).cross(_z);
    _x.normalize();
    _y.copy(_z).cross(_x);
    group.quaternion.setFromRotationMatrix(_basis.makeBasis(_x, _y, _z));

    // --- is it being looked at ---------------------------------------------
    // A wrist UI is up when the wrist is, and out of the way when it is not.
    // Always up in a flat window: there is no hand to glance at there, and it
    // is the path an ordinary browser can still check.
    let target = 1;
    if (onHand) {
      frameState.camera.getWorldDirection(_gaze);
      _toHand.copy(grip.current).sub(world.head);
      const reach = _toHand.length();
      glance.current =
        reach > 1e-6
          ? Math.acos(Math.min(1, Math.max(-1, _toHand.divideScalar(reach).dot(_gaze)))) * RAD2DEG
          : 0;
      // A press that started on a row holds it up until the release. Fading a
      // panel out from under a held trigger would fire whatever row the ray
      // happened to be over on a surface the viewer can no longer see.
      shown.current = armed.current >= 0 || glanceVisible(shown.current, glance.current);
      target = shown.current ? 1 : 0;
    } else {
      shown.current = true;
      glance.current = 0;
    }
    lit.current = fadeTowards(lit.current, target, delta);
    group.visible = lit.current > 0.01;
    const face = panel.current?.material as MeshBasicMaterial | undefined;
    if (face) face.opacity = lit.current;
    const glow = highlight.current?.material as MeshBasicMaterial | undefined;
    if (glow) glow.opacity = HIGHLIGHT_OPACITY * lit.current;
    if (!shown.current) {
      hovered.current = -1;
      armed.current = -1;
    }

    // --- what the pointer is on -------------------------------------------
    // With no controller ray, `hovered` is whatever the mouse last set through
    // the panel mesh's pointer events — the flat-window path.
    let row = hovered.current;
    if (shown.current && session && frame && space && readPose(session, frame, space, dominant, 'ray', _rayO, _rayQ)) {
      _rayD.set(0, 0, -1).applyQuaternion(_rayQ);
      _n.set(0, 0, 1).applyQuaternion(group.quaternion);
      const denom = _rayD.dot(_n);
      row = -1;
      if (Math.abs(denom) > 1e-6) {
        const t = _n.dot(_hit.copy(group.position).sub(_rayO)) / denom;
        if (t > 0) {
          // The group is a direct child of the scene root and the app never
          // moves the XR origin (the world moves instead), so its local
          // transform is already player space.
          _hit
            .copy(_rayO)
            .addScaledVector(_rayD, t)
            .sub(group.position)
            .applyQuaternion(_inv.copy(group.quaternion).invert());
          row = rowAtPoint(card.rows, _hit.x / PANEL_WIDTH + 0.5, 0.5 - _hit.y / height);
        }
      }
      hovered.current = row;

      // Fire on the *release*, on the row the press started on.
      //
      // Two reasons, and the second one is not a nicety. It is how a button has
      // behaved since the Macintosh — press, notice you are on the wrong row,
      // slide off, let go, nothing happens. And a fly-to is cancelled by any
      // held input (`useGlobeLocomotion`, so that a viewer can stop a ride by
      // reaching for whatever is under their fingers), which means selecting on
      // the press starts a flight and then kills it on the very next frame with
      // the same still-held trigger. Measured: the world did not move at all.
      const pressed = triggerPressed(session, dominant);
      if (pressed !== wasPressed.current) {
        wasPressed.current = pressed;
        if (pressed) {
          armed.current = row;
        } else {
          const chosen = armed.current;
          armed.current = -1;
          if (chosen >= 0 && chosen === row) fire(row);
        }
      }
    }

    // --- the highlight -----------------------------------------------------
    const bar = highlight.current;
    const bounds = row >= 0 ? card.rows?.[row] : undefined;
    if (bar) {
      bar.visible = !!bounds;
      if (bounds) {
        const h = (bounds.bottom - bounds.top) * height;
        bar.scale.set(PANEL_WIDTH * 0.97, h, 1);
        bar.position.set(0, (0.5 - (bounds.top + bounds.bottom) / 2) * height, 0.001);
      }
    }
  });

  const pointAt = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const uv = event.uv;
      hovered.current = uv ? rowAtPoint(card?.rows, uv.x, 1 - uv.y) : -1;
    },
    [card],
  );

  const click = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      // A drag that happens to end on the panel is not a choice (same rule the
      // pins use).
      if (world.dragged > 6) return;
      const uv = event.uv;
      const row = uv ? rowAtPoint(card?.rows, uv.x, 1 - uv.y) : -1;
      if (row < 0) return;
      event.stopPropagation();
      fire(row);
    },
    [card, fire, world],
  );

  if (!card) return null;
  const height = panelHeight(card.aspect);

  return (
    <group ref={root}>
      {/* Depth testing off, like every other in-scene surface here: the panel is
          UI and must never be buried by the planet it is used to navigate. */}
      <mesh
        ref={panel}
        renderOrder={30}
        frustumCulled={false}
        onPointerMove={pointAt}
        onPointerOut={() => {
          hovered.current = -1;
        }}
        onClick={click}
      >
        <planeGeometry args={[PANEL_WIDTH, height]} />
        <meshBasicMaterial map={card.texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={highlight} renderOrder={31} frustumCulled={false} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="#72ddd4"
          transparent
          opacity={HIGHLIGHT_OPACITY}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
