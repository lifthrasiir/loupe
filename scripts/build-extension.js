#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const defaultDist = path.join(root, 'dist');

const sharedFiles = [
  'LICENSE.txt',
  'README.md',
  'background.js',
  'content.js',
  'extension-api.js',
  'ocr-engine.js',
  'ocr-document.js',
  'offscreen.html',
  'overlay.js',
  'model_manifest.json',
  'det_weights_f16.bin',
  'rec_weights_f16.bin',
  'loupe_icon_16.png',
  'loupe_icon_32.png',
  'loupe_icon_48.png',
  'loupe_icon_128.png'
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function mergeManifest(base, override) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(result[key] || {}), ...value }
      : value;
  }
  return result;
}

function copyFile(relativePath, targetDir) {
  const src = path.join(root, relativePath);
  if (!fs.existsSync(src)) throw new Error(`Missing package file: ${relativePath}`);
  fs.copyFileSync(src, path.join(targetDir, relativePath));
}

function buildBrowser(browser, options = {}) {
  const base = readJson('manifest.json');
  const override = readJson(`manifest.${browser}.json`);
  const manifest = mergeManifest(base, override);
  const dist = options.distDir || defaultDist;
  const targetDir = path.join(dist, browser);

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  for (const file of sharedFiles) copyFile(file, targetDir);
  fs.writeFileSync(
    path.join(targetDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );

  return { browser, targetDir, manifest };
}

function main() {
  fs.mkdirSync(defaultDist, { recursive: true });
  const results = ['chrome', 'firefox'].map((browser) => buildBrowser(browser));
  for (const result of results) {
    console.log(`Built ${result.browser}: ${path.relative(root, result.targetDir)}`);
  }
}

if (require.main === module) main();

module.exports = { buildBrowser, mergeManifest, sharedFiles };
