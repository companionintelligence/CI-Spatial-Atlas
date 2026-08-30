/**
 * The shell everything in the sky hangs on — stars, sun, moon.
 *
 * A sky has one job: to sit far enough away that it never intersects anything,
 * and near enough that it is never clipped. Both halves are easy to get wrong
 * here because `depthRange` re-derives the camera's near/far every frame from
 * the world's scale, so there is no fixed distance that is always correct. At
 * globe scale the far plane is about 13 m; at street scale it is very different.
 *
 * Both sky bugs found so far were a shell that ignored this:
 *
 * - The sun and moon were parked at a fixed 260 units, which is outside a 13 m
 *   far plane. They were present, visible and correctly positioned, and drew
 *   nothing.
 * - The stars were left on the unit sphere the generator produces, centred on
 *   the world origin rather than on the viewer — a one-metre ball of points
 *   around the player's knees. Measured in a live session: 1400 stars spanning
 *   0.61 m to 2.6 m from an eye at 1.6 m, with 8 of them in the frustum.
 *
 * Sharing the maths is what stops the third one.
 */
import type { Camera } from 'three';

/**
 * Where to hang the sky, as a fraction of the live far plane.
 *
 * Depth testing is off for every sky object and they draw before the globe, so
 * they read as behind everything regardless of their true distance. Only
 * staying comfortably inside the frustum matters, and 0.45 leaves room for the
 * far plane to shrink between the frame that positions the sky and the frame
 * that draws it.
 */
export const SKY_FRACTION_OF_FAR = 0.45;

/**
 * The far plane a perspective projection matrix is really enforcing.
 *
 * This must come from the matrix, never from `camera.far`. The depth range is
 * only pushed into the matrix when it has moved materially — an
 * `updateProjectionMatrix` per frame is not free, and in XR every change costs
 * a `session.updateRenderState` — so the property routinely runs ahead of the
 * matrix that actually does the clipping. Trusting it put the sun and moon at
 * 6.2 m inside a nominal 13.7 m far plane and still clipped them, at an NDC z
 * of 1.018.
 *
 * With m10 = (f+n)/(n-f) and m14 = 2fn/(n-f), f falls out as m14 / (m10 + 1).
 */
export function projectionFar(e: ArrayLike<number>): number {
  const denom = e[10]! + 1;
  const far = Math.abs(denom) < 1e-9 ? Infinity : e[14]! / denom;
  return Number.isFinite(far) && far > 0 ? far : 1000;
}

/** The radius to place sky objects at for a camera, this frame. */
export function skyRadius(camera: Camera): number {
  return Math.max(1, projectionFar(camera.projectionMatrix.elements) * SKY_FRACTION_OF_FAR);
}
