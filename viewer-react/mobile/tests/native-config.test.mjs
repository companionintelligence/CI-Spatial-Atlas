import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = await readFile(path.join(here, '../capacitor.config.ts'), 'utf8');
const versionConfig = await readFile(path.join(here, '../ios/version.xcconfig'), 'utf8');
const appGradle = await readFile(path.join(here, '../android/app/build.gradle'), 'utf8');

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

// ios/version.xcconfig is the one version source: the Android build reads versionName and
// versionCode from it with the patterns below (android/app/build.gradle), and the release
// workflow checks the tag against MARKETING_VERSION.
test('Atlas mobile version is a release version with a whole-number build', () => {
  assert.match(appGradle, /rootProject\.file\('\.\.\/ios\/version\.xcconfig'\)/);
  const versionName = /^MARKETING_VERSION\s*=\s*(\S+)/m.exec(versionConfig)?.[1];
  const versionCode = /^CURRENT_PROJECT_VERSION\s*=\s*(\d+)\s*$/m.exec(versionConfig)?.[1];
  assert.match(versionName ?? '', /^\d+\.\d+\.\d+$/);
  assert.ok(Number(versionCode) >= 1);
});
