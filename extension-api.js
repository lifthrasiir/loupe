'use strict';

(function (global) {
  const nativeApi = global.browser || global.chrome;
  if (!nativeApi) {
    throw new Error('Loupe requires the WebExtensions browser or chrome API.');
  }

  function lastError() {
    return nativeApi.runtime && nativeApi.runtime.lastError;
  }

  function promisifyCall(fn, receiver, args) {
    try {
      const maybePromise = fn.apply(receiver, args);
      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise;
      }
      return Promise.resolve(maybePromise);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function callbackCall(fn, receiver, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      function finish(value) {
        settled = true;
        const error = lastError();
        if (error) reject(new Error(error.message || String(error)));
        else resolve(value);
      }

      try {
        const maybePromise = fn.apply(receiver, [...args, finish]);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve, reject);
        } else if (fn.length <= args.length && !settled) {
          const error = lastError();
          if (error) reject(new Error(error.message || String(error)));
          else resolve(maybePromise);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  function callApi(fn, receiver, args) {
    if (global.browser && nativeApi === global.browser) {
      return promisifyCall(fn, receiver, args);
    }
    return callbackCall(fn, receiver, args);
  }

  function addAsyncMessageListener(handler) {
    nativeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      let result;
      try {
        result = handler(message, sender);
      } catch (error) {
        sendResponse({ error: error.message });
        return false;
      }

      if (result && typeof result.then === 'function') {
        result.then(
          (value) => sendResponse(value),
          (error) => sendResponse({ error: error.message || String(error) })
        );
        return true;
      }

      if (result !== undefined) {
        sendResponse(result);
      }
      return false;
    });
  }

  const api = {
    raw: nativeApi,
    runtime: {
      getURL(path) {
        return nativeApi.runtime.getURL(path);
      },
      sendMessage(message) {
        return callApi(nativeApi.runtime.sendMessage, nativeApi.runtime, [message]);
      },
      onMessage: {
        addListener: addAsyncMessageListener
      }
    },
    commands: {
      onCommand: nativeApi.commands && nativeApi.commands.onCommand
    },
    tabs: {
      sendMessage(tabId, message) {
        return callApi(nativeApi.tabs.sendMessage, nativeApi.tabs, [tabId, message]);
      },
      captureVisibleTab(windowId, options) {
        return callApi(nativeApi.tabs.captureVisibleTab, nativeApi.tabs, [windowId, options]);
      }
    },
    offscreen: nativeApi.offscreen || null
  };

  global.LoupeApi = api;
})(globalThis);
