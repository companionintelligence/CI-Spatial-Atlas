// check-pwa.mjs: are the installable-app files in step with each other?
//
// public/sw.js is a service worker that precaches a small offline page. A browser fetches those
// precached files again only when sw.js itself changes, and nothing else ties the two together,
// so sw.js names its cache after a fingerprint of the files (`ci-atlas-offline-<12 hex digits>`)
// and this module recomputes it.
//
// It runs inside every production build (the plugin in vite.config.ts), so `npm run build`, the
// image build and the deploy workflow all stop on drift, and test/pwa-check.test.ts and
// test/pwa-service-worker.test.ts import this same implementation.
//
// The source (public/): sw.js is there; everything it precaches exists and lives under /offline/,
// a path the app itself never requests (the worker answers those from the cache without
// revalidating, so a file the app also used would go stale); its CACHE is the fingerprint of the
// precached files. The build output (dist/): sw.js and the files it precaches were built, its CACHE
// still matches the built files, and the bundle registers '/sw.js' (index.html has no script that
// could). A failure names the CACHE to use.
//
// docs/service-worker-kill-switch.js is how the worker is retired. While public/sw.js is that file
// (it starts with the marker below) none of the above is required of it: it has no offline page, no
// precache list, no cache name and no registration in the bundle, on purpose. No rule is added for
// it either, because a build that has to ship the kill switch must not be stopped by this module.
//
//   node viewer-react/scripts/check-pwa.mjs     # the source, and dist/ if it has been built
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VIEWER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(VIEWER_ROOT, 'public');
const DIST_DIR = join(VIEWER_ROOT, 'dist');

/** The prefix of every cache name public/sw.js uses: it deletes the older caches that start with it. */
export const CACHE_PREFIX = 'ci-atlas-offline-';

/** The first line of docs/service-worker-kill-switch.js, and nothing else on that line but spaces. */
const KILL_SWITCH_MARKER = /^\/\/ atlas:service-worker-kill-switch[ \t]*(?:\r?\n|$)/;

/** Whether this is the text of the kill switch rather than of the real worker. */
export const isKillSwitch = (source) => KILL_SWITCH_MARKER.test(source);

/** What the service worker (public/sw.js) names: its cache, the offline page and the files it precaches. */
export function serviceWorkerFiles(source) {
  const cache = /const CACHE = '([^']+)'/.exec(source)?.[1] ?? null;
  const offline = /const OFFLINE_URL = '([^']+)'/.exec(source)?.[1] ?? null;
  const listed = /const PRECACHE = \[([^\]]*)\]/.exec(source)?.[1];
  // Each entry is a quoted path, or OFFLINE_URL by name.
  const precache = (listed ?? '')
    .split(',')
    .map((item) => item.trim())
    .map((item) => (item === 'OFFLINE_URL' ? offline : /^'([^']+)'$/.exec(item)?.[1]))
    .filter(Boolean);
  return { cache, offline, precache };
}

/** Where a URL the worker precaches lives in public/: a path that ends in / is that folder's index.html. */
const publicFileFor = (url) => (url.endsWith('/') ? `${url.slice(1)}index.html` : url.slice(1));

/**
 * The 12 hex digits that end the worker's cache name: a sha256 over, for each precached URL in
 * PRECACHE order, the URL, a NUL byte, the bytes of its file with every CR (0x0D) removed, and a
 * NUL byte. The CRs go so that a checkout with CRLF line endings (core.autocrlf, an editor that
 * saves them) hashes like one with LF. `dir` is the folder the URLs resolve in: public/, or the
 * build output.
 */
export function precacheFingerprint(dir, urls) {
  const hash = createHash('sha256');
  for (const url of urls) {
    const bytes = readFileSync(join(dir, publicFileFor(url))).filter((byte) => byte !== 0x0d);
    hash.update(url).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

/** The cache name those precached files call for, or null when there is nothing (or not everything) to hash. */
function expectedCache(dir, precache) {
  if (precache.length === 0 || !precache.every((url) => existsSync(join(dir, publicFileFor(url))))) return null;
  return `${CACHE_PREFIX}${precacheFingerprint(dir, precache)}`;
}

/** A string literal as the bundle writes it: in single, double or backtick quotes. */
const quoted = (s) => new RegExp(`["'\`]${s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["'\`]`);

/** Every file below `dir`. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  );
}

/** The app's own JS in the build output (dist/assets/): Cesium (dist/cesium/) and sw.js are not part of it. */
function bundleText(dist) {
  const assets = join(dist, 'assets');
  if (!existsSync(assets)) return '';
  return walk(assets)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

// ---- layer 1: the source ------------------------------------------------------

/** What is wrong with public/ (or `publicDir`), as a list of messages; empty when nothing is. */
export function checkSource(publicDir = PUBLIC_DIR) {
  const swPath = join(publicDir, 'sw.js');
  if (!existsSync(swPath)) return ['public/sw.js is missing (the page registers it from src/pwa/registerServiceWorker.ts)'];
  const source = readFileSync(swPath, 'utf8');
  if (isKillSwitch(source)) return [];

  const problems = [];
  const { cache, offline, precache } = serviceWorkerFiles(source);
  if (!offline) problems.push('public/sw.js: no OFFLINE_URL');
  else if (!precache.includes(offline)) {
    problems.push(`public/sw.js: PRECACHE does not include ${offline}, so the offline page would not be there offline`);
  }
  for (const url of precache) {
    if (!existsSync(join(publicDir, publicFileFor(url)))) problems.push(`public/sw.js: precaches ${url}, which is not in public/`);
    // A cached answer is never revalidated, so the worker may hold only files the app itself never requests.
    if (!url.startsWith('/offline/')) {
      problems.push(`public/sw.js: precaches ${url}; the worker may answer only for files under /offline/, which the app never requests`);
    }
  }

  // A browser fetches the precached files again only when sw.js changes, so the cache name carries
  // a fingerprint of them; a file edited without it would never reach returning visitors.
  const expected = expectedCache(publicDir, precache);
  if (!cache) problems.push('public/sw.js: no CACHE name');
  else if (expected && cache !== expected) {
    problems.push(
      `public/sw.js: CACHE is ${cache}, but the precached files hash to ${expected}: set CACHE to '${expected}' (a browser fetches them again only when sw.js changes)`
    );
  }
  return problems;
}

// ---- layer 2: the build output --------------------------------------------------

/**
 * The worker in the build output: it is there, everything it precaches was built, its cache name
 * matches the built files, and the bundle registers it (index.html has no script that could).
 * `js` is the bundle's text without sw.js, or the worker's own comments could satisfy the
 * registration check. The kill switch needs none of this.
 */
export function checkWorkerBuild(dist, js) {
  const d = (...parts) => join(dist, ...parts);
  if (!existsSync(d('sw.js'))) return ['dist/sw.js is missing (it belongs in public/)'];
  const source = readFileSync(d('sw.js'), 'utf8');
  if (isKillSwitch(source)) return [];

  const problems = [];
  const { cache, precache } = serviceWorkerFiles(source);
  for (const url of precache) {
    if (!existsSync(d(publicFileFor(url)))) problems.push(`dist/sw.js precaches ${url}, which was not built`);
  }
  const expected = expectedCache(dist, precache);
  if (cache && expected && cache !== expected) {
    problems.push(`dist/sw.js: CACHE is ${cache}, but the built files hash to ${expected}: set CACHE to '${expected}'`);
  }
  if (!quoted('/sw.js').test(js)) {
    problems.push('the JS bundle does not register /sw.js (src/pwa/registerServiceWorker.ts, called from src/main.tsx)');
  }
  return problems;
}

/** What is wrong with a build output (`dist`), as a list of messages; empty when nothing is. */
export function checkDist(dist = DIST_DIR) {
  if (!existsSync(join(dist, 'index.html'))) return [`${dist}/index.html is missing: nothing was built`];
  return checkWorkerBuild(dist, bundleText(dist));
}

// ---- entry point ---------------------------------------------------------------

/** Throws one Error listing every problem; used by the Vite build (vite.config.ts). */
export function assertPwa({ publicDir = PUBLIC_DIR, dist = null } = {}) {
  const problems = [...checkSource(publicDir), ...(dist ? checkDist(dist) : [])];
  if (problems.length) {
    throw new Error(`PWA check failed (viewer-react/scripts/check-pwa.mjs):\n  - ${problems.join('\n  - ')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const built = existsSync(join(DIST_DIR, 'index.html'));
  try {
    assertPwa({ dist: built ? DIST_DIR : null });
    console.log(`OK: public/sw.js, the files it precaches and its cache name agree${built ? ' (source and dist)' : ' (source only; run `npm run build` to check dist)'}.`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
