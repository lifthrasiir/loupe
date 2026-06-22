# Firefox Testing Guide

Loupe ships separate generated extension directories for Chrome and Firefox from the same source tree.

## Build

Run the package build to create browser-specific extension directories:

```bash
npm run build
```

Generated outputs:

- `dist/chrome/` — Chrome Manifest V3 build using `background.service_worker` and Chrome offscreen documents.
- `dist/firefox/` — Firefox Manifest V3 build using `background.scripts` and a document-backed OCR host.

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on…**.
3. Choose `dist/firefox/manifest.json`.
4. Confirm the extension loads without unsupported-permission or unsupported-key errors.

## Manual smoke checklist

Use pages with visible image and canvas targets, then hover the target and press **Ctrl+Shift+E** or **Cmd+Shift+E** on macOS.

- Same-origin image: OCR runs and selectable text appears over the image.
- Cross-origin image: direct canvas access may fail, but fetch or capture fallback still produces OCR when browser permissions allow it.
- Canvas element: OCR runs against canvas pixels when the canvas is readable.
- Visible capture fallback: when image fetch paths fail and the element is visible, Loupe crops the visible tab capture and aligns the overlay to the visible portion.
- Vertical text: vertical CJK text remains selectable and oriented vertically.
- Overlay alignment: overlay stays aligned after initial render, page scroll, viewport resize, and text selection.
- WebGL2 failure path: on a browser/profile without required WebGL2 support, Loupe shows a user-visible error instead of hanging.

## Privacy note

Loupe performs OCR locally in the browser. The Firefox manifest declares `data_collection_permissions.required: ["none"]`; do not add external telemetry or network OCR calls without revisiting that declaration.
