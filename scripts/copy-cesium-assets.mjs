import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Support modern Cesium layout: node_modules/cesium/Build/Cesium/*
// Fallback to legacy root layout if Build/Cesium missing.
const buildCandidate = join('node_modules', 'cesium', 'Build', 'Cesium');
const rootCandidate = join('node_modules', 'cesium');
const base = existsSync(buildCandidate) ? buildCandidate : rootCandidate;
const publicCesium = join('public', 'Cesium');
const folders = ['Workers', 'Assets', 'ThirdParty', 'Widgets'];

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

ensureDir('public');
// Clean existing
if (existsSync(publicCesium)) {
  rmSync(publicCesium, { recursive: true });
}
ensureDir(publicCesium);

for (const f of folders) {
  const src = join(base, f);
  const dest = join(publicCesium, f);
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${src} -> ${dest}`);
}

console.log('Cesium assets copied to public/.');