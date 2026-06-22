'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'extension-api.js'), 'utf8');

function loadApi(globals) {
  const context = vm.createContext({ console, ...globals });
  vm.runInContext(source, context);
  return context.LoupeApi;
}

test('adapter prefers promise-native browser namespace', async () => {
  const calls = [];
  const api = loadApi({
    browser: {
      runtime: {
        getURL: (p) => `moz-extension://id/${p}`,
        sendMessage: async (message) => ({ ok: true, message }),
        onMessage: { addListener: () => {} }
      },
      tabs: {
        sendMessage: async (tabId, message) => ({ tabId, message }),
        captureVisibleTab: async () => 'data:image/png;base64,abc'
      },
      commands: { onCommand: { addListener: (fn) => calls.push(fn) } }
    },
    chrome: {}
  });

  assert.equal(api.runtime.getURL('.'), 'moz-extension://id/.');
  assert.deepEqual(await api.runtime.sendMessage({ type: 'ping' }), { ok: true, message: { type: 'ping' } });
  assert.equal(await api.tabs.captureVisibleTab(null, { format: 'png' }), 'data:image/png;base64,abc');
});

test('adapter wraps callback-style chrome APIs and lastError', async () => {
  const chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => `chrome-extension://id/${p}`,
      sendMessage(message, cb) { cb({ ok: true, message }); },
      onMessage: { addListener: () => {} }
    },
    tabs: {
      sendMessage(tabId, message, cb) { cb({ tabId, message }); },
      captureVisibleTab(windowId, options, cb) { cb('data:image/png;base64,abc'); }
    },
    commands: { onCommand: { addListener: () => {} } }
  };
  const api = loadApi({ chrome });
  assert.deepEqual(await api.runtime.sendMessage({ type: 'ping' }), { ok: true, message: { type: 'ping' } });

  chrome.runtime.sendMessage = (message, cb) => {
    chrome.runtime.lastError = { message: 'boom' };
    cb(undefined);
    chrome.runtime.lastError = null;
  };
  await assert.rejects(() => api.runtime.sendMessage({ type: 'ping' }), /boom/);
});

test('message listener sends async results and keeps channel open', async () => {
  let wrapped;
  const api = loadApi({
    chrome: {
      runtime: {
        getURL: (p) => p,
        sendMessage: () => {},
        onMessage: { addListener: (fn) => { wrapped = fn; } }
      },
      tabs: { sendMessage: () => {}, captureVisibleTab: () => {} },
      commands: { onCommand: { addListener: () => {} } }
    }
  });

  api.runtime.onMessage.addListener(async (message) => ({ echo: message.type }));
  const response = await new Promise((resolve) => {
    const keepOpen = wrapped({ type: 'hello' }, {}, resolve);
    assert.equal(keepOpen, true);
  });
  assert.deepEqual(response, { echo: 'hello' });
});
