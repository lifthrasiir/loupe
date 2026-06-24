'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function loadBackground(extraApi = {}) {
  let messageListener;
  const context = vm.createContext({
    console,
    LoupeApi: {
      commands: { onCommand: { addListener() {} } },
      tabs: {
        sendMessage: async () => ({}),
        captureVisibleTab: async () => 'data:image/png;base64,abc'
      },
      runtime: {
        onMessage: { addListener(fn) { messageListener = fn; } },
        sendMessage: async (message) => ({ forwarded: message })
      },
      offscreen: null,
      ...extraApi
    }
  });
  context.globalThis = context;
  vm.runInContext(source, context);
  return { context, messageListener };
}

test('background ignores offscreen-target messages synchronously', () => {
  const { messageListener } = loadBackground();
  let responded = false;
  const result = messageListener(
    { target: 'offscreen', type: 'ocr-process' },
    {},
    () => { responded = true; }
  );
  assert.equal(result, undefined);
  assert.equal(responded, false);
});

test('background returns a promise only for handled OCR messages', async () => {
  const { context, messageListener } = loadBackground();
  context.LoupeOcrHost = {
    async processImageDataUrl(imageDataUrl) {
      return { regions: [], imageDataUrl };
    }
  };
  const result = messageListener({ type: 'ocr-process', imageDataUrl: 'data:image/png;base64,abc' }, {});
  assert.equal(typeof result.then, 'function');
  assert.equal(JSON.stringify(await result), JSON.stringify({
    result: { regions: [], imageDataUrl: 'data:image/png;base64,abc' }
  }));
});
