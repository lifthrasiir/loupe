'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'ocr-engine.js'), 'utf8');

test('WebGL readback prefers float32 with half-float fallback', () => {
  assert.match(source, /IMPLEMENTATION_COLOR_READ_FORMAT/);
  assert.match(source, /IMPLEMENTATION_COLOR_READ_TYPE/);
  assert.match(source, /tryReadFloat/);
  assert.match(source, /tryReadHalf/);
  assert.match(source, /tryReadByte/);
  assert.match(source, /gl\.readBuffer\(gl\.COLOR_ATTACHMENT0\)/);
  assert.match(source, /gl\.finish\(\)/);
  assert.doesNotMatch(source, /inputReadbackType/);
  assert.doesNotMatch(source, /inputMax/);
  assert.match(source, /readbackType/);
});


test('Firefox uses float32 render targets and adaptive detector sizing', () => {
  assert.ok(source.includes('/Firefox\\//.test'));
  assert.match(source, /gl\.RGBA32F/);
  assert.match(source, /MAX_RENDERBUFFER_SIZE/);
  assert.match(source, /detMaxSide/);
  assert.match(source, /floatTextureFormat/);
  assert.doesNotMatch(source, /detSamples/);
  assert.doesNotMatch(source, /_sampleOutput/);
});
