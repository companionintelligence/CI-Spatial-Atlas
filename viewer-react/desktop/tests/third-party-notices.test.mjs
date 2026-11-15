import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '../../../scripts/third-party-notices.mjs');

/**
 * The notices data for one scope. It lists the components from the lockfiles alone, so these
 * checks need no install: without one, the licence texts are only reported missing.
 */
function collect(scope) {
  const dir = mkdtempSync(path.join(tmpdir(), 'atlas-notices-'));
  try {
    const file = path.join(dir, 'notices.json');
    const run = spawnSync(process.execPath, [script, '--scope', scope, '--json', file], {
      encoding: 'utf8',
      env: { ...process.env, ATLAS_NOTICES_STRICT: '' },
    });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(readFileSync(file, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The viewer imports the workspace package @companion-atlas/story, so the bundle carries what
// that package uses: zod and fast-xml-parser. The notices used to skip our own packages
// without looking at their dependencies, and left these two out.
test('the notices list the npm packages the viewer gets through its workspace packages', () => {
  const ids = collect('web').components.map((c) => c.id);
  for (const name of ['zod', 'fast-xml-parser']) {
    assert.ok(ids.some((id) => id.startsWith(`npm:${name}@`)), `${name} is in the web scope`);
  }
  assert.deepEqual(ids.filter((id) => /^npm:@(companion-atlas|companionintelligence)\//.test(id)), [], 'our own packages are not listed');
});

const noCargo = Boolean(spawnSync('cargo', ['--version']).error);
let desktopData;
/** The desktop scope, collected once: it runs cargo metadata and cargo tree for each target. */
function desktop() {
  desktopData ??= collect('desktop');
  return desktopData;
}

// The executable has only the crates the build compiles for it. Build scripts and proc macros
// get their own copies of a crate, with their own features: the build scripts (through
// tauri-build and tauri-plugin) and the tauri-macros proc macro turn on the HTML handling of
// tauri-utils (dom_query, html5ever and the MPL-2.0 crates cssparser, selectors and
// dtoa-short), which the executable's tauri-utils does not have. The notices once listed
// those, from cargo metadata's merged graph.
test('the desktop notices list only the crates built into the executable', (t) => {
  if (noCargo) {
    t.skip('cargo is not installed');
    return;
  }
  const crates = new Map(desktop().components.map((c) => [c.name, c]));
  for (const name of ['tauri', 'tauri-utils', 'tauri-runtime-wry', 'wry', 'option-ext']) {
    assert.deepEqual(crates.get(name)?.platforms, ['linux', 'macos', 'windows'], `${name} is in every desktop app`);
  }
  for (const name of ['tauri-build', 'tauri-codegen', 'tauri-macros', 'dom_query', 'html5ever', 'cssparser', 'selectors', 'dtoa-short']) {
    assert.ok(!crates.has(name), `${name} is not in the executable`);
  }
});

// webview2-com-sys links Microsoft's WebView2 loader (WebView2LoaderStatic.lib) into the
// Windows executable, and the loader's licence asks for Microsoft's notice in every binary
// redistribution.
test('the desktop notices carry the licence of the WebView2 loader in the Windows app', (t) => {
  if (noCargo) {
    t.skip('cargo is not installed');
    return;
  }
  const data = desktop();
  const crate = data.components.find((c) => c.name === 'webview2-com-sys');
  assert.ok(crate, 'webview2-com-sys is in the desktop scope');
  assert.deepEqual(crate.platforms, ['windows']);
  const text = data.texts.find((x) => x.id === crate.linked?.[0]?.text);
  assert.match(text?.body ?? '', /^Copyright \(C\) Microsoft Corporation\. All rights reserved\./);
  assert.match(text.body, /Redistributions in binary form must reproduce the above\s+copyright notice/);
});
