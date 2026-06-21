'use strict';

(function () {

let anchorCounter = 0;
let currentOverlay = null;
let currentAnchorTarget = null;

function createOverlayElement(targetEl, regions, clusters, naturalWidth, naturalHeight) {
  const anchorId = `--loupe-${anchorCounter++}`;
  targetEl.style.anchorName = anchorId;

  const host = document.createElement('div');
  host.setAttribute('data-loupe-overlay', '');
  host.style.cssText = `
    position: fixed;
    position-anchor: ${anchorId};
    top: anchor(top);
    left: anchor(left);
    width: anchor-size(width);
    height: anchor-size(height);
    pointer-events: none;
    z-index: 2147483647;
    margin: 0; padding: 0; border: 0;
    display: block;
  `;

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { display: block; }
    .container {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .region-bg, .region {
      position: absolute;
      box-sizing: border-box;
      transition: opacity 0.15s ease;
    }
    .region-bg {
      pointer-events: none;
    }
    .region {
      z-index: 1;
      pointer-events: auto;
      cursor: text;
      overflow: hidden;
      line-height: 1;
      font-family: "Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic", "Meiryo",
                   "Microsoft YaHei", "PingFang SC", "Source Han Sans",
                   sans-serif;
    }
    .region:hover,
    .region:hover + .region-bg {
      opacity: 0.05;
      transition-delay: 0.4s;
    }
    .region.has-selection:hover,
    .region.has-selection:hover + .region-bg,
    .region.selecting,
    .region.selecting + .region-bg {
      opacity: 1;
      transition: none;
    }
    .region.vertical {
      writing-mode: vertical-rl;
      text-orientation: upright;
    }
    .text-fit {
      position: absolute;
      left: 50%;
      top: 50%;
      transform-origin: center center;
      width: max-content;
      height: max-content;
      white-space: nowrap;
      visibility: hidden;
    }
    .region.vertical .text-fit {
      white-space: normal;
      writing-mode: vertical-rl;
      text-orientation: upright;
    }
    .text-fit.fitted {
      visibility: visible;
    }
  `;

  const container = document.createElement('div');
  container.className = 'container';

  for (let ci = 0; ci < clusters.length; ci++) {
    if (ci > 0) host.appendChild(document.createElement('hr'));

    const group = clusters[ci];
    for (const ri of group) {
      const r = regions[ri];
      const pts = r.bbox.points;
      const isVertical = r._isVertical;

      const edgeW = Math.sqrt(
        (pts[1][0] - pts[0][0]) ** 2 + (pts[1][1] - pts[0][1]) ** 2
      );
      const edgeH = Math.sqrt(
        (pts[3][0] - pts[0][0]) ** 2 + (pts[3][1] - pts[0][1]) ** 2
      );
      const angle = Math.atan2(
        pts[1][1] - pts[0][1],
        pts[1][0] - pts[0][0]
      );
      const cx = (pts[0][0] + pts[2][0]) / 2;
      const cy = (pts[0][1] + pts[2][1]) / 2;

      const leftPct = (cx / naturalWidth) * 100;
      const topPct = (cy / naturalHeight) * 100;
      const wPct = (edgeW / naturalWidth) * 100;
      const hPct = (edgeH / naturalHeight) * 100;

      const bg = r._bgColor || 'rgba(255,255,255,0.85)';
      const fg = r._fgColor || '#000';

      const posStyle = `
        left: ${leftPct}%;
        top: ${topPct}%;
        width: ${wPct}%;
        height: ${hPct}%;
        transform: translate(-50%, -50%) rotate(${angle}rad);
      `;

      const fgDiv = document.createElement('div');
      fgDiv.className = 'region' + (isVertical ? ' vertical' : '');
      fgDiv.style.cssText = posStyle + `color: ${fg}; font-size: 64px;`;

      const slotName = `r-${ri}`;
      const wrapper = document.createElement('div');
      wrapper.className = 'text-fit';
      const slot = document.createElement('slot');
      slot.name = slotName;
      wrapper.appendChild(slot);
      fgDiv.appendChild(wrapper);
      container.appendChild(fgDiv);

      const bgDiv = document.createElement('div');
      bgDiv.className = 'region-bg';
      bgDiv.style.cssText = posStyle + `background: ${bg};`;
      container.appendChild(bgDiv);

      const span = document.createElement('span');
      span.slot = slotName;
      span.textContent = r.text;
      span.lang = r._lang || 'ja';
      host.appendChild(span);
    }
  }

  shadow.appendChild(style);
  shadow.appendChild(container);

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const allRegions = container.querySelectorAll('.region');
    for (const r of allRegions) r.classList.add('selecting');

    const prevUserSelect = document.documentElement.style.userSelect;
    document.documentElement.style.userSelect = 'none';
    host.style.userSelect = 'text';

    function endSelect() {
      document.removeEventListener('mouseup', endSelect);
      for (const r of allRegions) r.classList.remove('selecting');
      document.documentElement.style.userSelect = prevUserSelect;
      host.style.userSelect = '';
    }
    document.addEventListener('mouseup', endSelect);
  });

  function onSelectionChange() {
    const sel = document.getSelection();
    const allRegions = container.querySelectorAll('.region');
    for (const r of allRegions) r.classList.remove('has-selection');

    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

    for (const span of host.querySelectorAll('span[slot]')) {
      if (!sel.containsNode(span, true)) continue;
      const slotEl = shadow.querySelector(`slot[name="${span.slot}"]`);
      const region = slotEl?.closest('.region');
      if (region) region.classList.add('has-selection');
    }
  }
  document.addEventListener('selectionchange', onSelectionChange);
  host._selectionChangeHandler = onSelectionChange;

  return { host, anchorId };
}

function fitText(shadowRoot) {
  const regions = shadowRoot.querySelectorAll('.region');
  for (const region of regions) {
    const wrapper = region.querySelector('.text-fit');
    if (!wrapper) continue;

    const boxW = region.clientWidth;
    const boxH = region.clientHeight;
    if (boxW < 1 || boxH < 1) return false;

    wrapper.style.transform = '';
    const textW = wrapper.offsetWidth;
    const textH = wrapper.offsetHeight;
    if (textW < 1 || textH < 1) continue;

    const sx = boxW / textW;
    const sy = boxH / textH;

    wrapper.style.transform = `translate(-50%, -50%) scale(${sx}, ${sy})`;
    wrapper.classList.add('fitted');
  }
  return true;
}

function extractColors(pixelData, imgW, imgH, box) {
  const pts = box;
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const x0 = Math.max(0, Math.min(...xs));
  const y0 = Math.max(0, Math.min(...ys));
  const x1 = Math.min(imgW - 1, Math.max(...xs));
  const y1 = Math.min(imgH - 1, Math.max(...ys));

  const w = Math.round(x1 - x0);
  const h = Math.round(y1 - y0);
  if (w < 2 || h < 2) return { bg: [255, 255, 255], fg: [0, 0, 0] };

  const hist = new Uint32Array(256);
  const iy0 = Math.round(y0), iy1 = Math.round(y1);
  const ix0 = Math.round(x0), ix1 = Math.round(x1);
  const totalPixels = (iy1 - iy0 + 1) * (ix1 - ix0 + 1);

  for (let y = iy0; y <= iy1; y++) {
    for (let x = ix0; x <= ix1; x++) {
      const idx = (y * imgW + x) * 4;
      const lum = (pixelData[idx] * 77 + pixelData[idx + 1] * 150 + pixelData[idx + 2] * 29) >> 8;
      hist[lum]++;
    }
  }

  let bestThresh = 0, bestVar = 0;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let wB = 0, sumB = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = totalPixels - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > bestVar) {
      bestVar = variance;
      bestThresh = t;
    }
  }

  let loR = 0, loG = 0, loB = 0, loN = 0;
  let hiR = 0, hiG = 0, hiB = 0, hiN = 0;

  for (let y = iy0; y <= iy1; y++) {
    for (let x = ix0; x <= ix1; x++) {
      const idx = (y * imgW + x) * 4;
      const r = pixelData[idx], g = pixelData[idx + 1], b = pixelData[idx + 2];
      const lum = (r * 77 + g * 150 + b * 29) >> 8;
      if (lum <= bestThresh) {
        loR += r; loG += g; loB += b; loN++;
      } else {
        hiR += r; hiG += g; hiB += b; hiN++;
      }
    }
  }

  const lo = loN > 0 ? [Math.round(loR / loN), Math.round(loG / loN), Math.round(loB / loN)] : [0, 0, 0];
  const hi = hiN > 0 ? [Math.round(hiR / hiN), Math.round(hiG / hiN), Math.round(hiB / hiN)] : [255, 255, 255];

  const bg = hiN >= loN ? hi : lo;
  const fg = hiN >= loN ? lo : hi;

  return { bg, fg };
}

function detectVertical(box) {
  const pts = box;
  const edgeW = Math.sqrt((pts[1][0] - pts[0][0]) ** 2 + (pts[1][1] - pts[0][1]) ** 2);
  const edgeH = Math.sqrt((pts[3][0] - pts[0][0]) ** 2 + (pts[3][1] - pts[0][1]) ** 2);
  return edgeH > edgeW * 1.5;
}

function regionMetrics(region) {
  const pts = region.bbox.points;
  const cx = (pts[0][0] + pts[2][0]) / 2;
  const cy = (pts[0][1] + pts[2][1]) / 2;
  const edgeW = Math.sqrt((pts[1][0] - pts[0][0]) ** 2 + (pts[1][1] - pts[0][1]) ** 2);
  const edgeH = Math.sqrt((pts[3][0] - pts[0][0]) ** 2 + (pts[3][1] - pts[0][1]) ** 2);
  return { cx, cy, w: edgeW, h: edgeH };
}

function clusterRegions(regions) {
  const n = regions.length;
  if (n === 0) return [];

  const metrics = regions.map(r => regionMetrics(r));
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(a, b) { parent[find(a)] = find(b); }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (regions[i]._isVertical !== regions[j]._isVertical) continue;

      const a = metrics[i], b = metrics[j];
      const isVert = regions[i]._isVertical;

      if (isVert) {
        const charW = Math.min(a.w, b.w);
        const overlapTop = Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
        const overlapBot = Math.min(a.cy + a.h / 2, b.cy + b.h / 2);
        const yOverlap = overlapBot - overlapTop;
        const xGap = Math.abs(a.cx - b.cx) - (a.w + b.w) / 2;
        if (yOverlap > 0 && xGap < charW * 1.5) union(i, j);
      } else {
        const charH = Math.min(a.h, b.h);
        const overlapLeft = Math.max(a.cx - a.w / 2, b.cx - b.w / 2);
        const overlapRight = Math.min(a.cx + a.w / 2, b.cx + b.w / 2);
        const xOverlap = overlapRight - overlapLeft;
        const yGap = Math.abs(a.cy - b.cy) - (a.h + b.h) / 2;
        if (xOverlap > 0 && yGap < charH * 1.5) union(i, j);
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  for (const indices of groups.values()) {
    const isVert = regions[indices[0]]._isVertical;
    indices.sort((a, b) => {
      const ma = metrics[a], mb = metrics[b];
      if (isVert) {
        const charW = Math.min(ma.w, mb.w);
        if (Math.abs(ma.cx - mb.cx) < charW * 0.5) return ma.cy - mb.cy;
        return mb.cx - ma.cx;
      } else {
        const charH = Math.min(ma.h, mb.h);
        if (Math.abs(ma.cy - mb.cy) < charH * 0.5) return ma.cx - mb.cx;
        return ma.cy - mb.cy;
      }
    });
  }

  return Array.from(groups.values());
}

function annotateRegions(regions, pixelData) {
  const pw = pixelData.width;
  const ph = pixelData.height;
  for (const r of regions) {
    const { bg, fg } = extractColors(pixelData.data, pw, ph, r.bbox.points);
    r._bgColor = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    r._fgColor = `rgb(${fg[0]},${fg[1]},${fg[2]})`;
    r._isVertical = detectVertical(r.bbox.points);
  }
}

function createOverlay(targetEl, regions, naturalWidth, naturalHeight, pixelData) {
  removeOverlay();

  annotateRegions(regions, pixelData);
  const clusters = clusterRegions(regions);

  const { host, anchorId } = createOverlayElement(
    targetEl, regions, clusters, naturalWidth, naturalHeight
  );
  document.documentElement.appendChild(host);

  currentOverlay = host;
  currentAnchorTarget = targetEl;

  const container = host.shadowRoot.querySelector('.container');
  const ro = new ResizeObserver(() => {
    if (fitText(host.shadowRoot)) {
      ro.disconnect();
    }
  });
  ro.observe(container);

  const mo = new MutationObserver(() => fitText(host.shadowRoot));
  mo.observe(host, {
    childList: true,
    subtree: true,
    characterData: true
  });
  host._mutationObserver = mo;

  return host;
}

function removeOverlay() {
  if (currentOverlay) {
    if (currentOverlay._mutationObserver) {
      currentOverlay._mutationObserver.disconnect();
    }
    if (currentOverlay._selectionChangeHandler) {
      document.removeEventListener('selectionchange', currentOverlay._selectionChangeHandler);
    }
    currentOverlay.remove();
    currentOverlay = null;
  }
  if (currentAnchorTarget) {
    currentAnchorTarget.style.anchorName = '';
    currentAnchorTarget = null;
  }
}

window.LoupeOverlay = { createOverlay, removeOverlay };

})();
