# 🔍 Loupe

A browser extension that performs OCR on images and canvases directly in the browser. Hover over any image or canvas element, press the shortcut key, and Loupe overlays selectable, copyable text on top of the original element.

All inference runs **locally in your browser** using WebGL2. It is also friendly to in-place translators like Chrome Element Translate since it doesn't modify the original DOM.

## Features

- **In-page OCR** — Detects and recognizes text in `<img>` and `<canvas>` elements.
- **Fast** — Typical images are processed in under 2–3 seconds on consumer hardware.
- **Text overlay** — Recognized text is rendered as a selectable overlay anchored to the original element, so you can select and copy text from images.
- **Horizontal and vertical text** — Supports both horizontal and vertical (CJK) text layouts.
- **Cross-origin handling** — Falls back to background fetch or visible-tab capture when direct canvas access is blocked by CORS.
- **Minimal interference** — Overlay doesn't modify the original DOM structure, making it compatible with other extensions that manipulate page content.
- **Fully offline** — Models are bundled with the extension; no network requests after installation.

## Usage

1. Build the browser-specific extension directories with `npm run build`.
2. Load `dist/chrome/` in Chrome or `dist/firefox/manifest.json` from Firefox `about:debugging`.
3. Hover over an image or canvas on any page.
4. Press **Ctrl+Shift+E** (or **Cmd+Shift+E** on macOS).
5. Recognized text appears as a selectable overlay. Select and copy as you would with normal text.
6. Press the shortcut again on another element to dismiss the current overlay and start a new one.

## Requirements

- Google Chrome or a Chromium-based browser with Manifest V3 support.
- Firefox with Manifest V3 extension support. Use the generated `dist/firefox/` package rather than the Chrome package.
- WebGL2 with the `EXT_color_buffer_float` extension.

## Development

- `npm run build` creates `dist/chrome/` and `dist/firefox/`.
- `npm test` runs manifest, adapter, OCR host, overlay positioning, and package-content tests.
- See [docs/firefox-testing.md](docs/firefox-testing.md) for the Firefox manual smoke checklist.

## License

Licensed under the [Apache License 2.0](LICENSE.txt).

This project includes model weights from [PP-OCRv6](https://github.com/PaddlePaddle/PaddleOCR), which is also licensed under the Apache License 2.0.
