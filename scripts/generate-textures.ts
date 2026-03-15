import { execFile as execFileCallback } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import jpeg from 'jpeg-js';
import { encodeToKTX2 } from 'ktx2-encoder';
import { PNG } from 'pngjs';

const execFile = promisify(execFileCallback);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const materialsDir = path.join(repoRoot, 'materials');
const publicDir = path.join(repoRoot, 'public');
const rawDir = path.join(publicDir, 'textures', 'raw');
const ktxDir = path.join(publicDir, 'textures', 'ktx2');
const basisDir = path.join(publicDir, 'basis');
const tempDir = path.join(repoRoot, '.tmp-textures');

type OutputFormat = 'jpg' | 'png';
type Transform = 'copy' | 'roughness' | 'cloud-alpha';
type ColorIntent = 'srgb' | 'linear';

interface TextureVariant {
  name: string;
  source: string;
  widths: number[];
  outputFormat: OutputFormat;
  transform: Transform;
  colorIntent: ColorIntent;
  isNormalMap?: boolean;
}

const variants: TextureVariant[] = [
  {
    name: 'earth-day',
    source: '8k_earth_daymap.jpg',
    widths: [4096, 2048],
    outputFormat: 'jpg',
    transform: 'copy',
    colorIntent: 'srgb'
  },
  {
    name: 'earth-night',
    source: '8k_earth_nightmap.jpg',
    widths: [4096, 2048],
    outputFormat: 'jpg',
    transform: 'copy',
    colorIntent: 'srgb'
  },
  {
    name: 'earth-normal',
    source: '8k_earth_normal_map.tif',
    widths: [4096, 2048],
    outputFormat: 'png',
    transform: 'copy',
    colorIntent: 'linear',
    isNormalMap: true
  },
  {
    name: 'earth-specular',
    source: '8k_earth_specular_map.tif',
    widths: [4096, 2048],
    outputFormat: 'png',
    transform: 'copy',
    colorIntent: 'linear'
  },
  {
    name: 'earth-roughness',
    source: '8k_earth_specular_map.tif',
    widths: [4096, 2048],
    outputFormat: 'png',
    transform: 'roughness',
    colorIntent: 'linear'
  },
  {
    name: 'earth-clouds',
    source: '8k_earth_clouds.jpg',
    widths: [4096, 2048],
    outputFormat: 'png',
    transform: 'cloud-alpha',
    colorIntent: 'linear'
  },
  {
    name: 'stars-sky',
    source: '8k_stars_milky_way.jpg',
    widths: [4096, 2048],
    outputFormat: 'jpg',
    transform: 'copy',
    colorIntent: 'srgb'
  },
  {
    name: 'sun',
    source: '2k_sun.jpg',
    widths: [2048, 1024],
    outputFormat: 'jpg',
    transform: 'copy',
    colorIntent: 'srgb'
  },
  {
    name: 'moon',
    source: '2k_moon.jpg',
    widths: [2048, 1024],
    outputFormat: 'jpg',
    transform: 'copy',
    colorIntent: 'srgb'
  }
];

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function runMagick(args: string[]): Promise<void> {
  await execFile('magick', args, { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 });
}

function isPng(buffer: Uint8Array): boolean {
  return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
}

function isJpeg(buffer: Uint8Array): boolean {
  return buffer[0] === 0xff && buffer[1] === 0xd8;
}

async function decodeImage(buffer: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> {
  if (isPng(buffer)) {
    const png = PNG.sync.read(Buffer.from(buffer));
    return { width: png.width, height: png.height, data: png.data };
  }

  if (isJpeg(buffer)) {
    const jpg = jpeg.decode(Buffer.from(buffer), { useTArray: true });
    return { width: jpg.width, height: jpg.height, data: jpg.data };
  }

  throw new Error('Unsupported intermediate format for KTX2 encoding.');
}

function buildMagickArgs(sourcePath: string, outputPath: string, width: number, variant: TextureVariant): string[] {
  const args = [sourcePath, '-auto-orient', '-resize', `${width}x`];

  if (variant.transform === 'roughness') {
    args.push('-colorspace', 'Gray', '-negate');
  }

  if (variant.transform === 'cloud-alpha') {
    args.push('-colorspace', 'Gray', '-auto-level');
  }

  args.push('-strip');

  if (variant.outputFormat === 'jpg') {
    args.push('-quality', '92');
  }

  args.push(outputPath);
  return args;
}

async function buildVariant(variant: TextureVariant, width: number): Promise<void> {
  const sourcePath = path.join(materialsDir, variant.source);
  const rawOutputDir = path.join(rawDir, String(width));
  const ktxOutputDir = path.join(ktxDir, String(width));
  const rawOutputPath = path.join(rawOutputDir, `${variant.name}.${variant.outputFormat}`);
  const ktxOutputPath = path.join(ktxOutputDir, `${variant.name}.ktx2`);

  await ensureDir(rawOutputDir);
  await ensureDir(ktxOutputDir);

  await runMagick(buildMagickArgs(sourcePath, rawOutputPath, width, variant));

  const rawBuffer = new Uint8Array(await readFile(rawOutputPath));
  const ktxBuffer = await encodeToKTX2(rawBuffer, {
    imageDecoder: decodeImage,
    isKTX2File: true,
    isUASTC: true,
    generateMipmap: true,
    needSupercompression: true,
    isNormalMap: variant.isNormalMap ?? false,
    isPerceptual: variant.colorIntent === 'srgb',
    isSetKTX2SRGBTransferFunc: variant.colorIntent === 'srgb',
    qualityLevel: 180,
    uastcLDRQualityLevel: 2
  });

  await writeFile(ktxOutputPath, ktxBuffer);
  console.info(`[textures] built ${variant.name} ${width}px`);
}

async function copyBasisTranscoder(): Promise<void> {
  const sourceDir = path.join(repoRoot, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
  await ensureDir(basisDir);
  await copyFile(path.join(sourceDir, 'basis_transcoder.js'), path.join(basisDir, 'basis_transcoder.js'));
  await copyFile(path.join(sourceDir, 'basis_transcoder.wasm'), path.join(basisDir, 'basis_transcoder.wasm'));
}

async function main(): Promise<void> {
  await rm(tempDir, { recursive: true, force: true });
  await ensureDir(tempDir);
  await ensureDir(publicDir);

  await copyBasisTranscoder();

  for (const variant of variants) {
    for (const width of variant.widths) {
      await buildVariant(variant, width);
    }
  }

  await rm(tempDir, { recursive: true, force: true });
  console.info('[textures] generation complete');
}

await main();