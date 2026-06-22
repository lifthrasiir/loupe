'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'overlay.js'), 'utf8');

function loadOverlay(cssSupports) {
  const context = vm.createContext({
    console,
    CSS: { supports: cssSupports },
    window: {},
    document: {}
  });
  context.window = context;
  vm.runInContext(source, context);
  return context.LoupeOverlay._test;
}

test('detects missing CSS anchor positioning support', () => {
  const helpers = loadOverlay(() => false);
  assert.equal(helpers.supportsAnchorPositioning(), false);
});

test('detects CSS anchor positioning only when both anchor functions exist', () => {
  const helpers = loadOverlay((query) => query.includes('anchor'));
  assert.equal(helpers.supportsAnchorPositioning(), true);
});

test('geometry fallback applies fixed target rectangle', () => {
  const helpers = loadOverlay(() => false);
  const host = { style: {} };
  const target = {
    getBoundingClientRect() {
      return { top: 11, left: 22, width: 333, height: 44 };
    }
  };
  helpers.applyGeometryPosition(host, target);
  assert.deepEqual(host.style, {
    top: '11px',
    left: '22px',
    width: '333px',
    height: '44px'
  });
});
