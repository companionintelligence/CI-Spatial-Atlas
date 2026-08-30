/**
 * A gently curved quad — the shape a held panel wants to be in a headset.
 *
 * A flat plane held 30 cm from the face is read at a noticeably different
 * distance at its edges than at its middle, and in stereo that difference is
 * large enough to be felt: the corners drift and the text at them softens. Bow
 * the plate around the viewer and every part of it sits at the same distance,
 * which is why every VR panel worth reading is curved.
 *
 * A cylinder segment would do it, but its UVs wrap and its normals face outward,
 * so a picture on the concave side needs `BackSide` and a flipped texture. This
 * builds the grid directly instead: chord width is exactly `width`, UVs run 0..1
 * the way an image expects, and the front face is +Z.
 */
import { BufferAttribute, BufferGeometry } from 'three';

export interface CurvedPlateOptions {
  /** Chord width, in metres — edge to edge in a straight line, not arc length. */
  width: number;
  height: number;
  /** How far the edges bow toward the viewer, as a fraction of the width. */
  curvature?: number;
  /** Columns across the bow. Rows are fixed at one; the bow is only in x. */
  segments?: number;
}

/**
 * Build the plate. The caller owns the geometry and must `dispose()` it.
 *
 * The bow is a parabola rather than a true arc: at the shallow curvatures a
 * hand-held plate wants (under a tenth of its width) the two differ by less than
 * a millimetre, and a parabola keeps the columns evenly spaced across the
 * texture, so the image is not stretched at the edges.
 */
export function curvedPlateGeometry({
  width,
  height,
  curvature = 0.08,
  segments = 20,
}: CurvedPlateOptions): BufferGeometry {
  const columns = Math.max(1, Math.floor(segments));
  const sagitta = width * curvature;
  const count = (columns + 1) * 2;

  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const normals = new Float32Array(count * 3);

  for (let i = 0; i <= columns; i++) {
    const u = i / columns;
    // -1 at the left edge, +1 at the right, so the bow is symmetric about 0.
    const t = u * 2 - 1;
    const x = t * width * 0.5;
    const z = sagitta * t * t;
    // Surface slope dz/dx; the normal is that turned a quarter turn and pointed
    // back at the viewer.
    const slope = (2 * sagitta * t * 2) / width;
    const inv = 1 / Math.hypot(slope, 1);

    for (let j = 0; j < 2; j++) {
      const v = j; // 0 = bottom row, 1 = top
      const index = j * (columns + 1) + i;
      positions.set([x, (v - 0.5) * height, z], index * 3);
      uvs.set([u, v], index * 2);
      normals.set([-slope * inv, 0, inv], index * 3);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < columns; i++) {
    const bl = i;
    const br = i + 1;
    const tl = columns + 1 + i;
    const tr = columns + 2 + i;
    // Counter-clockwise seen from +Z, so the front face is the one turned
    // toward the viewer.
    indices.push(bl, br, tr, bl, tr, tl);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}
