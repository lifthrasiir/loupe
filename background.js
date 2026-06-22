'use strict';

if (typeof importScripts === 'function' && typeof LoupeApi === 'undefined') {
  importScripts('extension-api.js');
}

LoupeApi.commands.onCommand.addListener((command, tab) => {
  if (command === 'run-ocr' && tab && tab.id !== undefined) {
    LoupeApi.tabs.sendMessage(tab.id, { type: 'run-ocr' }).catch((error) => {
      console.warn('[Loupe] Failed to send command to tab:', error.message);
    });
  }
});

let creatingOffscreen = null;

async function ensureOffscreen() {
  if (!LoupeApi.offscreen) return false;

  if (typeof LoupeApi.offscreen.hasDocument === 'function' &&
      await LoupeApi.offscreen.hasDocument()) {
    return true;
  }

  if (!creatingOffscreen) {
    creatingOffscreen = LoupeApi.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'Required for DOM-backed local OCR processing.'
    }).finally(() => {
      creatingOffscreen = null;
    });
  }
  await creatingOffscreen;
  return true;
}

LoupeApi.runtime.onMessage.addListener((msg, sender) => {
  if (msg.target === 'offscreen' || msg.target === 'ocr-host') return undefined;

  if (msg.type === 'fetch-image') {
    return fetchImage(msg.url, msg.pageUrl);
  }

  if (msg.type === 'capture-visible') {
    return captureVisible(sender.tab.id, msg.rect, msg.dpr);
  }

  if (msg.type === 'ocr-process') {
    return processOCR(msg);
  }

  return undefined;
});

async function processOCR(msg) {
  try {
    if (await ensureOffscreen()) {
      return LoupeApi.runtime.sendMessage({
        ...msg,
        target: 'offscreen'
      });
    }

    if (!globalThis.LoupeOcrHost) {
      throw new Error('OCR host is not available in this browser context');
    }

    const result = await globalThis.LoupeOcrHost.processImageDataUrl(msg.imageDataUrl);
    return { result };
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

async function fetchImage(url, pageUrl) {
  try {
    const resp = await fetch(url, {
      referrer: pageUrl || '',
      referrerPolicy: 'no-referrer-when-downgrade',
      credentials: 'include'
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    return { dataUrl: await blobToDataUrl(blob) };
  } catch (e) {
    return { error: e.message };
  }
}

async function captureVisible(tabId, rect, dpr) {
  try {
    const dataUrl = await LoupeApi.tabs.captureVisibleTab(null, {
      format: 'png'
    });
    return { dataUrl, rect, dpr };
  } catch (e) {
    return { error: e.message };
  }
}

async function blobToDataUrl(blob) {
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(
      null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length))
    );
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
