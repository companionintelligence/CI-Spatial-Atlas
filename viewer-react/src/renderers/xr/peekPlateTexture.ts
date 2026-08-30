/**
 * The peek plate's face, composited on a 2D canvas.
 *
 * Image and caption go in one texture rather than two quads because they have
 * to stay glued together on a curved surface: a separate caption plane would
 * either float off the bow or need its own curvature, and both cost a draw call
 * per plate for nothing.
 *
 * Compositing needs an untainted canvas, so the image must be CORS-loaded —
 * `maps.googleapis.com` sends `access-control-allow-origin: *` for Street View
 * Static, and the caller sets `crossOrigin` before assigning `src`. Without that
 * the canvas taints and `texImage2D` throws at upload time, not at draw time,
 * which is a confusing place to find out.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import type { LabelCard } from './labelCard.js';

// The same palette and face as `labelCard`, kept local so the two immersive
// surfaces can be restyled independently of each other.
const FONT = "'Manrope', system-ui, -apple-system, sans-serif";
const INK = '#e8f2f4';
const MUTED = '#a3babf';
const BACKING = 'rgba(4, 22, 32, 0.9)';
const EDGE = 'rgba(197, 232, 220, 0.26)';

/** Design width in texture pixels; the Static API tops out at 640 anyway. */
const WIDTH = 640;
const PAD = 22;
const RADIUS = 20;
const TITLE_SIZE = 30;
const META_SIZE = 22;
const CREDIT_SIZE = 17;
/** Stand-in height when there is no picture, so the plate keeps a plate's shape. */
const ABSENT_HEIGHT = 210;

export interface PeekPlateContent {
  /** Fully loaded and CORS-clean, or null when there is no imagery to show. */
  image: HTMLImageElement | null;
  title: string;
  place?: string;
  when?: string;
  /** "Street View · 2018-04". Omitted when there is no image to credit. */
  credit?: string | null;
  /** Why there is no picture, in the viewer's language. */
  absence?: string;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Shorten to fit, with an ellipsis, rather than run off the plate. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Draw the plate. The caller owns the returned texture and must `dispose()` it.
 */
export function drawPeekPlate({ image, title, place, when, credit, absence }: PeekPlateContent): LabelCard {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // The picture keeps its own proportions. Cropping it to a designed rectangle
  // would take the bottom strip with it, and that strip is where Google's
  // watermark is burnt in — the attribution the imagery ships with.
  const imageHeight = image && image.naturalWidth > 0
    ? Math.round((WIDTH * image.naturalHeight) / image.naturalWidth)
    : ABSENT_HEIGHT;
  const captionHeight = PAD * 2 + TITLE_SIZE + (place || when ? META_SIZE + 10 : 0);
  const height = imageHeight + captionHeight;

  canvas.width = WIDTH;
  canvas.height = height;
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = BACKING;
  roundRect(ctx, 0, 0, WIDTH, height, RADIUS);
  ctx.fill();

  // Clip so the picture takes the plate's rounded top corners rather than
  // squaring them off.
  ctx.save();
  roundRect(ctx, 0, 0, WIDTH, imageHeight + RADIUS, RADIUS);
  ctx.clip();
  if (image) {
    ctx.drawImage(image, 0, 0, WIDTH, imageHeight);
    // Darken the foot of the picture so the credit stays readable over a bright
    // sky or a white wall.
    const shade = ctx.createLinearGradient(0, imageHeight - 90, 0, imageHeight);
    shade.addColorStop(0, 'rgba(2, 12, 18, 0)');
    shade.addColorStop(1, 'rgba(2, 12, 18, 0.72)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, imageHeight - 90, WIDTH, 90);
  } else {
    ctx.fillStyle = 'rgba(10, 34, 46, 0.9)';
    ctx.fillRect(0, 0, WIDTH, imageHeight);
    ctx.fillStyle = MUTED;
    ctx.font = `500 ${META_SIZE}px ${FONT}`;
    ctx.textAlign = 'center';
    const message = absence ?? 'No Street View of this place';
    ctx.fillText(fit(ctx, message, WIDTH - PAD * 2), WIDTH / 2, imageHeight / 2 + META_SIZE / 3);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  if (image && credit) {
    ctx.font = `600 ${CREDIT_SIZE}px ${FONT}`;
    const label = credit;
    const w = ctx.measureText(label).width + 18;
    const h = CREDIT_SIZE + 14;
    ctx.fillStyle = 'rgba(2, 10, 14, 0.66)';
    roundRect(ctx, WIDTH - PAD - w, imageHeight - PAD - h, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.fillText(label, WIDTH - PAD - w + 9, imageHeight - PAD - 10);
  }

  let y = imageHeight + PAD + TITLE_SIZE - 6;
  ctx.fillStyle = INK;
  ctx.font = `600 ${TITLE_SIZE}px ${FONT}`;
  ctx.fillText(fit(ctx, title || 'Untitled memory', WIDTH - PAD * 2), PAD, y);

  const meta = [when, place].filter(Boolean).join(' · ');
  if (meta) {
    y += META_SIZE + 10;
    ctx.fillStyle = MUTED;
    ctx.font = `500 ${META_SIZE}px ${FONT}`;
    ctx.fillText(fit(ctx, meta, WIDTH - PAD * 2), PAD, y);
  }

  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, WIDTH - 2, height - 2, RADIUS);
  ctx.stroke();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter; // no mipmaps: the plate is read near 1:1
  texture.anisotropy = 4;
  return { texture, aspect: WIDTH / height };
}
