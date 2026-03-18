# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

This is a vanilla HTML/CSS/JS app with no build step. Open `index.html` directly in a browser or serve it with any static file server:

```
npx serve .
# or
python3 -m http.server
```

## Architecture

Single-page image annotation tool. All logic lives in three files:

- **`index.html`** — Static markup. Two main states: `#dropzone` (empty state) and `#canvas-wrapper` (image loaded). Floating UI elements (logo, actions, crop bar, zoom controls, toolbar) are positioned fixed over the workspace.
- **`app.js`** — All application logic. One global `state` object holds the entire app state (image, annotations, history, zoom, active tool, drag/resize state). `renderCanvas()` is the single render function called after any state change.
- **`styles.css`** — CSS custom properties defined in `:root`. No utility framework.

### Annotation system

Annotations are plain objects stored in `state.annotations[]`. Types: `rect`, `arrow`, `blur`.

- **Blur** is implemented via pixelation (downscale then upscale with `imageSmoothingEnabled = false`), not CSS filter.
- **Undo/redo** snapshots the full `annotations` array via `snapshotAnnotations()` before each mutation.
- **Export** always renders with `radius=8` regardless of the current preview setting (`getExportCanvas()`).

### Coordinate system

Canvas has full internal resolution (`canvas.width/height` = artboard pixels). Zoom is applied only via `canvas.style.width/height`. Mouse coordinates are converted from CSS pixels to canvas pixels in `getCanvasPos()` using `getBoundingClientRect()` + scale factor.

### Callout Builder

Floating panel (`#callout-builder`) toggled via the Message button in the toolbar or the `M` key. Not a canvas tool — it generates HTML snippets for the support center article editor.

- **`TYPES`** object in `setupCalloutBuilder()` defines the three callout types (Note, Tip, Warning) with their `color`, `svgInner` (preview icon), `exportChar` (text character used in the exported HTML), and `iconStyle` (inline CSS for the icon span).
- **`buildPreviewHTML`** renders a live preview inside the panel using SVG icons and `t.color`.
- **`buildExportHTML`** generates the clipboard-ready HTML: full inline styles (no external CSS dependency) + HTML comments marking the block start/end for editorial identification.
- The keydown handler guards against shortcuts firing while typing in the textarea (`e.target.tagName === 'TEXTAREA'`).

### Keyboard shortcuts

`V` select · `R` rect · `A` arrow · `B` blur · `C` crop · `M` message/callout · `Ctrl+Z` undo · `Ctrl+Shift+Z` / `Ctrl+Y` redo · `+/-/0` zoom · `Delete/Backspace` delete selected · `Enter` confirm crop · `Escape` cancel crop

## Available skills

Two skills are installed in `.agents/skills/` and symlinked to Claude Code:

- **`/agentation`** — installs the Agentation annotation toolbar (React/Next.js only — not applicable to this vanilla app).
- **`/agentation-self-driving`** — autonomous design critique mode: opens a headed browser, navigates the running app, and places design annotations via the Agentation toolbar. Requires `agent-browser` to be available and the app to be served locally first (`npx serve .`). Use when asked to "critique the UI", "review the design", or "self-driving mode".
