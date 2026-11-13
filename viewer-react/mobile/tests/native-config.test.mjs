import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = await readFile(path.join(here, '../capacitor.config.ts'), 'utf8');

test('Atlas mobile bundles the viewer and uses its stable app identifier', () => {
  assert.match(config, /appId:\s*'com\.companionintelligence\.atlas'/);
  assert.match(config, /appName:\s*'Companion Atlas'/);
  assert.match(config, /webDir:\s*'\.\.\/dist'/);
  assert.doesNotMatch(config, /server:\s*\{[^}]*url:/s);
});

test('Atlas mobile keeps map and Memory services on HTTPS', () => {
  assert.match(config, /androidScheme:\s*'https'/);
  assert.doesNotMatch(config, /allowMixedContent:\s*true/);
  assert.match(config, /zoomEnabled:\s*true/);
});
