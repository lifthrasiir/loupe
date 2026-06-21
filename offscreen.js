'use strict';

let initPromise = null;

async function ensureEngine() {
  if (window.LoupeEngine.isReady()) return;
  if (!initPromise) {
    initPromise = window.LoupeEngine.init(
      chrome.runtime.getURL('.')
    );
  }
  return initPromise;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  if (msg.type === 'ocr-process') {
    (async () => {
      try {
        await ensureEngine();

        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = msg.imageDataUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const result = await window.LoupeEngine.processImage(
          imageData.data, imageData.width, imageData.height
        );
        sendResponse({ result });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});
