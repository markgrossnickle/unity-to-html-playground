# coloring-book — tap-to-fill line art

Phaser-based coloring book. Pick a picture, pick a color, tap a region, the
region fills. No backend, no flood-fill at runtime.

## What's built (M1, M2, partial M3)

- **Thirteen pictures** — apple, house, star, cat, fish, hot air balloon,
  cupcake, robot, sailboat, flower, plus three richer showcase subjects
  (wolf, mermaid, unicorn). Each is a pair of PNGs in `assets/`:
  `<slug>_lines.png` (visible outlines) and `<slug>_labels.png` (each region
  painted a flat region-id; never displayed). The first ten are drawn with
  hand-rolled pngjs primitives; the last three are drawn with node-canvas
  for proper bezier curves.
- **Paintable background** — every picture also has a "background" region
  (label id `255`, picked because nothing else uses it) covering the
  negative space outside the line-art. Tapping in the empty area paints
  the background just like any other region. Outline pixels stay as id=0
  so the lines layer (drawn on top) keeps the silhouette crisp against any
  background color.
- **Picture picker** — top-bar button opens a modal grid of thumbnails.
  Auto-fill columns on desktop, 2 columns on phones (≤600 px viewport) so
  the 13-picture catalog stays comfortably tappable.
- **Palette** — 12 swatches in a right-rail (≥44 px tap targets, 3-px white
  selection ring), with a "Recent" row of the last 3 distinct colors used.
- **Tap to fill** — `pointerdown` → label-map sample → `Map<regionId, hex>`
  update → full canvas redraw. Sub-millisecond, no leaks past outlines.
- **Undo / Clear** — undo pops a single fill command; clear wipes the map and
  history.
- **Save / Share** — composites the fill canvas + lines overlay into a PNG at
  the picture's source resolution, then either invokes the Web Share Level 2
  sheet (`navigator.canShare({ files })`) on Android Chrome / iOS Safari 16+
  so the user can post directly to Messages / TikTok, or falls back to an
  anchor-download named `<slug>-<timestamp>.png`. Uncolored regions are
  flattened to white in the export — friendlier for previews than alpha. See
  `src/save.ts`.
- **Mobile layout** — bottom dock at `<600 px` viewport, palette becomes a
  horizontally-scrolling strip. `touch-action: none` on the canvas so taps
  don't get stolen by browser scroll/zoom.

## Importing your own line art

Tap **Import** in the toolbar and pick any image. The parser auto-detects
what kind of source you handed it:

- **Black-on-white line art** (PNG/JPG, photographed coloring-book page,
  scanned drawing) — used verbatim. Threshold + erode + label.
- **Color image** (photo, illustration, AI art, anything) —
  auto-cartoonized into a clean black-on-white outline first, then fed
  through the same labeling pipeline. The cartoonized outline is what gets
  shown to the user as the lines layer; the original color pixels are not
  preserved.

Color detection samples ~10K pixels and looks at how far apart the R/G/B
channels drift. A faintly-yellowed scan of a B&W page reads as B&W; an
illustration with any saturation reads as color. Tunables for the detector
live as `COLOR_TOLERANCE` / `COLOR_FRACTION` constants in
`src/importParser.ts`.

The browser parser runs the same labeling pipeline as the Node-side
`scripts/parse-line-art.mjs`:

1. Downscale to ≤2400 px on the long edge so parsing fits in ~3s on
   mid-range mobile.
2. *(Color input only)* Cartoonize: Gaussian blur → Sobel gradient →
   threshold → optional 1-pass thinning. See `src/cartoonize.ts`. Tunables
   (`blurSigma`, `edgeThreshold`, `thinIterations`) live as defaults at the
   top of that file — a future agent can expose them as UI sliders without
   changing the algorithm.
3. Grayscale → threshold (default 128).
4. One erode pass to absorb antialiased outline edges.
5. Iterative stack-based 4-connected flood-fill to label every fillable
   region.
6. Drop regions smaller than 50 px (folded back into the outline so the
   lines layer covers them).
7. Pick the largest border-touching region as background (region id 255).
8. Emit lines / labels canvases in the same RGBA format as the built-ins.

Imported pictures appear in the picker grid alongside the built-ins with
an **Imported** badge and a small **×** delete button. They're saved to
`localStorage` under `coloringbook_imported_v1` (cap of 20, FIFO eviction)
so they survive page refreshes. If `localStorage` fills up the import
fails with a friendly message — remove an imported picture and try again.

The parser is `src/importParser.ts`; the cartoonize pass is
`src/cartoonize.ts`; the storage layer is in `src/pictures.ts`. Parsing is
plain JS on the main thread (no Workers, no WASM, no extra deps) — for the
target source sizes the difference isn't worth the complexity.

## How the fill works

We picked the **hybrid label-map** approach (PLAN.md §2.2 "C") over the obvious
flood-fill option for one reason: correctness without effort. Every picture
ships two PNGs:

- `*_lines.png` — black outlines on transparent background. Drawn on top of
  everything; this is what you see.
- `*_labels.png` — each colorable region painted a unique flat RGB id (region
  id in the R channel, alpha = 255 inside, alpha = 0 outside). No
  antialiasing, so a single pixel maps to exactly one region.

At runtime:

1. The labels PNG is decoded once into an off-screen `ImageData`.
2. On `pointerdown`, sample the label image at the tap pixel → region id.
3. Update `Map<regionId, hex>`.
4. Redraw the off-screen fill canvas: walk every pixel, paint with the color
   for its region (or transparent if the region hasn't been colored yet).
5. The Phaser `CanvasTexture` refreshes; the lines PNG sits on top.

Why not flood-fill? Antialiased outlines leak; large fills add latency; undo
needs canvas snapshots. Label-map is O(1) tap, O(W·H) redraw, trivially
undoable. Tradeoff is the second PNG per picture (~3 KB at 512²) and the need
for an authoring step that paints regions with flat ids.

See `src/LabelMap.ts` and `src/FillRenderer.ts` for the load + render code.

## Regenerating the sample assets

```sh
npm run gen-coloring-assets
```

This runs `scripts/generate-coloring-assets.mjs`. The first ten pictures
are drawn with hand-rolled pngjs primitives; the wolf, mermaid, and unicorn
use node-canvas for proper bezier curves. After rendering, every picture
is run through one extra pass that tags every pixel that's NOT inside any
hand-drawn region AND NOT under an outline pixel as the background region
(label id `255`). Both PNGs in each pair are deterministic, so re-running
the script over a clean checkout produces a no-op git diff.

### Overlapping shapes → distinct sub-regions

The generator builds the label map by giving each *source shape* a unique
bit index (0..29) and ORing that bit into a 32-bit-per-pixel buffer. After
all shapes are drawn it walks the buffer, collects every distinct non-zero
bitmask, and assigns each one a sequential region id. So when two shapes
overlap, the overlap zone is its OWN region — a flower with overlapping
petals has lens-shaped sub-regions you can fill independently, fish scales
get crescent intersections between adjacent circles, and so on. Subjects
whose shapes happen not to overlap (e.g. star, house, robot) come out
byte-identical to the pre-bitmask output. See the header comment in
`scripts/generate-coloring-assets.mjs` for the full mechanism.

## Layout

```
examples/coloring-book/
├── index.html              page shell (top bar, game div, palette, picker modal)
├── main.ts                 boots Phaser + DOM controllers
├── style.css               example-local CSS
├── README.md               you are here
├── assets/                 generated by scripts/generate-coloring-assets.mjs
│   ├── apple_lines.png    + apple_labels.png
│   ├── house_lines.png    + house_labels.png
│   ├── star_lines.png     + star_labels.png
│   ├── cat_lines.png      + cat_labels.png
│   ├── fish_lines.png     + fish_labels.png
│   ├── balloon_lines.png  + balloon_labels.png
│   ├── cupcake_lines.png  + cupcake_labels.png
│   ├── robot_lines.png    + robot_labels.png
│   ├── sailboat_lines.png + sailboat_labels.png
│   ├── flower_lines.png   + flower_labels.png
│   ├── wolf_lines.png     + wolf_labels.png
│   ├── mermaid_lines.png  + mermaid_labels.png
│   └── unicorn_lines.png  + unicorn_labels.png
└── src/
    ├── ColoringScene.ts   Phaser scene: layout, pointer, redraw
    ├── LabelMap.ts        labels-PNG → ImageData decoder + sampler
    ├── FillRenderer.ts    off-screen canvas writer (per-pixel pass)
    ├── pictures.ts        catalog of built-ins + localStorage-backed imports
    ├── importParser.ts    in-browser port of scripts/parse-line-art.mjs
    ├── cartoonize.ts      color → B&W outline pre-pass for color imports
    ├── state.ts           selectedColor, fillMap, history, recentColors
    ├── events.ts          typed pub/sub between DOM controllers and the scene
    ├── palette.ts         right-rail swatches + recent row
    ├── picker.ts          modal grid of thumbnails (built-in + imported)
    ├── toolbar.ts         undo/clear/save + import button wiring
    ├── save.ts            composite-to-PNG + share-or-download
    └── color.ts           hex → RGB
```

## Left for future milestones

PLAN.md sketches M3 / M4 — these are intentionally not built here:

- **Save / share / export** ✓ — see `src/save.ts`. M3 partial: PNG export +
  Web Share / download is shipped. Persistent gallery (saved finished pieces
  with thumbnails) is still deferred.
- **Persistence** — autosave each picture's fill map to `localStorage` so
  reload restores progress. *Deferred.*
- **Pinch zoom + pan** — `phaser3-rex-plugins` gestures, with pan bounds and
  tap-to-fill still working at any zoom level. *Deferred.*
- **Preprocessing pipeline for arbitrary artist line-art** — binarize
  outlines, dilate to seal hairline gaps, span-fill every white region into
  a shared label buffer. The current generator hand-authors regions with
  flat-color primitives; arbitrary PNGs need the full preprocessor.
- **Eyedropper / custom color picker** — for users who want a color outside
  the 12-swatch default.

The label-map architecture in `src/` carries forward without changes — every
M3/M4 feature is additive.
