'use strict';

(function () {

  let lastTarget = null;
  let loading = false;
  let statusEl = null;

  document.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && (el.tagName === 'IMG' || el.tagName === 'CANVAS')) {
      lastTarget = el;
    }
  }, { passive: true });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'run-ocr') handleOCR();
  });

  async function handleOCR() {
    if (loading) return;

    window.LoupeOverlay.removeOverlay();

    const target = lastTarget;
    if (!target) {
      showStatus('No image or canvas under cursor');
      return;
    }

    lastTarget = null;
    loading = true;
    try {
      showStatus('Getting image data...');
      const imageData = await getImageData(target);
      if (!imageData) {
        showStatus('Failed to get image data');
        return;
      }

      showStatus('Running OCR...');
      const result = await runOCROffscreen(imageData.pixels);

      if (result.regions.length === 0) {
        showStatus('No text found');
        return;
      }

      if (imageData.offsetX || imageData.offsetY) {
        for (const r of result.regions) {
          for (const pt of r.bbox.points) {
            pt[0] += imageData.offsetX;
            pt[1] += imageData.offsetY;
          }
        }
      }

      window.LoupeOverlay.createOverlay(
        target, result.regions,
        imageData.fullWidth, imageData.fullHeight,
        imageData.pixels
      );

      showStatus(`Found ${result.regions.length} text regions (${result.timing.total_ms}ms)`);
      setTimeout(hideStatus, 3000);
    } catch (e) {
      console.error('[Loupe]', e);
      showStatus('Error: ' + e.message);
    } finally {
      loading = false;
    }
  }

  async function runOCROffscreen(pixels) {
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    canvas.getContext('2d').putImageData(pixels, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');

    const response = await chrome.runtime.sendMessage({
      type: 'ocr-process',
      imageDataUrl: dataUrl
    });

    if (response.error) throw new Error(response.error);
    return response.result;
  }

  function wrapFull(pixels) {
    return { pixels, offsetX: 0, offsetY: 0, fullWidth: pixels.width, fullHeight: pixels.height };
  }

  function collectImageUrls(el) {
    const urls = [];

    const picture = el.closest?.('picture');
    if (picture) {
      for (const source of picture.querySelectorAll('source[srcset]')) {
        const first = source.srcset.split(',')[0].trim().split(/\s+/)[0];
        if (first) urls.push(first);
      }
    }

    if (el.currentSrc) urls.push(el.currentSrc);
    if (el.src && el.src !== el.currentSrc) urls.push(el.src);

    const content = getComputedStyle(el).content;
    const m = content?.match(/url\(["']?(.*?)["']?\)/);
    if (m?.[1]) urls.push(m[1]);

    return [...new Set(urls)];
  }

  async function getImageData(el) {
    const direct = tryCanvasDraw(el);
    if (direct) return wrapFull(direct);

    const urls = collectImageUrls(el);
    const pic = el.closest?.('picture');
    for (const url of urls) {
      showStatus('Fetching image...');
      const fetched = await tryFetchAndDraw(url);
      if (fetched) return wrapFull(fetched);
    }

    showStatus('Capturing visible area...');
    return tryCaptureInPlace(el);
  }

  function tryCanvasDraw(el) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (el.tagName === 'IMG') {
        if (!el.naturalWidth) {
          console.warn('[Loupe] tryCanvasDraw failed due to naturalWidth=0',
            '| src:', el.currentSrc || el.src,
            '| complete:', el.complete);
          return null;
        }
        canvas.width = el.naturalWidth;
        canvas.height = el.naturalHeight;
        ctx.drawImage(el, 0, 0);
      } else if (el.tagName === 'CANVAS') {
        canvas.width = el.width;
        canvas.height = el.height;
        ctx.drawImage(el, 0, 0);
      }

      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
      console.warn('[Loupe] tryCanvasDraw threw:', e.message,
        '| src:', el.currentSrc || el.src,
        '| crossOrigin attr:', el.crossOrigin,
        '| page origin:', location.origin);
      return null;
    }
  }

  async function tryFetchAndDraw(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const bitmapUrl = URL.createObjectURL(blob);
      try {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = bitmapUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      } finally {
        URL.revokeObjectURL(bitmapUrl);
      }
    } catch (e) {
      return null;
    }
  }

  async function tryCaptureInPlace(el) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;

      const dpr = window.devicePixelRatio || 1;
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;

      const visLeft = Math.max(0, rect.left);
      const visTop = Math.max(0, rect.top);
      const visRight = Math.min(vpW, rect.right);
      const visBottom = Math.min(vpH, rect.bottom);
      if (visRight <= visLeft || visBottom <= visTop) return null;

      const response = await chrome.runtime.sendMessage({
        type: 'capture-visible',
        rect: {
          x: Math.round(visLeft * dpr),
          y: Math.round(visTop * dpr),
          w: Math.round((visRight - visLeft) * dpr),
          h: Math.round((visBottom - visTop) * dpr)
        },
        dpr: dpr
      });
      if (!response || response.error) return null;

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = response.dataUrl;
      });

      const r = response.rect;
      const cropX = Math.max(0, r.x);
      const cropY = Math.max(0, r.y);
      const cropW = Math.min(r.w, img.naturalWidth - cropX);
      const cropH = Math.min(r.h, img.naturalHeight - cropY);

      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      const offsetX = (visLeft - rect.left) * dpr;
      const offsetY = (visTop - rect.top) * dpr;
      const fullWidth = rect.width * dpr;
      const fullHeight = rect.height * dpr;

      return {
        pixels: ctx.getImageData(0, 0, cropW, cropH),
        offsetX, offsetY, fullWidth, fullHeight
      };
    } catch (e) {
      return null;
    }
  }

  function showStatus(text) {
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 16px;
        background: rgba(0,0,0,0.8);
        color: #fff;
        font: 14px/1.4 system-ui, sans-serif;
        border-radius: 6px;
        z-index: 2147483647;
        pointer-events: none;
        transition: opacity 0.3s;
      `;
      document.documentElement.appendChild(statusEl);
    }
    statusEl.textContent = text;
    statusEl.style.opacity = '1';
  }

  function hideStatus() {
    if (statusEl) {
      statusEl.style.opacity = '0';
      setTimeout(() => {
        if (statusEl) { statusEl.remove(); statusEl = null; }
      }, 300);
    }
  }

})();
