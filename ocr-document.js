'use strict';

(function (global) {
  let initPromise = null;

  async function ensureEngine() {
    if (!global.LoupeEngine) {
      throw new Error('OCR engine is not loaded');
    }
    if (global.LoupeEngine.isReady()) return;
    if (!initPromise) {
      initPromise = global.LoupeEngine.init(global.LoupeApi.runtime.getURL('.'));
    }
    return initPromise;
  }

  async function imageDataUrlToPixels(imageDataUrl) {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageDataUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  async function processImageDataUrl(imageDataUrl) {
    await ensureEngine();
    const imageData = await imageDataUrlToPixels(imageDataUrl);
    const result = await global.LoupeEngine.processImage(
      imageData.data, imageData.width, imageData.height
    );
    result._debug = {
      inputWidth: imageData.width,
      inputHeight: imageData.height,
      regionCount: Array.isArray(result.regions) ? result.regions.length : null,
      engine: result.debug || null
    };
    return result;
  }

  global.LoupeOcrHost = { processImageDataUrl };

  if (global.LoupeApi && global.LoupeApi.runtime) {
    global.LoupeApi.runtime.onMessage.addListener((msg) => {
      if (msg.target !== 'offscreen' && msg.target !== 'ocr-host') return undefined;
      if (msg.type !== 'ocr-process') return undefined;

      return processImageDataUrl(msg.imageDataUrl)
        .then((result) => ({ result }))
        .catch((error) => ({ error: error.message || String(error) }));
    });
  }
})(globalThis);
