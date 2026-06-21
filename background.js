'use strict';

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'run-ocr') {
    chrome.tabs.sendMessage(tab.id, { type: 'run-ocr' });
  }
});

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_SCRAPING'],
    justification: 'Required for working around same-origin policy when fetching images and performing OCR.'
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return false;

  if (msg.type === 'fetch-image') {
    fetchImage(msg.url, msg.pageUrl).then(sendResponse);
    return true;
  }

  if (msg.type === 'capture-visible') {
    captureVisible(sender.tab.id, msg.rect, msg.dpr).then(sendResponse);
    return true;
  }

  if (msg.type === 'ocr-process') {
    (async () => {
      try {
        await ensureOffscreen();
        const result = await chrome.runtime.sendMessage({
          ...msg,
          target: 'offscreen'
        });
        sendResponse(result);
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});

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
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
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
