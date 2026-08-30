/**
 * Memory labels, drawn on a 2D canvas and used as a texture.
 *
 * The alternative — SDF text via troika — pulls its default typeface off a CDN
 * at runtime and gives no control over the card around the words. Drawing the
 * whole card here keeps the immersive labels on the same Manrope and the same
 * token palette as every other Atlas surface, needs no network, and puts the
 * title, the date and the place in one quad instead of four draw calls.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

export interface LabelCard {
  texture: CanvasTexture;
  /** Card width / height, so the caller can size a quad by height alone. */
  aspect: number;
  /**
   * Where each line of an info card sits, as a fraction of the card's height
   * measured from the top.
   *
   * A pointable list has to answer "which line is the ray on?", and the answer
   * has to come from the same numbers that drew the text — deriving it a second
   * time in the caller means a highlight that drifts off its row the moment the
   * type metrics here change.
   */
  rows?: readonly CardRow[];
}

export interface CardRow {
  top: number;
  bottom: number;
}

export interface LabelContent {
  title: string;
  when?: string;
  place?: string;
  accent?: string;
}

/** Drawn at 2x so the card survives being leaned into. */
const SCALE = 2;
const PAD = 16;
const TITLE_SIZE = 26;
const META_SIZE = 19;
const LINE = 34;
const MAX_WIDTH = 420;
const FONT = "'Manrope', system-ui, -apple-system, sans-serif";

const INK = '#e8f2f4';
const MUTED = '#a3babf';
const BACKING = 'rgba(4, 22, 32, 0.88)';

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.length) {
    // Ellipsise the last line rather than letting it run under the card edge.
    let last = lines[maxLines - 1]!;
    if (ctx.measureText(last).width > max) {
      while (last.length > 1 && ctx.measureText(`${last}…`).width > max) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines.length ? lines : [''];
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

/**
 * Render one memory card. The caller owns the returned texture and must
 * `dispose()` it — these are per-memory and a globe full of them would
 * otherwise leak a canvas each.
 */
export function drawLabelCard({ title, when, place, accent = '#72ddd4' }: LabelContent): LabelCard {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // Measure first, at 1x, then size the canvas and redraw at SCALE.
  ctx.font = `600 ${TITLE_SIZE}px ${FONT}`;
  const titleLines = wrap(ctx, title || 'Untitled memory', MAX_WIDTH, 2);
  let width = Math.max(...titleLines.map((l) => ctx.measureText(l).width));
  ctx.font = `500 ${META_SIZE}px ${FONT}`;
  for (const line of [when, place]) if (line) width = Math.max(width, ctx.measureText(line).width);
  width = Math.min(Math.max(width, 140), MAX_WIDTH) + PAD * 2 + 10;

  const metaLines = (when ? 1 : 0) + (place ? 1 : 0);
  const height = PAD * 2 + titleLines.length * LINE + metaLines * (META_SIZE + 8);

  canvas.width = Math.ceil(width * SCALE);
  canvas.height = Math.ceil(height * SCALE);
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = BACKING;
  roundRect(ctx, 0, 0, width, height, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(197, 232, 220, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // A colour bar tying the card to the pin it belongs to.
  ctx.fillStyle = accent;
  roundRect(ctx, 0, 8, 5, height - 16, 2.5);
  ctx.fill();

  let y = PAD + TITLE_SIZE;
  ctx.fillStyle = INK;
  ctx.font = `600 ${TITLE_SIZE}px ${FONT}`;
  for (const line of titleLines) {
    ctx.fillText(line, PAD + 10, y);
    y += LINE;
  }

  y -= LINE - TITLE_SIZE - 6;
  ctx.font = `500 ${META_SIZE}px ${FONT}`;
  if (when) {
    ctx.fillStyle = accent;
    ctx.fillText(when, PAD + 10, y);
    y += META_SIZE + 8;
  }
  if (place) {
    ctx.fillStyle = MUTED;
    ctx.fillText(place, PAD + 10, y);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter; // no mipmaps: the card is only ever read near 1:1
  texture.anisotropy = 4;
  return { texture, aspect: width / height };
}

/**
 * A plain multi-line panel, for the things that must be readable inside a
 * headset and have nowhere else to go: the imagery attribution (required by
 * both providers' terms) and the control hints. There is no DOM in an immersive
 * session, so an overlay in the page is not a substitute.
 */
export function drawInfoCard(heading: string, lines: string[], maxWidth = 900, minWidth = 0): LabelCard {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // Size to the content rather than to a fixed width: the longest line is an
  // imagery credit, and truncating an attribution to fit a card is not a
  // licence anyone granted. `minWidth` is for the one card that must *not*
  // resize with its content — a menu whose rows shift under a pointer between
  // one redraw and the next is a menu you cannot hit.
  ctx.font = `600 ${TITLE_SIZE - 4}px ${FONT}`;
  let width = ctx.measureText(heading).width;
  ctx.font = `500 ${META_SIZE}px ${FONT}`;
  for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
  width = Math.max(minWidth, Math.min(width + PAD * 2, maxWidth));
  const height = PAD * 2 + LINE + lines.length * (META_SIZE + 7);

  canvas.width = Math.ceil(width * SCALE);
  canvas.height = Math.ceil(height * SCALE);
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = BACKING;
  roundRect(ctx, 0, 0, width, height, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(197, 232, 220, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `600 ${TITLE_SIZE - 4}px ${FONT}`;
  ctx.fillText(heading, PAD, PAD + TITLE_SIZE - 6);

  let y = PAD + LINE + META_SIZE - 4;
  ctx.font = `500 ${META_SIZE}px ${FONT}`;
  ctx.fillStyle = MUTED;
  const rows: CardRow[] = [];
  lines.forEach((line, i) => {
    let text = line;
    while (text.length > 1 && ctx.measureText(text).width > width - PAD * 2) text = text.slice(0, -1);
    ctx.fillText(text === line ? text : `${text}…`, PAD, y);
    y += META_SIZE + 7;
    const top = PAD + LINE + i * (META_SIZE + 7);
    rows.push({ top: top / height, bottom: (top + META_SIZE + 7) / height });
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.anisotropy = 4;
  return { texture, aspect: width / height, rows };
}

/**
 * Which row of an info card a point lands on, in card coordinates: `u` across
 * from the left, `y` down from the top, both 0–1. -1 for a miss.
 *
 * Down from the top, not up from the bottom, because that is the order the rows
 * were drawn in; a caller holding a three.js `uv` passes `1 - uv.y`.
 */
export function rowAtPoint(rows: readonly CardRow[] | undefined, u: number, y: number): number {
  if (!rows || u < 0 || u > 1 || y < 0 || y > 1) return -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (y >= row.top && y < row.bottom) return i;
  }
  return -1;
}

/**
 * Resolves once Manrope is actually available to the 2D context.
 *
 * `document.fonts` only has the face after the CSS has loaded it, and a canvas
 * silently falls back to the platform sans instead of waiting — so a card drawn
 * too early is permanently wrong, in a way that looks like a design mistake
 * rather than a race.
 */
export function labelFontReady(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return Promise.resolve();
  return Promise.all([
    fonts.load(`600 ${TITLE_SIZE}px Manrope`),
    fonts.load(`500 ${META_SIZE}px Manrope`),
  ])
    .then(() => undefined)
    .catch(() => undefined);
}
