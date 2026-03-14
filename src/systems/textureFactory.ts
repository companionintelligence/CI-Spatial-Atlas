import * as THREE from 'three';
import { selectTileUrl } from './tileProvider';

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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    image.src = url;
  });
}

function latToMercatorV(latRad: number): number {
  const y = Math.log(Math.tan(Math.PI * 0.25 + latRad * 0.5));
  return 0.5 - y / (2 * Math.PI);
}

/**
 * Load OpenStreetMap tiles and remap them to an equirectangular texture.
 * If network loading fails, fallback imagery remains in place.
 */
export function createEarthTileTexture(fallback: THREE.CanvasTexture, zoom = 3): THREE.CanvasTexture {
  const fallbackCanvas = fallback.image as HTMLCanvasElement;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = fallbackCanvas.width;
  outCanvas.height = fallbackCanvas.height;
  const outCtx = outCanvas.getContext('2d')!;
  outCtx.drawImage(fallbackCanvas, 0, 0);

  const outputTexture = new THREE.CanvasTexture(outCanvas);

  void (async () => {
    const tileCount = 1 << zoom;
    const tileSize = 256;
    const mercatorCanvas = document.createElement('canvas');
    mercatorCanvas.width = tileCount * tileSize;
    mercatorCanvas.height = tileCount * tileSize;
    const mercatorCtx = mercatorCanvas.getContext('2d')!;

    try {
      const jobs: Array<Promise<void>> = [];

      for (let ty = 0; ty < tileCount; ty++) {
        for (let tx = 0; tx < tileCount; tx++) {
          const url = selectTileUrl(zoom, tx, ty);
          jobs.push(
            loadImage(url).then((image) => {
              mercatorCtx.drawImage(image, tx * tileSize, ty * tileSize, tileSize, tileSize);
            })
          );
        }
      }

      await Promise.all(jobs);

      const srcData = mercatorCtx.getImageData(0, 0, mercatorCanvas.width, mercatorCanvas.height).data;
      const outImage = outCtx.createImageData(outCanvas.width, outCanvas.height);
      const outData = outImage.data;

      for (let y = 0; y < outCanvas.height; y++) {
        const vEq = y / (outCanvas.height - 1);
        const lat = (0.5 - vEq) * Math.PI;
        const vMerc = Math.min(1, Math.max(0, latToMercatorV(lat)));
        const sy = Math.min(mercatorCanvas.height - 1, Math.max(0, Math.round(vMerc * (mercatorCanvas.height - 1))));

        for (let x = 0; x < outCanvas.width; x++) {
          const sx = Math.min(mercatorCanvas.width - 1, Math.max(0, Math.round((x / (outCanvas.width - 1)) * (mercatorCanvas.width - 1))));
          const srcIdx = (sy * mercatorCanvas.width + sx) * 4;
          const outIdx = (y * outCanvas.width + x) * 4;

          outData[outIdx] = srcData[srcIdx];
          outData[outIdx + 1] = srcData[srcIdx + 1];
          outData[outIdx + 2] = srcData[srcIdx + 2];
          outData[outIdx + 3] = 255;
        }
      }

      outCtx.putImageData(outImage, 0, 0);
      outputTexture.needsUpdate = true;
    } catch {
      // Keep deterministic fallback texture if network tiles fail.
    }
  })();

  return outputTexture;
}

/**
 * Load overlay map tiles and remap them to a 1024×512 equirectangular canvas.
 * The canvas starts transparent; tiles are composited with their native alpha.
 * Suitable for hillshade, label, and ocean overlays.
 *
 * @param getUrl  Returns a tile URL for (z, x, y), or null to skip that tile.
 * @param zoom    Tile zoom level (default 3 = 8×8 tiles = 64 tiles total).
 */
export function createOverlayTileTexture(
  getUrl: (z: number, x: number, y: number) => string | null,
  zoom = 3
): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const outputTexture = new THREE.CanvasTexture(canvas);

  void (async () => {
    const tileCount = 1 << zoom;
    const tileSize = 256;
    const mercatorCanvas = document.createElement('canvas');
    mercatorCanvas.width  = tileCount * tileSize;
    mercatorCanvas.height = tileCount * tileSize;
    const mercatorCtx = mercatorCanvas.getContext('2d')!;

    const jobs: Array<Promise<void>> = [];
    for (let ty = 0; ty < tileCount; ty++) {
      for (let tx = 0; tx < tileCount; tx++) {
        const url = getUrl(zoom, tx, ty);
        if (!url) continue;
        jobs.push(
          loadImage(url)
            .then((img) => { mercatorCtx.drawImage(img, tx * tileSize, ty * tileSize, tileSize, tileSize); })
            .catch(() => { /* skip failed tiles */ })
        );
      }
    }

    try {
      await Promise.all(jobs);

      const srcData = mercatorCtx.getImageData(0, 0, mercatorCanvas.width, mercatorCanvas.height).data;
      const outImage = ctx.createImageData(W, H);
      const outData  = outImage.data;

      for (let y = 0; y < H; y++) {
        const vEq   = y / (H - 1);
        const lat   = (0.5 - vEq) * Math.PI;
        const vMerc = Math.min(1, Math.max(0, latToMercatorV(lat)));
        const sy    = Math.min(mercatorCanvas.height - 1, Math.max(0, Math.round(vMerc * (mercatorCanvas.height - 1))));

        for (let x = 0; x < W; x++) {
          const sx     = Math.min(mercatorCanvas.width - 1, Math.max(0, Math.round((x / (W - 1)) * (mercatorCanvas.width - 1))));
          const srcIdx = (sy * mercatorCanvas.width + sx) * 4;
          const outIdx = (y * W + x) * 4;
          outData[outIdx]     = srcData[srcIdx];
          outData[outIdx + 1] = srcData[srcIdx + 1];
          outData[outIdx + 2] = srcData[srcIdx + 2];
          outData[outIdx + 3] = srcData[srcIdx + 3];
        }
      }

      ctx.putImageData(outImage, 0, 0);
      outputTexture.needsUpdate = true;
    } catch {
      // Keep transparent canvas on failure.
    }
  })();

  return outputTexture;
}

/**
 * Build a deterministic night-lights map from a base earth texture.
 * Brighter clusters are placed mainly on land and away from polar caps.
 */
export function createNightLightsTexture(base: THREE.CanvasTexture, rand: () => number): THREE.CanvasTexture {
  const baseCanvas = base.image as HTMLCanvasElement;
  const W = baseCanvas.width;
  const H = baseCanvas.height;

  const srcCtx = baseCanvas.getContext('2d');
  const srcData = srcCtx?.getImageData(0, 0, W, H).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = W;
  outCanvas.height = H;
  const outCtx = outCanvas.getContext('2d')!;
  const outImage = outCtx.createImageData(W, H);
  const outData = outImage.data;

  // Low-frequency distribution grid for city clusters.
  const gridW = 56;
  const gridH = 28;
  const cityGrid = buildGrid(gridW, gridH, rand);

  for (let y = 0; y < H; y++) {
    const latFactor = Math.cos(((y / (H - 1)) - 0.5) * Math.PI);

    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const r = srcData ? srcData[idx] : 0;
      const g = srcData ? srcData[idx + 1] : 0;
      const b = srcData ? srcData[idx + 2] : 0;

      // Approximate land mask from color model.
      const isLand = g > b * 0.9 && g > r * 0.72;
      const cluster = sampleGrid(cityGrid, gridW, gridH, (x / W) * gridW, (y / H) * (gridH - 1));
      const cityChance = (cluster - 0.52) * 2.1;
      const intensity = Math.max(0, cityChance * latFactor);

      const light = isLand ? Math.pow(intensity, 1.45) : 0;
      const alpha = Math.min(255, Math.round(light * 210));

      outData[idx] = Math.round(255 * light);
      outData[idx + 1] = Math.round(184 * light);
      outData[idx + 2] = Math.round(92 * light);
      outData[idx + 3] = alpha;
    }
  }

  outCtx.putImageData(outImage, 0, 0);
  return new THREE.CanvasTexture(outCanvas);
}

/**
 * Generate a translucent global weather layer texture with storm bands.
 */
export function createWeatherTexture(rand: () => number): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;

  const GW0 = 20, GH0 = 10;
  const GW1 = 40, GH1 = 20;
  const grid0 = buildGrid(GW0, GH0, rand);
  const grid1 = buildGrid(GW1, GH1, rand);

  for (let y = 0; y < H; y++) {
    const lat = (0.5 - y / H) * Math.PI;
    const equatorBand = Math.exp(-Math.pow(lat / 0.6, 2));

    for (let x = 0; x < W; x++) {
      const nx = x / W;
      const ny = y / H;
      const v0 = sampleGrid(grid0, GW0, GH0, nx * GW0, ny * (GH0 - 1));
      const v1 = sampleGrid(grid1, GW1, GH1, nx * GW1, ny * (GH1 - 1));

      const stormVal = v0 * 0.55 + v1 * 0.45;
      const front = Math.max(0, (stormVal - 0.56) / 0.44);
      const alpha = Math.round(Math.min(1, front * (0.42 + equatorBand * 0.58)) * 185);

      const idx = (y * W + x) * 4;
      data[idx] = Math.round(170 + front * 65);
      data[idx + 1] = Math.round(208 + front * 38);
      data[idx + 2] = Math.round(255);
      data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return new THREE.CanvasTexture(canvas);
}
