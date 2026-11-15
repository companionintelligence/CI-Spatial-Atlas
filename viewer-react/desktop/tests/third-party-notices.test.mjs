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

// webview2-com-sys links Microsoft's WebView2 loader (WebView2LoaderStatic.lib) into the
// Windows executable, and the loader's licence asks for Microsoft's notice in every binary
// redistribution.
test('the desktop notices carry the licence of the WebView2 loader in the Windows app', (t) => {
  if (spawnSync('cargo', ['--version']).error) {
    t.skip('cargo is not installed');
    return;
  }
  const data = collect('desktop');
  const crate = data.components.find((c) => c.name === 'webview2-com-sys');
  assert.ok(crate, 'webview2-com-sys is in the desktop scope');
  assert.deepEqual(crate.platforms, ['windows']);
  const text = data.texts.find((x) => x.id === crate.linked?.[0]?.text);
  assert.match(text?.body ?? '', /^Copyright \(C\) Microsoft Corporation\. All rights reserved\./);
  assert.match(text.body, /Redistributions in binary form must reproduce the above\s+copyright notice/);
});
