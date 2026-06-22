'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ocr-document.js'), 'utf8');

test('OCR host initializes engine once for concurrent requests', async () => {
  let initCalls = 0;
  let processCalls = 0;
  let listener;
  const context = vm.createContext({
    console,
    Image: class {
      set src(value) {
        this.naturalWidth = 2;
        this.naturalHeight = 1;
        queueMicrotask(() => this.onload && this.onload());
      }
    },
    document: {
      createElement() {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage() {},
              getImageData() { return { data: new Uint8ClampedArray(8), width: 2, height: 1 }; }
            };
          }
        };
      }
    },
    LoupeApi: {
      runtime: {
        getURL: (p) => `moz-extension://id/${p}`,
        onMessage: { addListener(fn) { listener = fn; } }
      }
    },
    LoupeEngine: {
      ready: false,
      isReady() { return this.ready; },
      async init(baseUrl) {
        initCalls += 1;
        assert.equal(baseUrl, 'moz-extension://id/.');
        await Promise.resolve();
        this.ready = true;
      },
      async processImage(data, width, height) {
        processCalls += 1;
        return { regions: [], width, height, bytes: data.length };
      }
    },
    queueMicrotask
  });
  context.globalThis = context;
  vm.runInContext(source, context);

  const msg = { target: 'ocr-host', type: 'ocr-process', imageDataUrl: 'data:image/png;base64,abc' };
  const [a, b] = await Promise.all([listener(msg), listener(msg)]);
  assert.equal(initCalls, 1);
  assert.equal(processCalls, 2);
  for (const response of [a.result, b.result]) {
    assert.equal(response.width, 2);
    assert.equal(response.height, 1);
    assert.equal(response.bytes, 8);
    assert.equal(response.regions.length, 0);
    assert.equal(response._debug.inputWidth, 2);
    assert.equal(response._debug.inputHeight, 1);
    assert.equal(response._debug.regionCount, 0);
  }
});


test('OCR host ignores non-target messages synchronously', () => {
  let listener;
  const context = vm.createContext({
    console,
    Image: class {},
    document: { createElement() { throw new Error('should not create canvas'); } },
    LoupeApi: {
      runtime: {
        getURL: (p) => p,
        onMessage: { addListener(fn) { listener = fn; } }
      }
    },
    LoupeEngine: { isReady() { return false; } }
  });
  context.globalThis = context;
  vm.runInContext(source, context);

  assert.equal(listener({ type: 'ocr-process' }), undefined);
  assert.equal(listener({ target: 'ocr-host', type: 'unrelated' }), undefined);
});
