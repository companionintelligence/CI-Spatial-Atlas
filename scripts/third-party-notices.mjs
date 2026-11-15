#!/usr/bin/env node
// Third-party notices for the Companion Atlas apps.
//
// Lists the third-party software that the published apps carry, from the lockfiles, and
// writes the licence texts that ship inside each app and with each release.
//
//   web      The viewer bundle (viewer-react/dist), which every app carries: the runtime
//            dependencies of @companion-atlas/viewer-react in package-lock.json, with those
//            of the workspace packages it uses (@companion-atlas/story).
//   desktop  The Rust crates linked into the Tauri executable, from
//            viewer-react/desktop/src-tauri/Cargo.lock (`cargo metadata --locked`), for the
//            Windows, macOS (Apple silicon and Intel) and Linux targets. Build-time crates
//            (build scripts, proc macros) are left out: they are not in the executable.
//   android  The Capacitor shell's npm packages (viewer-react/mobile/package-lock.json) and
//            the Android libraries Gradle resolves for the release build.
//
// Usage:
//   node scripts/third-party-notices.mjs --scope web,desktop --out <dir> [--json <file>]
//   node scripts/third-party-notices.mjs --scope web,android --gradle viewer-react/mobile/android --out <dir>
//   node scripts/third-party-notices.mjs --from a.json --from b.json --out <dir>
//   node scripts/third-party-notices.mjs --scope web,desktop,android --gradle viewer-react/mobile/android --docs
//
//   --out <dir>          Write THIRD-PARTY-NOTICES.txt and a copy of LICENSE.md into <dir>.
//   --json <file>        Write the collected data. --from merges such files: the release
//                        workflow merges the desktop and Android data into one notices file.
//   --gradle <dir>       Run Gradle in the Android project <dir> to list its libraries.
//   --gradle-deps <file> Read that list from a saved `gradlew :app:dependencies` report instead.
//   --docs               Rewrite THIRD_PARTY.md and NOTICE.md at the repository root.
//   --strict             Fail when a component has no licence, a licence outside the allowed
//                        list, or no licence text. Without it these are warnings. Release builds
//                        use it (ATLAS_NOTICES_STRICT=1 in the environment does the same).
//
// Licence texts are read from the installed packages (node_modules and the Cargo registry),
// so install the dependencies first. Only Cargo and Gradle use the network, to download the
// crates and libraries they describe.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LICENSE_DIR = path.join(ROOT, 'scripts', 'licenses');
const DESKTOP_MANIFEST = path.join(ROOT, 'viewer-react', 'desktop', 'src-tauri', 'Cargo.toml');
const MOBILE_DIR = path.join(ROOT, 'viewer-react', 'mobile');

/** Targets the desktop app is released for, and the name each one is listed under. */
const DESKTOP_TARGETS = [
  ['x86_64-pc-windows-msvc', 'windows'],
  ['aarch64-apple-darwin', 'macos'],
  ['x86_64-apple-darwin', 'macos'],
  ['x86_64-unknown-linux-gnu', 'linux'],
];

const SCOPES = {
  web: 'Web viewer: the npm packages bundled into the viewer that every app carries',
  desktop: 'Desktop app: the Rust crates linked into the Companion Atlas executable',
  android: 'Android app: the Capacitor shell (npm) and the Android libraries (Maven)',
};

/** Our own packages. They are under the repository's licence, not third-party. */
const FIRST_PARTY = /^@companion-atlas\/|^@companionintelligence\//;

/**
 * Licences the apps may carry. An OR expression needs one of these; an AND expression needs
 * all of them. Anything else (GPL, LGPL, AGPL, an unknown string) fails a strict run, so a
 * new dependency under such a licence is a decision rather than an accident.
 */
const ALLOWED = new Set([
  '0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BSL-1.0', 'CC-BY-4.0', 'CC0-1.0', 'ISC',
  'MIT', 'MIT-0', 'MPL-2.0', 'OFL-1.1', 'Unicode-3.0', 'Unicode-DFS-2016', 'Unlicense', 'Zlib',
  'LicenseRef-Android-SDK',
]);

/** When an expression offers a choice, the licence text we include (the first one present). */
const PREFERENCE = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'Zlib', '0BSD', 'MIT-0', 'Unlicense', 'CC0-1.0', 'BSL-1.0', 'Unicode-3.0', 'MPL-2.0'];

/** Copyleft licences whose source-availability terms NOTICE.md and the notices file address. */
const RECIPROCAL = new Set(['MPL-2.0']);

/**
 * Packages whose lockfile entry has no usable licence. Each was read from the package itself
 * at the version given; a new version is checked again (strict runs read the file).
 */
const CLARIFICATIONS = {
  'npm:webgl-constants@1.1.1': { license: 'MIT', why: 'no "license" field; LICENSE is the MIT licence' },
  'npm:@pmndrs/handle@6.6.30': { license: 'MIT', why: '"SEE LICENSE IN LICENSE"; LICENSE is the MIT licence' },
  'npm:@pmndrs/pointer-events@6.6.30': { license: 'MIT', why: '"SEE LICENSE IN LICENSE"; LICENSE is the MIT licence' },
  'npm:@pmndrs/xr@6.6.30': { license: 'MIT', why: '"SEE LICENSE IN LICENSE"; LICENSE is the MIT licence' },
  'npm:@react-three/xr@6.6.30': { license: 'MIT', why: '"SEE LICENSE IN LICENSE"; LICENSE is the MIT licence' },
};

/**
 * Android libraries come from Maven, which has no lockfile here: Gradle resolves them. Their
 * licences are those of the project that publishes each group; an unlisted group fails a
 * strict run.
 */
const MAVEN_GROUPS = [
  { match: /^androidx\./, license: 'Apache-2.0', url: 'https://developer.android.com/jetpack/androidx' },
  { match: /^com\.google\.android\.gms$/, license: 'LicenseRef-Android-SDK', url: 'https://developer.android.com/studio/terms' },
  { match: /^com\.google\.code\.gson$/, license: 'Apache-2.0', url: 'https://github.com/google/gson' },
  { match: /^com\.google\.errorprone$/, license: 'Apache-2.0', url: 'https://github.com/google/error-prone' },
  { match: /^com\.google\.guava$/, license: 'Apache-2.0', url: 'https://github.com/google/guava' },
  { match: /^io\.ionic\.libs$/, license: 'MIT', url: 'https://github.com/ionic-team/ion-android-geolocation', copyright: 'Copyright (c) 2025 Ionic' },
  {
    match: /^org\.apache\.cordova$/,
    license: 'Apache-2.0',
    url: 'https://cordova.apache.org',
    notice: 'Apache Cordova\nCopyright 2015-2020 The Apache Software Foundation\n\nThis product includes software developed at\nThe Apache Software Foundation (http://www.apache.org/).',
  },
  { match: /^org\.jetbrains$/, license: 'Apache-2.0', url: 'https://github.com/JetBrains/java-annotations' },
  { match: /^org\.jetbrains\.kotlin$/, license: 'Apache-2.0', url: 'https://kotlinlang.org' },
  { match: /^org\.jetbrains\.kotlinx$/, license: 'Apache-2.0', url: 'https://github.com/Kotlin' },
  { match: /^org\.jspecify$/, license: 'Apache-2.0', url: 'https://jspecify.dev' },
];

const ANDROID_SDK_LICENSE_NOTE =
  'Google Play services libraries are distributed under the Android Software Development Kit License\n' +
  'Agreement, which allows them to be included in an Android app: https://developer.android.com/studio/terms';

// ---- licence texts ------------------------------------------------------------------------

const MIT = (holder) => `MIT License

${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const BSD_CONDITIONS = `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.`;

const BSD_DISCLAIMER = `THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

/** Standard texts, used when a package names a licence but ships no licence file. */
const TEMPLATES = {
  MIT,
  'BSD-2-Clause': (holder) => `BSD 2-Clause License\n\n${holder}\n\n${BSD_CONDITIONS}\n\n${BSD_DISCLAIMER}`,
  'BSD-3-Clause': (holder) =>
    `BSD 3-Clause License\n\n${holder}\n\n${BSD_CONDITIONS}\n\n3. Neither the name of the copyright holder nor the names of its\n   contributors may be used to endorse or promote products derived from\n   this software without specific prior written permission.\n\n${BSD_DISCLAIMER}`,
  ISC: (holder) => `ISC License\n\n${holder}\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  Zlib: (holder) => `zlib License\n\n${holder}\n\nThis software is provided 'as-is', without any express or implied\nwarranty. In no event will the authors be held liable for any damages\narising from the use of this software.\n\nPermission is granted to anyone to use this software for any purpose,\nincluding commercial applications, and to alter it and redistribute it\nfreely, subject to the following restrictions:\n\n1. The origin of this software must not be misrepresented; you must not\n   claim that you wrote the original software. If you use this software\n   in a product, an acknowledgment in the product documentation would be\n   appreciated but is not required.\n2. Altered source versions must be plainly marked as such, and must not be\n   misrepresented as being the original software.\n3. This notice may not be removed or altered from any source distribution.`,
  'Apache-2.0': () => readFileSync(path.join(LICENSE_DIR, 'Apache-2.0.txt'), 'utf8'),
  'MPL-2.0': () => readFileSync(path.join(LICENSE_DIR, 'MPL-2.0.txt'), 'utf8'),
};

/**
 * Recognise a licence file by its text, for files named only LICENSE. Only the opening is
 * read: a file such as Cesium's LICENSE.md starts with its own licence and then quotes the
 * licences of the code it bundles.
 */
function sniff(text) {
  const t = text.slice(0, 2000).replace(/\s+/g, ' ');
  if (/Mozilla Public License,? Version 2\.0/i.test(t)) return 'MPL-2.0';
  if (/Apache License,? Version 2\.0/i.test(t) && !/Permission is hereby granted, free of charge/i.test(t)) return 'Apache-2.0';
  if (/Permission is hereby granted, free of charge/i.test(t) && !/Apache License/i.test(t)) return 'MIT';
  if (/Permission to use, copy, modify, and\/?or distribute this software for any purpose with or without fee is hereby granted/i.test(t)) {
    return /copyright notice and this permission notice appear in all copies/i.test(t) ? 'ISC' : '0BSD';
  }
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/This software is provided 'as-is', without any express or implied warranty/i.test(t)) return 'Zlib';
  if (/This is free and unencumbered software released into the public domain/i.test(t)) return 'Unlicense';
  if (/SIL OPEN FONT LICENSE Version 1\.1/i.test(t)) return 'OFL-1.1';
  return null;
}

/** File-name hints for multi-licence packages (LICENSE-MIT, LICENSE-APACHE, UNLICENSE, ...). */
function hintFromName(name) {
  const n = name.toLowerCase();
  if (/unlicen[cs]e/.test(n)) return 'Unlicense';
  if (/apache/.test(n)) return 'Apache-2.0';
  if (/(^|[-_.])mit([-_.]|$)/.test(n)) return 'MIT';
  if (/zlib/.test(n)) return 'Zlib';
  if (/bsd/.test(n)) return 'BSD-3-Clause';
  if (/mpl/.test(n)) return 'MPL-2.0';
  if (/unicode/.test(n)) return 'Unicode-3.0';
  if (/cc0/.test(n)) return 'CC0-1.0';
  return null;
}

const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicen[cs]e|ofl)([-_. ].*)?$/i;
const NOTICE_FILE = /^notice([-_. ].*)?$/i;

function licenseFiles(dir) {
  if (!dir || !existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name) && !/\.(js|ts|json|html?|rs|py|sh)$/i.test(name))
    .filter((name) => statSync(path.join(dir, name)).isFile())
    .sort()
    .map((name) => ({ name, text: clean(readFileSync(path.join(dir, name), 'utf8')) }));
}

function clean(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
}

// ---- licence expressions --------------------------------------------------------------------

/**
 * A stable spelling for display and counting: 'MIT/Apache-2.0' and 'Apache-2.0 / MIT' (the old
 * Cargo style) and 'MIT OR Apache-2.0' all become 'Apache-2.0 OR MIT'.
 */
function normalizeExpression(expr) {
  if (!expr) return expr;
  let e = expr.trim().replace(/\s*\/\s*/g, ' OR ').replace(/^\(([^()]*)\)$/, '$1');
  if (!/[()]/.test(e) && !/\bAND\b/.test(e)) {
    const terms = e.split(/\s+OR\s+/).map((s) => s.trim());
    e = [...new Set(terms)].sort().join(' OR ');
  }
  return e;
}

/**
 * The licence ids an expression names, and whether all of them apply (AND) or one (OR).
 * "Apache-2.0 WITH LLVM-exception" is Apache-2.0 with an extra permission, so it counts as
 * Apache-2.0.
 */
function parseExpression(expr) {
  const e = normalizeExpression(expr || '').replace(/([A-Za-z0-9.+-]+)\s+WITH\s+[A-Za-z0-9.+-]+/g, '$1');
  const ids = [...new Set(e.match(/[A-Za-z0-9.+-]+/g)?.filter((t) => !['AND', 'OR'].includes(t)) ?? [])];
  return { ids, conjunctive: /\bAND\b/.test(e) };
}

function licenseAllowed(expr) {
  const { ids, conjunctive } = parseExpression(expr);
  if (!ids.length) return false;
  if (conjunctive) return ids.every((id) => ALLOWED.has(id));
  return ids.some((id) => ALLOWED.has(id));
}

// ---- collected data -------------------------------------------------------------------------

class Notices {
  constructor() {
    /** @type {Map<string, any>} */
    this.components = new Map();
    /** @type {Map<string, {id: string, title: string, body: string}>} */
    this.texts = new Map();
    this.problems = [];
  }

  /** One entry per distinct text: copies that differ only in spacing, case or http/https share it. */
  addText(title, body) {
    const normalized = body.replace(/https?:\/\//g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const key = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    if (!this.texts.has(key)) this.texts.set(key, { id: key, title, body });
    return key;
  }

  add(component) {
    const existing = this.components.get(component.id);
    if (!existing) {
      this.components.set(component.id, component);
      return;
    }
    for (const scope of component.scopes) if (!existing.scopes.includes(scope)) existing.scopes.push(scope);
    for (const platform of component.platforms ?? []) {
      existing.platforms ??= [];
      if (!existing.platforms.includes(platform)) existing.platforms.push(platform);
    }
    for (const t of component.texts) if (!existing.texts.includes(t)) existing.texts.push(t);
    existing.scopes.sort();
    existing.platforms?.sort();
  }

  problem(message) {
    this.problems.push(message);
  }

  toJSON() {
    return {
      format: 'companion-atlas-third-party/1',
      components: [...this.components.values()].sort(byComponent),
      texts: [...this.texts.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  static fromJSON(data, into = new Notices()) {
    if (data.format !== 'companion-atlas-third-party/1') throw new Error('not a third-party notices data file');
    for (const t of data.texts) if (!into.texts.has(t.id)) into.texts.set(t.id, t);
    for (const c of data.components) into.add(structuredClone(c));
    return into;
  }
}

const ECOSYSTEM_ORDER = { npm: 0, cargo: 1, maven: 2 };
function byComponent(a, b) {
  return ECOSYSTEM_ORDER[a.ecosystem] - ECOSYSTEM_ORDER[b.ecosystem] || a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true });
}

/**
 * Pick the licence texts for one component: for a choice (OR), the preferred licence's file;
 * otherwise every licence file it ships. NOTICE files always come along (Apache-2.0 section 4(d)).
 * A package that ships no licence file gets the standard text with its authors as the holder.
 */
function attachTexts(notices, component, files, holderGuess) {
  const label = `${component.name} ${component.version}`;
  const { ids, conjunctive } = parseExpression(component.license);
  const notices_ = (files ?? []).filter((f) => NOTICE_FILE.test(f.name) && f.text);
  const licenses = (files ?? []).filter((f) => !NOTICE_FILE.test(f.name) && f.text);

  let chosen = licenses;
  if (!conjunctive && ids.length > 1 && licenses.length > 1) {
    for (const id of PREFERENCE.filter((p) => ids.includes(p))) {
      const match = licenses.filter((f) => hintFromName(f.name) === id || (!hintFromName(f.name) && sniff(f.text) === id));
      if (match.length) {
        chosen = match;
        break;
      }
    }
  }

  const keys = [];
  for (const f of chosen) keys.push(notices.addText(sniff(f.text) ?? 'Licence', f.text));
  for (const f of notices_) keys.push(notices.addText('NOTICE', f.text));

  if (!chosen.length) {
    const options = conjunctive ? ids : PREFERENCE.filter((p) => ids.includes(p)).concat(ids.filter((i) => !PREFERENCE.includes(i)));
    const wanted = conjunctive ? options : options.slice(0, 1);
    for (const id of wanted) {
      const template = TEMPLATES[id];
      if (!template) {
        notices.problem(`${component.ecosystem} ${label}: no licence file and no standard text for ${id}`);
        component.missingText = true;
        continue;
      }
      const holder = holderGuess || `Copyright (c) the ${component.name} authors`;
      keys.push(notices.addText(id, clean(template(holder))));
      // The package names the licence but ships no text of it: the list says so.
      component.standardText = true;
    }
  }
  component.texts = keys;
}

function checkLicense(notices, component) {
  const label = `${component.ecosystem} ${component.name} ${component.version}`;
  if (!component.license) notices.problem(`${label}: no licence declared`);
  else if (!licenseAllowed(component.license)) notices.problem(`${label}: licence "${component.license}" is not on the allowed list`);
}

// ---- npm ----------------------------------------------------------------------------------

function lookup(packages, from, name) {
  let dir = from;
  for (;;) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!dir) return null;
    const i = dir.lastIndexOf('/node_modules/');
    if (i >= 0) dir = dir.slice(0, i);
    else if (dir.startsWith('node_modules/')) dir = '';
    else dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
  }
}

/**
 * The packages an npm project needs at run time: its `dependencies`, then theirs (including
 * peer and optional dependencies that are installed), resolved the way Node resolves them.
 * Our own packages (FIRST_PARTY, and the workspace packages the lockfile links to) are not
 * listed, but the walk goes through them, because what they depend on is bundled with them:
 * the viewer's @companion-atlas/story brings zod and fast-xml-parser, for one.
 */
function npmClosure(lockPath, rootKey, { exclude = [] } = {}) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.lockfileVersion < 2) throw new Error(`${lockPath}: lockfileVersion ${lock.lockfileVersion} is not supported`);
  const packages = lock.packages;
  const root = packages[rootKey];
  if (!root) throw new Error(`${lockPath}: no package "${rootKey}"`);
  const found = new Map();
  /** The first-party packages already walked, by folder, so that a cycle among them ends. */
  const ours = new Set([rootKey]);

  const visit = (from, deps, optional) => {
    for (const name of Object.keys(deps ?? {})) {
      if (exclude.includes(name)) continue;
      let key = lookup(packages, from, name);
      if (!key) {
        if (!optional.has(name)) throw new Error(`${lockPath}: ${name} (needed by ${from || 'the root'}) is not in the lockfile`);
        continue;
      }
      // A workspace dependency is a link to the package's folder, where its own dependencies
      // resolve from.
      if (packages[key].link) key = packages[key].resolved;
      const pkg = packages[key];
      if (!pkg) throw new Error(`${lockPath}: ${name} links to "${key}", which is not in the lockfile`);
      if (found.has(key) || ours.has(key)) continue;
      // A workspace package is not under node_modules.
      if (FIRST_PARTY.test(name) || !key.includes('node_modules/')) ours.add(key);
      else found.set(key, pkg);
      const optionalNames = new Set([
        ...Object.keys(pkg.optionalDependencies ?? {}),
        ...Object.entries(pkg.peerDependenciesMeta ?? {}).filter(([, m]) => m.optional).map(([n]) => n),
      ]);
      visit(key, { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }, optionalNames);
    }
  };
  visit(rootKey, root.dependencies, new Set());
  return { lockDir: path.dirname(lockPath), found };
}

function collectNpm(notices, scope, lockPath, rootKey, options) {
  const { lockDir, found } = npmClosure(lockPath, rootKey, options);
  const ids = new Set();
  const notInstalled = [];
  for (const [key, pkg] of found) {
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const id = `npm:${name}@${pkg.version}`;
    ids.add(id);
    const dir = path.join(lockDir, key);
    const files = licenseFiles(dir);
    let manifest = null;
    if (files && existsSync(path.join(dir, 'package.json'))) manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));

    let license = typeof pkg.license === 'string' ? pkg.license : null;
    let declared = license;
    const clarification = CLARIFICATIONS[id];
    if (!license || /^SEE LICEN[CS]E IN /i.test(license) || license === 'UNLICENSED') {
      const sniffed = files?.map((f) => sniff(f.text)).find(Boolean);
      if (sniffed) license = sniffed;
      else if (clarification) license = clarification.license;
      else license = null;
    }
    const component = {
      id,
      ecosystem: 'npm',
      name,
      version: pkg.version,
      license,
      ...(declared !== license ? { declared: declared ?? '(none)' } : {}),
      url: `https://www.npmjs.com/package/${name}/v/${pkg.version}`,
      scopes: [scope],
      texts: [],
    };
    checkLicense(notices, component);
    if (files) {
      const author = typeof manifest?.author === 'string' ? manifest.author : manifest?.author?.name;
      attachTexts(notices, component, files, author ? `Copyright (c) ${author.replace(/\s*[<(].*$/, '')}` : null);
    } else {
      component.missingText = true;
      notInstalled.push(`${name} ${pkg.version}`);
    }
    notices.add(component);
  }
  if (notInstalled.length) {
    const where = path.relative(ROOT, lockDir).replace(/\\/g, '/') || 'the repository root';
    const which = notInstalled.length > 5 ? `${notInstalled.slice(0, 5).join(', ')} and ${notInstalled.length - 5} more` : notInstalled.join(', ');
    notices.problem(`npm (${scope}): ${notInstalled.length} of ${found.size} packages are not installed in ${where}, so their licence texts were not read: ${which}`);
  }
  return { count: ids.size };
}

// ---- cargo --------------------------------------------------------------------------------

function cargoMetadata(target) {
  const args = ['metadata', '--format-version', '1', '--locked', '--manifest-path', DESKTOP_MANIFEST, '--filter-platform', target];
  const run = spawnSync('cargo', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) throw new Error(`cargo metadata could not start (${run.error.message}); install Rust or leave "desktop" out of --scope`);
  if (run.status !== 0) throw new Error(`cargo ${args.join(' ')} failed:\n${run.stderr}`);
  return JSON.parse(run.stdout);
}

/** Crates linked into the executable: normal dependencies, without proc macros. */
function linkedCrates(metadata) {
  const packages = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const root = metadata.resolve.root;
  const seen = new Set([root]);
  const stack = [root];
  while (stack.length) {
    for (const dep of nodes.get(stack.pop()).deps) {
      if (seen.has(dep.pkg) || !dep.dep_kinds.some((k) => k.kind === null)) continue;
      const pkg = packages.get(dep.pkg);
      if (pkg.targets.some((t) => t.kind.includes('proc-macro'))) continue;
      seen.add(dep.pkg);
      stack.push(dep.pkg);
    }
  }
  seen.delete(root);
  return [...seen].map((id) => packages.get(id)).filter((p) => p.source);
}

function collectCargo(notices) {
  const crates = new Map();
  for (const [target, platform] of DESKTOP_TARGETS) {
    for (const pkg of linkedCrates(cargoMetadata(target))) {
      const entry = crates.get(pkg.id) ?? { pkg, platforms: new Set() };
      entry.platforms.add(platform);
      crates.set(pkg.id, entry);
    }
  }
  for (const { pkg, platforms } of crates.values()) {
    const dir = path.dirname(pkg.manifest_path);
    let files = licenseFiles(dir) ?? [];
    if (pkg.license_file) {
      const file = path.resolve(dir, pkg.license_file);
      if (existsSync(file) && !files.some((f) => path.resolve(dir, f.name) === file)) {
        files = [...files, { name: path.basename(file), text: clean(readFileSync(file, 'utf8')) }];
      }
    }
    const license = pkg.license ?? (pkg.license_file ? files.map((f) => sniff(f.text)).find(Boolean) ?? null : null);
    const component = {
      id: `cargo:${pkg.name}@${pkg.version}`,
      ecosystem: 'cargo',
      name: pkg.name,
      version: pkg.version,
      license,
      ...(pkg.license ? {} : { declared: pkg.license_file ? `license-file = ${pkg.license_file}` : '(none)' }),
      url: `https://crates.io/crates/${pkg.name}/${pkg.version}`,
      ...(pkg.repository ? { repository: pkg.repository } : {}),
      scopes: ['desktop'],
      platforms: [...platforms].sort(),
      texts: [],
    };
    checkLicense(notices, component);
    const authors = (pkg.authors ?? []).map((a) => a.replace(/\s*<[^>]*>/, '').trim()).filter(Boolean);
    attachTexts(notices, component, files, authors.length ? `Copyright (c) ${authors.join(', ')}` : null);
    notices.add(component);
  }
  return { count: crates.size };
}

// ---- Android libraries --------------------------------------------------------------------

function gradleReport(projectDir) {
  const args = ['-q', '--no-daemon', ':app:dependencies', '--configuration', 'releaseRuntimeClasspath'];
  const options = { cwd: projectDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  // A .bat file runs only through cmd.exe, which is given the wrapper's full path: it need not
  // search the current directory. The arguments are fixed, so the command line is too.
  const run =
    process.platform === 'win32'
      ? spawnSync(`"${path.join(projectDir, 'gradlew.bat')}" ${args.join(' ')}`, { ...options, shell: true })
      : spawnSync(path.join(projectDir, 'gradlew'), args, options);
  if (run.error) throw new Error(`Gradle could not start in ${projectDir}: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`gradlew ${args.join(' ')} failed in ${projectDir}:\n${run.stderr || run.stdout}`);
  return run.stdout;
}

/** group:artifact -> resolved version, from a `gradlew :app:dependencies` report. */
function parseGradleReport(report) {
  const artifacts = new Map();
  for (const line of report.split(/\r?\n/)) {
    const m = /^[\s|]*[+\\]--- (.+)$/.exec(line);
    if (!m) continue;
    let spec = m[1].trim();
    if (/\((c|n)\)$/.test(spec) || spec.startsWith('project ')) continue; // constraints, unresolved, our own modules
    spec = spec.replace(/\s+\(\*\)$/, '').replace(/\s+FAILED$/, '');
    const [requested, resolved] = spec.split(/\s+->\s+/);
    const parts = requested.split(':');
    if (parts.length < 2) continue;
    const version = (resolved ?? parts[2] ?? '').replace(/[{}]|strictly\s+/g, '').trim();
    if (!version) continue;
    artifacts.set(`${parts[0]}:${parts[1]}`, version);
  }
  return artifacts;
}

function collectMaven(notices, report) {
  const artifacts = parseGradleReport(report);
  if (!artifacts.size) throw new Error('the Gradle report lists no libraries; is it the output of `gradlew :app:dependencies --configuration releaseRuntimeClasspath`?');
  for (const [coordinates, version] of artifacts) {
    const [group, artifact] = coordinates.split(':');
    const rule = MAVEN_GROUPS.find((r) => r.match.test(group));
    const component = {
      id: `maven:${coordinates}@${version}`,
      ecosystem: 'maven',
      name: coordinates,
      version,
      license: rule?.license ?? null,
      url: rule?.url ?? `https://central.sonatype.com/artifact/${group}/${artifact}/${version}`,
      scopes: ['android'],
      texts: [],
    };
    checkLicense(notices, component);
    if (!rule) notices.problem(`maven ${coordinates} ${version}: group ${group} has no licence entry in MAVEN_GROUPS`);
    else if (rule.license === 'LicenseRef-Android-SDK') component.texts.push(notices.addText('Android Software Development Kit License', ANDROID_SDK_LICENSE_NOTE));
    else {
      const holder = rule.copyright ?? `Copyright (c) the ${group} authors`;
      component.texts.push(notices.addText(rule.license, clean(TEMPLATES[rule.license](holder))));
      if (rule.notice) component.texts.push(notices.addText('NOTICE', rule.notice));
    }
    notices.add(component);
  }
  return { count: artifacts.size };
}

// ---- output -------------------------------------------------------------------------------

const SCOPE_LABEL = { web: 'web viewer', desktop: 'desktop', android: 'Android' };

/** Break a long line at spaces; continuation lines start with `indent`. */
function wrap(line, width, indent) {
  const lines = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current && current.length + 1 + word.length > width) {
      lines.push(current);
      current = indent + word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines;
}

function displayLicense(c) {
  if (c.license === 'LicenseRef-Android-SDK') return 'Android SDK License';
  return normalizeExpression(c.license) ?? 'UNKNOWN';
}

function mplComponents(components) {
  return components.filter((c) => {
    const { ids, conjunctive } = parseExpression(c.license);
    const reciprocal = ids.filter((id) => RECIPROCAL.has(id));
    // Under a choice we use the permissive option, so only a forced MPL licence counts.
    return reciprocal.length && (conjunctive || ids.every((id) => RECIPROCAL.has(id)));
  });
}

function sourceLinks(c) {
  if (c.ecosystem === 'cargo') {
    return [`https://crates.io/api/v1/crates/${c.name}/${c.version}/download`, c.repository].filter(Boolean);
  }
  if (c.ecosystem === 'npm') return [`https://registry.npmjs.org/${c.name}/-/${c.name.split('/').pop()}-${c.version}.tgz`];
  return [c.url];
}

function renderText(notices) {
  const components = [...notices.components.values()].sort(byComponent);
  const scopes = [...new Set(components.flatMap((c) => c.scopes))].sort((a, b) => Object.keys(SCOPES).indexOf(a) - Object.keys(SCOPES).indexOf(b));
  const texts = [...notices.texts.values()];
  const order = new Map();
  for (const c of components) for (const t of c.texts) if (!order.has(t)) order.set(t, order.size + 1);
  const sortedTexts = texts.filter((t) => order.has(t.id)).sort((a, b) => order.get(a.id) - order.get(b.id));

  const out = [];
  const rule = (title, ch = '=') => out.push(title, ch.repeat(title.length), '');
  rule('Companion Atlas: third-party notices');
  out.push(
    'Companion Atlas is Copyright LifeScope INC, DBA Companion Intelligence',
    '(https://ci.computer), and is licensed under the PolyForm Noncommercial License',
    '1.0.0. That licence is in LICENSE.md, next to this file.',
    '',
    'Companion Atlas also contains the third-party software listed below, which its',
    'authors license under the terms reproduced after the list. This file covers:',
    '',
    ...scopes.map((s) => `  - ${SCOPES[s]}`),
    '',
    'It is generated from the lockfiles by scripts/third-party-notices.mjs in',
    'https://github.com/companionintelligence/CI-Spatial-Atlas.',
    '',
  );

  const mpl = mplComponents(components);
  if (mpl.length) {
    rule('Source code of the MPL-2.0 components', '-');
    out.push(
      'These components are licensed under the Mozilla Public License 2.0. Companion',
      'Atlas includes them unmodified, in executable form. Their source code is',
      'available from:',
      '',
    );
    for (const c of mpl) {
      out.push(`  ${c.name} ${c.version} (${c.scopes.map((s) => SCOPE_LABEL[s]).join(', ')})`);
      for (const link of sourceLinks(c)) out.push(`    ${link}`);
    }
    out.push('', 'The MPL-2.0 text is among the licence texts below.', '');
  }

  rule('Components', '-');
  const groups = [
    ['npm', 'web', 'Web viewer (npm packages)'],
    ['cargo', 'desktop', 'Desktop app (Rust crates; platforms in brackets)'],
    ['npm', 'android', 'Android app: Capacitor shell (npm packages)'],
    ['maven', 'android', 'Android app: Android libraries (Maven)'],
  ];
  for (const [ecosystem, scope, title] of groups) {
    const list = components.filter((c) => c.ecosystem === ecosystem && c.scopes.includes(scope) && !(scope === 'android' && ecosystem === 'npm' && c.scopes.includes('web')));
    if (!list.length) continue;
    out.push(`${title}:`, '');
    for (const c of list) {
      const refs = c.texts.map((t) => `[${order.get(t)}]`).join('');
      const platforms = c.platforms && c.platforms.length < 3 ? ` [${c.platforms.join(', ')}]` : '';
      const note = c.standardText ? ' (standard text: the package ships none)' : '';
      out.push(`  ${c.name} ${c.version}${platforms} - ${displayLicense(c)}${refs ? ` - text ${refs}${note}` : ' - TEXT MISSING'}`);
    }
    out.push('');
  }

  rule('Licence texts', '-');
  for (const t of sortedTexts) {
    const users = components.filter((c) => c.texts.includes(t.id));
    out.push(`[${order.get(t.id)}] ${t.title}`);
    out.push(...wrap(`Applies to: ${users.map((c) => `${c.name} ${c.version}`).join(', ')}`, 78, '  '));
    out.push('', t.body, '', '-'.repeat(78), '');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** How THIRD_PARTY.md and NOTICE.md are rebuilt, stated in both. */
const REGENERATE =
  'Regenerate it rather than editing it: after `npm install` at the root and in viewer-react/mobile and ' +
  '`npx cap sync android`, run `node scripts/third-party-notices.mjs --scope web,desktop,android ' +
  '--gradle viewer-react/mobile/android --docs`.';

const mdEscape = (s) => String(s).replace(/\|/g, '\\|');

function renderThirdPartyMd(notices, counts) {
  const components = [...notices.components.values()].sort(byComponent);
  const web = components.filter((c) => c.ecosystem === 'npm' && c.scopes.includes('web'));
  const crates = components.filter((c) => c.ecosystem === 'cargo');
  const shell = components.filter((c) => c.ecosystem === 'npm' && c.scopes.includes('android') && !c.scopes.includes('web'));
  const maven = components.filter((c) => c.ecosystem === 'maven');

  const licenses = new Map();
  const tally = (list, column) => {
    for (const c of list) {
      const key = displayLicense(c);
      const row = licenses.get(key) ?? { web: 0, desktop: 0, android: 0 };
      row[column]++;
      licenses.set(key, row);
    }
  };
  tally(web, 'web');
  tally(crates, 'desktop');
  tally([...shell, ...maven], 'android');

  const L = [];
  L.push('# Third-party software', '');
  L.push(
    'The third-party software inside the Companion Atlas apps, listed from the lockfiles by',
    '[`scripts/third-party-notices.mjs`](scripts/third-party-notices.mjs). Development tools that',
    'do not ship in an app (Vite, TypeScript, the test runners, the Capacitor CLI) and the',
    "processing server's dependencies are not listed.",
    '',
    '| Part | Ships in | Components | Listed from |',
    '| --- | --- | ---: | --- |',
    `| Web viewer | the website, the viewer image, and inside every app | ${web.length} npm packages | \`package-lock.json\`: the runtime dependencies of \`viewer-react\` and of the workspace packages it uses |`,
    `| Desktop | the Windows, macOS and Linux installers | ${crates.length} Rust crates | \`viewer-react/desktop/src-tauri/Cargo.lock\`, for each target platform |`,
    `| Android | the APK | ${shell.length} npm packages, ${maven.length} Android libraries | \`viewer-react/mobile/package-lock.json\`; Gradle's \`releaseRuntimeClasspath\` |`,
    '',
    'The licence texts, with the upstream NOTICE files, are in `THIRD-PARTY-NOTICES.txt`. Each app',
    'carries it in a `licenses` folder (next to the executable on Windows and Linux, in',
    '`Contents/Resources` on macOS, in the APK\'s assets on Android), and each release has it as a',
    'download. [NOTICE.md](NOTICE.md) has the notices that the licences require.',
    '',
    '## Licences',
    '',
    'Counts per part. The desktop and Android apps also carry the web viewer.',
    '',
    '| Licence | Web viewer | Desktop | Android |',
    '| --- | ---: | ---: | ---: |',
  );
  for (const [license, row] of [...licenses].sort((a, b) => (b[1].web + b[1].desktop + b[1].android) - (a[1].web + a[1].desktop + a[1].android) || a[0].localeCompare(b[0]))) {
    L.push(`| ${mdEscape(license)} | ${row.web || ''} | ${row.desktop || ''} | ${row.android || ''} |`);
  }
  L.push('');

  const table = (title, list, columns) => {
    L.push(title, '', `| ${columns.map((c) => c[0]).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`);
    for (const c of list) L.push(`| ${columns.map((col) => mdEscape(col[1](c))).join(' | ')} |`);
    L.push('');
  };
  const link = (c) => `[\`${c.name}\`](${c.url})`;
  const licenseCell = (c) => `${displayLicense(c)}${c.declared ? ` (declared: ${c.declared})` : ''}`;
  table('## Web viewer (npm)', web, [['Package', link], ['Version', (c) => c.version], ['Licence', licenseCell]]);
  table('## Desktop (Rust crates)', crates, [
    ['Crate', link],
    ['Version', (c) => c.version],
    ['Licence', licenseCell],
    ['Platforms', (c) => (c.platforms.length === 3 ? 'all' : c.platforms.join(', '))],
  ]);
  L.push('## Android', '');
  table('### Capacitor shell (npm)', shell, [['Package', link], ['Version', (c) => c.version], ['Licence', licenseCell]]);
  table('### Android libraries (Maven)', maven, [
    ['Library', (c) => `[\`${c.name}\`](${c.url})`],
    ['Version', (c) => c.version],
    ['Licence', displayLicense],
  ]);
  L.push('---', '', `_Generated by [\`scripts/third-party-notices.mjs\`](scripts/third-party-notices.mjs) (${counts}). ${REGENERATE}_`, '');
  return L.join('\n');
}

function renderNoticeMd(notices) {
  const components = [...notices.components.values()].sort(byComponent);
  const mpl = mplComponents(components);
  const choice = components.filter((c) => {
    const { ids, conjunctive } = parseExpression(c.license);
    return !conjunctive && ids.some((id) => RECIPROCAL.has(id)) && !ids.every((id) => RECIPROCAL.has(id));
  });
  const named = (pattern) => components.filter((c) => pattern.test(c.name));
  const versions = (list) => list.map((c) => `\`${c.name}\` ${c.version}`).join(', ');

  const L = [];
  L.push('# NOTICE', '');
  L.push(
    'Companion Atlas',
    '',
    'Required Notice: Copyright LifeScope INC, DBA Companion Intelligence (https://ci.computer)',
    '',
    'Companion Atlas is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).',
    '',
    'This file records the notices that the licences of the third-party software in the',
    'Companion Atlas apps require. The full list is [THIRD_PARTY.md](THIRD_PARTY.md). The',
    'licence texts, with the upstream NOTICE files, are in `THIRD-PARTY-NOTICES.txt`, which',
    'ships inside each app and is attached to each release.',
    '',
  );

  L.push('## MPL-2.0 components', '');
  if (mpl.length) {
    L.push(
      'The desktop app contains these crates, which are licensed under the',
      '[Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/). They are included',
      'unmodified, in executable form. Their source code is available here:',
      '',
      '| Component | Version | Source code |',
      '| --- | --- | --- |',
    );
    for (const c of mpl) L.push(`| \`${c.name}\` | ${c.version} | ${sourceLinks(c).map((u) => `<${u}>`).join('<br>')} |`);
    L.push('');
  } else {
    L.push('None.', '');
  }

  if (choice.length) {
    L.push(
      '## Components offered under a choice of licences',
      '',
      'Where a component offers a choice that includes MPL-2.0, Companion Atlas uses the other',
      'licence:',
      '',
    );
    for (const c of choice) {
      const other = parseExpression(c.license).ids.filter((id) => !RECIPROCAL.has(id));
      L.push(`- \`${c.name}\` ${c.version} (${normalizeExpression(c.license)}): used under ${other.join(' or ')}.`);
    }
    L.push('');
  }

  L.push('## Attribution', '');
  const cesium = named(/^cesium$/);
  if (cesium.length) {
    L.push(
      `- **CesiumJS** (${versions(cesium)}), Apache-2.0, Copyright CesiumJS Contributors. The app ships`,
      "  Cesium's prebuilt runtime (`cesium/` in the viewer). Cesium's `LICENSE.md`, reproduced in the",
      '  notices file, lists the third-party code and data inside it, including zip.js, Knockout,',
      '  DOMPurify, Draco, basis_universal, LERC, protobuf.js, Natural Earth, the NASA sky box,',
      "  Freepik icons (CC BY 3.0), Maki, and James Hastings-Trew's moon texture.",
    );
  }
  const manrope = named(/^@fontsource\/manrope$/);
  if (manrope.length) L.push(`- **Manrope** font (${versions(manrope)}), SIL Open Font License 1.1, Copyright 2019 The Manrope Project Authors.`);
  const fontawesome = named(/^@fortawesome\//);
  if (fontawesome.length) L.push(`- **Font Awesome Free** icons (${versions(fontawesome)}), by Fonticons, Inc.: icons CC BY 4.0, code MIT (https://fontawesome.com/license/free).`);
  const unicode = components.filter((c) => /Unicode/.test(c.license ?? ''));
  if (unicode.length) L.push(`- **Unicode data and code** under the Unicode License v3 in the desktop app: ${unicode.map((c) => `\`${c.name}\``).join(', ')}.`);
  const gms = components.filter((c) => c.license === 'LicenseRef-Android-SDK');
  if (gms.length) L.push(`- **Google Play services** (${versions(gms)}) in the Android app, under the [Android Software Development Kit License](https://developer.android.com/studio/terms).`);
  const cordova = named(/^org\.apache\.cordova:/);
  if (cordova.length) L.push(`- **Apache Cordova** (${versions(cordova)}) in the Android app: "This product includes software developed at The Apache Software Foundation (http://www.apache.org/)."`);
  L.push('');

  L.push(
    '## First-party code',
    '',
    'Except as noted above, the contents of this repository are',
    'Copyright © LifeScope INC, DBA Companion Intelligence (<https://ci.computer>),',
    'licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).',
    '',
    '---',
    '',
    `_Generated by [\`scripts/third-party-notices.mjs\`](scripts/third-party-notices.mjs). ${REGENERATE}_`,
    '',
  );
  return L.join('\n');
}

// ---- command line -------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { scope: [], from: [], strict: process.env.ATLAS_NOTICES_STRICT === '1' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === '--scope') options.scope.push(...value().split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg === '--out') options.out = value();
    else if (arg === '--json') options.json = value();
    else if (arg === '--from') options.from.push(value());
    else if (arg === '--gradle') options.gradle = value();
    else if (arg === '--gradle-deps') options.gradleDeps = value();
    else if (arg === '--docs') options.docs = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  for (const s of options.scope) if (!SCOPES[s]) throw new Error(`unknown scope "${s}" (use ${Object.keys(SCOPES).join(', ')})`);
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || (!options.scope.length && !options.from.length)) {
    // The comment block at the top of this file, without its slashes.
    const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1);
    const header = lines.slice(0, lines.findIndex((l) => !l.startsWith('//')));
    console.log(header.map((l) => l.slice(3)).join('\n'));
    return options.help ? 0 : 2;
  }

  const notices = new Notices();
  const counts = [];
  for (const file of options.from) Notices.fromJSON(JSON.parse(readFileSync(file, 'utf8')), notices);

  if (options.scope.includes('web')) {
    const r = collectNpm(notices, 'web', path.join(ROOT, 'package-lock.json'), 'viewer-react');
    counts.push(`web: ${r.count} npm packages`);
  }
  if (options.scope.includes('desktop')) {
    const r = collectCargo(notices);
    counts.push(`desktop: ${r.count} crates`);
  }
  if (options.scope.includes('android')) {
    const r = collectNpm(notices, 'android', path.join(MOBILE_DIR, 'package-lock.json'), '', { exclude: ['@capacitor/ios'] });
    counts.push(`android: ${r.count} npm packages`);
    let report = null;
    if (options.gradleDeps) report = readFileSync(options.gradleDeps, 'utf8');
    else if (options.gradle) report = gradleReport(path.resolve(options.gradle));
    if (report) counts.push(`android: ${collectMaven(notices, report).count} Android libraries`);
    else notices.problem('android: the Android libraries were not listed (pass --gradle or --gradle-deps)');
  }

  const problems = [...new Set(notices.problems)];
  for (const p of problems) console.warn(`${options.strict ? 'error' : 'warning'}: ${p}`);
  if (options.strict && problems.length) {
    console.error(`third-party notices: ${problems.length} problem(s); fix them or add a clarification in scripts/third-party-notices.mjs`);
    return 1;
  }

  if (options.json) {
    mkdirSync(path.dirname(path.resolve(options.json)), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify(notices.toJSON(), null, 1)}\n`);
  }
  if (options.out) {
    mkdirSync(options.out, { recursive: true });
    writeFileSync(path.join(options.out, 'THIRD-PARTY-NOTICES.txt'), renderText(notices));
    copyFileSync(path.join(ROOT, 'LICENSE.md'), path.join(options.out, 'LICENSE.md'));
  }
  if (options.docs) {
    writeFileSync(path.join(ROOT, 'THIRD_PARTY.md'), renderThirdPartyMd(notices, counts.join(', ')));
    writeFileSync(path.join(ROOT, 'NOTICE.md'), renderNoticeMd(notices));
  }
  console.log(`third-party notices: ${notices.components.size} components, ${notices.texts.size} licence texts${counts.length ? ` (${counts.join('; ')})` : ''}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`third-party notices: ${error.message}`);
  process.exitCode = 1;
}
