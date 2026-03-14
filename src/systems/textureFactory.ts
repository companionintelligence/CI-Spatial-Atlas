import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared noise primitives
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function buildGrid(gw: number, gh: number, rand: () => number): Float32Array {
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  return grid;
}

/**
 * Sample a value-noise grid.
 * X wraps (spherical equator seam), Y clamps (poles).
 */
function sampleGrid(
  grid: Float32Array,
  gw: number,
  gh: number,
  gx: number,
  gy: number
): number {
  const iy = Math.max(0, Math.min(Math.floor(gy), gh - 1));
  const ix = ((Math.floor(gx) % gw) + gw) % gw;
  const fx = smoothstep(gx - Math.floor(gx));
  const fy = smoothstep(gy - Math.floor(gy));
  const x1 = (ix + 1) % gw;
  const y1 = Math.min(iy + 1, gh - 1);
  return lerp(
    lerp(grid[iy * gw + ix], grid[iy * gw + x1], fx),
    lerp(grid[y1 * gw + ix], grid[y1 * gw + x1], fx),
    fy
  );
}

// ---------------------------------------------------------------------------
// Earth surface texture (1024 × 512 equirectangular)
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic procedural earth texture.
 * Accepts a seeded random function so output is fully reproducible.
 */
export function createEarthTexture(rand: () => number): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;

  // Three octaves of value noise for height field
  const GW0 = 8, GH0 = 4;
  const GW1 = 16, GH1 = 8;
  const GW2 = 32, GH2 = 16;
  const grid0 = buildGrid(GW0, GH0, rand);
  const grid1 = buildGrid(GW1, GH1, rand);
  const grid2 = buildGrid(GW2, GH2, rand);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / W;
      const ny = y / H;

      const v0 = sampleGrid(grid0, GW0, GH0, nx * GW0, ny * (GH0 - 1));
      const v1 = sampleGrid(grid1, GW1, GH1, nx * GW1, ny * (GH1 - 1));
      const v2 = sampleGrid(grid2, GW2, GH2, nx * GW2, ny * (GH2 - 1));
      const height = v0 * 0.60 + v1 * 0.28 + v2 * 0.12;

      // Latitude: Three.js CanvasTexture flipY=true maps canvas-top → north pole
      const lat = (0.5 - ny) * Math.PI; // −π/2 (south) … +π/2 (north)
      const absLat = Math.abs(lat);
      const iceFactor = Math.max(0, (absLat - 1.22) / (Math.PI * 0.5 - 1.22));

      let r: number;
      let g: number;
      let b: number;

      if (iceFactor > 0.06) {
        // Ice / snow
        const t = Math.min(1, iceFactor * 3.5);
        r = Math.round(205 + 45 * t);
        g = Math.round(225 + 25 * t);
        b = Math.round(240 + 15 * t);
      } else if (height > 0.51) {
        const elev = (height - 0.51) / 0.49;
        if (elev > 0.60) {
          // Highlands / mountain rock
          const t = (elev - 0.60) / 0.40;
          r = Math.round(105 + 105 * t);
          g = Math.round(88 + 62 * t);
          b = Math.round(65 + 70 * t);
        } else {
          // Lowlands / vegetation
          const t = elev / 0.60;
          r = Math.round(32 + 52 * t);
          g = Math.round(88 + 48 * t);
          b = Math.round(22 + 30 * t);
        }
      } else {
        // Ocean — shallow near shore, deeper further out
        const depth = 1 - height / 0.51;
        r = Math.round(6 + 24 * (1 - depth));
        g = Math.round(38 + 58 * (1 - depth));
        b = Math.round(100 + 88 * (1 - depth));
      }

      const idx = (y * W + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// Cloud layer texture (512 × 256 equirectangular, RGBA)
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic semi-transparent cloud texture.
 * Alpha channel drives cloud coverage; RGB is white.
 */
export function createCloudTexture(rand: () => number): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;

  const GW0 = 12, GH0 = 6;
  const GW1 = 24, GH1 = 12;
  const grid0 = buildGrid(GW0, GH0, rand);
  const grid1 = buildGrid(GW1, GH1, rand);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / W;
      const ny = y / H;

      const v0 = sampleGrid(grid0, GW0, GH0, nx * GW0, ny * (GH0 - 1));
      const v1 = sampleGrid(grid1, GW1, GH1, nx * GW1, ny * (GH1 - 1));
      const cloudVal = v0 * 0.62 + v1 * 0.38;

      const rawAlpha = Math.max(0, (cloudVal - 0.51) / 0.49);
      const alpha = Math.round(Math.pow(rawAlpha, 0.55) * 215);

      const idx = (y * W + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return new THREE.CanvasTexture(canvas);
}
