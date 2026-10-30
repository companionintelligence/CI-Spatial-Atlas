/**
 * scripts/check-pwa.mjs, the check that runs inside `vite build` (see the plugin in vite.config.ts) and
 * so in `npm run build`, the image build and the deploy workflow: public/sw.js against the files it
 * precaches, its cache name against their fingerprint, and the worker and registration in dist/.
 *
 * Each edit below is made to a COPY of public/ or of a build output, never to the real files.
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPwa,
  checkDist,
  checkSource,
  checkWorkerBuild,
  isKillSwitch,
  precacheFingerprint,
} from '../scripts/check-pwa.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const read = (path: string) => readFileSync(path, 'utf8');
const KILL_SWITCH = read(fileURLToPath(new URL('../../docs/service-worker-kill-switch.js', import.meta.url)));
/** With the kill switch as public/sw.js the worker is retired on purpose (README: retire it), and the checks of the real worker do not apply. */
const RETIRED = isKillSwitch(read(join(PUBLIC, 'sw.js')));
const OFFLINE_FILES = ['index.html', 'offline.css', 'mark.svg'];

describe('checkSource on this repository', () => {
  it('finds nothing wrong', () => {
    expect(checkSource()).toEqual([]);
    expect(() => assertPwa()).not.toThrow();
  });
});

describe('checkSource notices drift', () => {
  let tmp: string | undefined;

  /** A copy of what the check reads (sw.js and the offline page), with files rewritten. */
  const withEdits = (edits: Array<[string, (text: string) => string]>) => {
    tmp = mkdtempSync(join(tmpdir(), 'atlas-pwa-'));
    cpSync(join(PUBLIC, 'sw.js'), join(tmp, 'sw.js'));
    // With the worker retired the offline page may have been deleted too, and nothing here needs it then.
    if (existsSync(join(PUBLIC, 'offline'))) cpSync(join(PUBLIC, 'offline'), join(tmp, 'offline'), { recursive: true });
    for (const [file, edit] of edits) {
      const path = join(tmp, file);
      writeFileSync(path, edit(read(path)));
    }
    return checkSource(tmp).join('\n');
  };
  const withEdit = (file: string, edit: (text: string) => string) => withEdits([[file, edit]]);

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it.skipIf(RETIRED)('a service worker that precaches a file that is not there', () => {
    expect(withEdit('sw.js', (h) => h.replace("'/offline/mark.svg']", "'/offline/gone.svg']"))).toContain(
      'precaches /offline/gone.svg, which is not in public/'
    );
  });

  // A cached answer is never revalidated, so the worker may hold only files the app itself never
  // requests: a shared one, such as an icon, would stay as it was at install.
  it.skipIf(RETIRED)('a service worker that answers for a file the app itself requests', () => {
    expect(withEdit('sw.js', (h) => h.replace("'/offline/mark.svg']", "'/icons/icon-192.png']"))).toContain(
      'precaches /icons/icon-192.png; the worker may answer only for files under /offline/'
    );
  });

  it.skipIf(RETIRED)('a service worker whose offline page is not in its precache list', () => {
    expect(withEdit('sw.js', (h) => h.replace('[OFFLINE_URL, ', '['))).toContain('PRECACHE does not include /offline/');
  });

  it.skipIf(RETIRED)('a worker with no cache name', () => {
    expect(withEdit('sw.js', (h) => h.replace(/const CACHE = '[^']+';/, ''))).toContain('public/sw.js: no CACHE name');
  });

  // A browser fetches the precached files again only when sw.js changes, so the cache name carries
  // a fingerprint of them. The build is what has to notice an edited file, not whoever happens to
  // run the unit tests.
  it.skipIf(RETIRED)('a precached file edited without the cache name following it', () => {
    expect(withEdit('offline/offline.css', (h) => `${h}\n/* edited */\n`)).toMatch(
      /public\/sw\.js: CACHE is ci-atlas-offline-[0-9a-f]{12}, but the precached files hash to ci-atlas-offline-[0-9a-f]{12}: set CACHE to 'ci-atlas-offline-[0-9a-f]{12}'/
    );
  });

  it.skipIf(RETIRED)('a message that names a CACHE which, once set, lets the build through', () => {
    const edit: [string, (text: string) => string] = ['offline/offline.css', (h) => `${h}\n/* edited */\n`];
    const named = /set CACHE to '([^']+)'/.exec(withEdits([edit]))?.[1];
    expect(named).toMatch(/^ci-atlas-offline-[0-9a-f]{12}$/);
    expect(withEdits([edit, ['sw.js', (h) => h.replace(/const CACHE = '[^']+';/, `const CACHE = '${named}';`)]])).toBe('');
  });

  it.skipIf(RETIRED)('a precached file saved with CRLF line endings, which still names the same cache', () => {
    expect(withEdit('offline/offline.css', (h) => h.replace(/\n/g, '\r\n'))).toBe('');
  });

  it('no service worker at all, which leaves installed browsers with the old one and nothing to replace it', () => {
    tmp = mkdtempSync(join(tmpdir(), 'atlas-pwa-'));
    expect(checkSource(tmp)).toEqual(['public/sw.js is missing (the page registers it from src/pwa/registerServiceWorker.ts)']);
  });

  // The README's retirement is: the kill switch replaces public/sw.js, and the registration goes.
  // The build must accept that, or the fix for a bad worker could not be deployed.
  it('the kill switch as public/sw.js, which has no offline page, precache list or cache name', () => {
    expect(withEdit('sw.js', () => KILL_SWITCH)).toBe('');
  });

  it('the kill switch with the offline page deleted too, because nothing new is required of it', () => {
    tmp = mkdtempSync(join(tmpdir(), 'atlas-pwa-'));
    writeFileSync(join(tmp, 'sw.js'), KILL_SWITCH);
    expect(checkSource(tmp)).toEqual([]);
  });
});

describe('checkWorkerBuild and checkDist: the worker in dist/', () => {
  let dist: string | undefined;

  /** A build output holding the worker (the real one by default) and the offline files it precaches. */
  const fakeDist = (sw = read(join(PUBLIC, 'sw.js'))) => {
    dist = mkdtempSync(join(tmpdir(), 'atlas-dist-'));
    mkdirSync(join(dist, 'offline'));
    for (const file of OFFLINE_FILES) {
      if (existsSync(join(PUBLIC, 'offline', file))) cpSync(join(PUBLIC, 'offline', file), join(dist, 'offline', file));
    }
    writeFileSync(join(dist, 'sw.js'), sw);
    return dist;
  };
  /** The text of a bundle that registers the worker, and of one that does not. */
  const REGISTERS = 'navigator.serviceWorker.register("/sw.js",{scope:"/"})';
  const DOES_NOT = 'console.log("no worker")';
  /** A build output the way Vite lays it out: index.html, the app's bundle in assets/, Cesium in cesium/. */
  const builtApp = (appJs: string, extra: (built: string) => void = () => {}) => {
    const built = fakeDist();
    writeFileSync(join(built, 'index.html'), '<!doctype html>');
    mkdirSync(join(built, 'assets'));
    writeFileSync(join(built, 'assets', 'index-abc123.js'), appJs);
    extra(built);
    return built;
  };

  afterEach(() => {
    if (dist) rmSync(dist, { recursive: true, force: true });
    dist = undefined;
  });

  it.skipIf(RETIRED)('passes a worker that was built with its files, under the name they call for, and that the bundle registers', () => {
    expect(checkWorkerBuild(fakeDist(), REGISTERS)).toEqual([]);
  });

  it.skipIf(RETIRED)('a bundle that no longer registers the worker', () => {
    expect(checkWorkerBuild(fakeDist(), DOES_NOT).join('\n')).toContain('the JS bundle does not register /sw.js');
  });

  it('a build with no worker at all', () => {
    const built = fakeDist();
    rmSync(join(built, 'sw.js'));
    expect(checkWorkerBuild(built, REGISTERS)).toEqual(['dist/sw.js is missing (it belongs in public/)']);
  });

  it.skipIf(RETIRED)('a precached file that was not built', () => {
    const built = fakeDist();
    rmSync(join(built, 'offline/offline.css'));
    expect(checkWorkerBuild(built, REGISTERS).join('\n')).toContain('dist/sw.js precaches /offline/offline.css, which was not built');
  });

  it.skipIf(RETIRED)('a built file that is not the one the cache name was made for', () => {
    const built = fakeDist();
    appendFileSync(join(built, 'offline/offline.css'), '\n/* edited */\n');
    expect(checkWorkerBuild(built, REGISTERS).join('\n')).toMatch(
      /dist\/sw\.js: CACHE is ci-atlas-offline-[0-9a-f]{12}, but the built files hash to ci-atlas-offline-[0-9a-f]{12}: set CACHE to 'ci-atlas-offline-[0-9a-f]{12}'/
    );
  });

  it('the kill switch, which has no offline page, precache list or registration to look for', () => {
    dist = mkdtempSync(join(tmpdir(), 'atlas-dist-'));
    writeFileSync(join(dist, 'sw.js'), KILL_SWITCH);
    expect(checkWorkerBuild(dist, DOES_NOT)).toEqual([]);
  });

  describe('checkDist reads the app\'s own bundle', () => {
    it.skipIf(RETIRED)('finds the registration in dist/assets/', () => {
      expect(checkDist(builtApp(REGISTERS))).toEqual([]);
    });

    it.skipIf(RETIRED)('does not take the worker\'s own text for the app registering it', () => {
      const built = builtApp(DOES_NOT, (b) => appendFileSync(join(b, 'sw.js'), `\n// navigator.serviceWorker.register("/sw.js")\n`));
      expect(checkDist(built).join('\n')).toContain('the JS bundle does not register /sw.js');
    });

    it.skipIf(RETIRED)('does not take Cesium for the app', () => {
      const built = builtApp(DOES_NOT, (b) => {
        mkdirSync(join(b, 'cesium'));
        writeFileSync(join(b, 'cesium', 'Cesium.js'), REGISTERS);
      });
      expect(checkDist(built).join('\n')).toContain('the JS bundle does not register /sw.js');
    });

    it('a build output with no index.html, which means nothing was built', () => {
      const built = fakeDist();
      expect(checkDist(built).join('\n')).toContain('index.html is missing: nothing was built');
    });

    it('the kill switch, with a bundle that does not register anything', () => {
      const built = builtApp(DOES_NOT, (b) => writeFileSync(join(b, 'sw.js'), KILL_SWITCH));
      expect(checkDist(built)).toEqual([]);
    });
  });
});

describe('assertPwa', () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it.skipIf(RETIRED)('throws one error that lists the problems and names the CACHE to use', () => {
    tmp = mkdtempSync(join(tmpdir(), 'atlas-pwa-'));
    cpSync(join(PUBLIC, 'sw.js'), join(tmp, 'sw.js'));
    cpSync(join(PUBLIC, 'offline'), join(tmp, 'offline'), { recursive: true });
    appendFileSync(join(tmp, 'offline/offline.css'), '\n/* edited */\n');
    expect(() => assertPwa({ publicDir: tmp })).toThrow(/PWA check failed[\s\S]*set CACHE to 'ci-atlas-offline-[0-9a-f]{12}'/);
  });
});

describe('isKillSwitch', () => {
  it('is the first line of the kill switch', () => {
    expect(isKillSwitch(KILL_SWITCH)).toBe(true);
    expect(isKillSwitch('// atlas:service-worker-kill-switch\r\nself.skipWaiting();')).toBe(true);
  });

  it('is not a worker that merely mentions the marker further down', () => {
    expect(isKillSwitch("const CACHE = 'ci-atlas-offline-0123456789ab';\n// atlas:service-worker-kill-switch\n")).toBe(false);
    expect(isKillSwitch('// atlas:service-worker-kill-switch-not\n')).toBe(false);
    expect(isKillSwitch('')).toBe(false);
  });

  it.skipIf(RETIRED)('is not the real worker', () => {
    expect(isKillSwitch(read(join(PUBLIC, 'sw.js')))).toBe(false);
  });
});

describe("precacheFingerprint, the end of the worker's cache name", () => {
  let dir: string | undefined;
  const URLS = ['/offline/', '/offline/a.css'];

  /** Two small files at the paths URLS resolves to. */
  const files = (index: string, css: string) => {
    dir = mkdtempSync(join(tmpdir(), 'atlas-fingerprint-'));
    mkdirSync(join(dir, 'offline'));
    writeFileSync(join(dir, 'offline/index.html'), index);
    writeFileSync(join(dir, 'offline/a.css'), css);
    return dir;
  };

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  // The sw.js header gives the same thing in words, and the README's recipe is a shell one, so a
  // known answer from `shasum` pins it:
  //   { printf '/offline/\0'; printf '<h1>offline</h1>\n'; printf '\0'
  //     printf '/offline/a.css\0'; printf 'body{}\n'; printf '\0'; } | shasum -a 256 | cut -c1-12
  it('is the first 12 hex digits of a sha256 over each URL and its file, each followed by a NUL', () => {
    expect(precacheFingerprint(files('<h1>offline</h1>\n', 'body{}\n'), URLS)).toBe('13f6a746b44b');
  });

  it('ignores carriage returns, so a CRLF checkout of the files names the same cache', () => {
    expect(precacheFingerprint(files('<h1>offline</h1>\r\n', 'body{}\r\n'), URLS)).toBe('13f6a746b44b');
  });

  it('moves with a file, with the order of the list and with a URL', () => {
    expect(precacheFingerprint(files('<h1>offline!</h1>\n', 'body{}\n'), URLS)).not.toBe('13f6a746b44b');
    expect(precacheFingerprint(files('<h1>offline</h1>\n', 'body{}\n'), [...URLS].reverse())).not.toBe('13f6a746b44b');
    expect(precacheFingerprint(files('<h1>offline</h1>\n', 'body{}\n'), URLS.slice(0, 1))).not.toBe('13f6a746b44b');
  });
});

describe('vite.config.ts', () => {
  const config = read(fileURLToPath(new URL('../vite.config.ts', import.meta.url)));

  // The check only protects a build if the build runs it. Both the image and the deploy workflow
  // go through `vite build`, so the plugin is what puts the check on every path.
  it('runs the check after every build, from a plugin that comes last', () => {
    expect(config).toMatch(/import \{ assertPwa \} from '\.\/scripts\/check-pwa\.mjs'/);
    expect(config).toMatch(/apply: 'build'/);
    expect(config).toMatch(/closeBundle\(\) \{[^}]*assertPwa\(\{ publicDir, dist: outDir \}\)/);
    expect(config).toMatch(/plugins: \[[^\]]*pwaCheck\(\)\]/);
  });
});
