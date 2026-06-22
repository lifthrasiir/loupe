'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
function tmpDist() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loupe-test-dist-'));
}

const { buildBrowser, sharedFiles } = require('../scripts/build-extension.js');

for (const browser of ['chrome', 'firefox']) {
  test(`${browser} package contains required extension assets`, () => {
    const { targetDir } = buildBrowser(browser, { distDir: tmpDist() });
    for (const file of sharedFiles) {
      assert.ok(fs.existsSync(path.join(targetDir, file)), `${file} missing`);
    }
    assert.ok(fs.existsSync(path.join(targetDir, 'manifest.json')));
  });
}
