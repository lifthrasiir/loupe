'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function tmpDist() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loupe-test-dist-'));
}

const { buildBrowser } = require('../scripts/build-extension.js');

test('Firefox manifest excludes offscreen and uses background scripts', () => {
  const { manifest } = buildBrowser('firefox', { distDir: tmpDist() });
  assert.equal(manifest.manifest_version, 3);
  assert.ok(!manifest.permissions.includes('offscreen'));
  assert.deepEqual(manifest.background.scripts, [
    'extension-api.js',
    'ocr-engine.js',
    'ocr-document.js',
    'background.js'
  ]);
  assert.equal(manifest.background.service_worker, undefined);
  assert.equal(manifest.browser_specific_settings.gecko.id, 'loupe@teslamint.local');
  assert.deepEqual(
    manifest.browser_specific_settings.gecko.data_collection_permissions.required,
    ['none']
  );
  assert.ok(manifest.content_scripts[0].js.includes('extension-api.js'));
});

test('Chrome manifest keeps offscreen and uses service worker', () => {
  const { manifest } = buildBrowser('chrome', { distDir: tmpDist() });
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.background.scripts, undefined);
});
