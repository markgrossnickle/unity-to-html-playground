# Tap-to-Color: Phaser 3 Coloring Book — Design & Implementation Plan

> **Working directory:** `unity-to-html-playground/html/`
> **Status:** design / pre-build
> **Author:** engineering
> **Last updated:** 2026-05-08

A web-based coloring book. Pick a line-art picture, pick a color, tap a region, the region fills. Repeat. Save, share, clear. Mobile-first; works on desktop. Single-player, no backend.

This plan is opinionated. Every fork has a recommendation. The goal is to ship M1 in days, not weeks, while keeping a path to a polished M4.

---

## 1. Tech stack

### 1.1 Engine: **Phaser 3.90.0 "Tsugumi"** (latest stable as of May 2025)

We use Phaser 3, not Phaser 4, even though Phaser 4 exists. Reasons:

- Phaser 3 has years of community plugins (rex-plugins, gesture libs, asset loaders) that we will lean on for pinch/zoom and UI. Phaser 4's ecosystem is still catching up.
- Phaser 3.90 is stable, well-documented, and ships an actively maintained `CanvasTexture` API which is exactly what a paint-bucket needs (more on this in §3).
- The official `template-vite-ts` repo targets Phaser 3 and is the best on-ramp.

We pin `phaser@^3.90.0`. We do not chase 3.9x point releases mid-milestone.

**What Phaser actually buys us here.** This game is closer to a UI app than an action game, so the question is fair. Phaser still earns its keep:

- `CanvasTexture` — wraps a `<canvas>` we can write pixels to and bind as a texture. This is the heart of the bitmap path (§3.1).
- Input system with `pointerdown` and accurate world-coordinate translation across DPR and camera zoom — saves us from rolling our own.
- Camera with built-in zoom/pan — cheap pinch-to-zoom (§9).
- Scene/state management — picture picker, canvas scene, share modal as separate scenes.
- Asset loader with progress events — needed for M2+ when we ship many pictures.

If we did not use Phaser, we would re-invent these. We do **not** use Phaser for the right-rail palette UI — that's HTML/DOM (§5).

### 1.2 Bundler: **Vite**

Decision matrix:

| Option   | Cold dev | HMR  | Config burden | Recommended? |
| -------- | -------- | ---- | ------------- | ------------ |
| Vite     | <1s      | ~50ms | minimal      | **yes**      |
| Webpack  | 3–10s    | ~500ms | high        | no           |
| Parcel   | ~1s      | fast | minimal       | viable but smaller community for game tooling |
| esbuild only | <1s | manual reload | very minimal | only for prototypes |
| No bundler | n/a    | n/a  | n/a           | rejected — we want TS + module imports + asset hashing |

The official Phaser starter (`phaserjs/template-vite-ts`) is Vite + TS. We start from it.

### 1.3 Language: **TypeScript**

A coloring book has well-shaped state — `RegionId`, `RegionColor`, `Palette`, `Picture` — and a worker boundary that benefits from typed messages. The cost of TS in a Vite project is essentially zero. JS-only is rejected.

Style: strict mode on (`"strict": true`), `noUncheckedIndexedAccess` on (we'll be indexing into `Uint8ClampedArray` a lot — bounds bugs are easy).

### 1.4 Deployment: **static site to GitHub Pages**, with itch.io as a publishing target

- Output is `dist/` — pure static `index.html` + JS + asset bundle. No SSR, no server.
- Primary host: **GitHub Pages** off the `main` branch's `gh-pages` artifact. Free, zero infra, custom domain optional.
- Secondary distribution: **itch.io HTML5 game** upload. itch.io accepts a zipped `dist/`. Useful for discoverability and a real "play in browser" iframe.
- **Roblox is rejected.** Roblox uses Lua and its own engine. Phaser 3 / HTML5 cannot deploy there. If "Roblox-style distribution" matters later, that is a separate, non-Phaser project.
- We do **not** build a native shell (Capacitor, Electron). Web is the only target. If we want "install to home screen" feel, we add a PWA manifest in M4 — that is a 30-line add, not a new platform.

### 1.5 Other libraries (small, scoped)

- `phaser3-rex-plugins` — pinch/pan gestures (§9). We pull only the gesture sub-modules, not the whole bundle.
- No state library. Game state lives in a single `GameState` object in the root scene; mutations go through small command functions. Redux/MobX is overkill for one tab of state.
- No CSS framework. The right-rail palette is small enough for hand-written CSS. Tailwind would be more setup than savings.
- Testing: `vitest` for unit tests on the flood-fill / preprocessing code (§3). No e2e — manual smoke testing on a real phone is more valuable for this game class.

---

## 2. Asset pipeline for line-art images

This is the most important architectural decision in the project. The choice here defines the rendering path, the worker, the undo system, and the authoring workflow.

### 2.1 The three approaches

#### A. Single-bitmap with runtime flood fill

Each picture is one transparent PNG: black outlines on transparent (or white) background. On tap, we read pixel data, run a flood fill from the tap point, and write the new color back.

| | |
| - | - |
| Authoring | trivial — just draw outlines |
| Quality | poor — antialiased outline edges leak fill color, halos appear |
| Runtime cost | high on large fills (queue of thousands of pixels) |
| Memory | low — one PNG per picture |
| Scaling | bitmap pixels — looks soft when zoomed |
| Undo cost | must snapshot the canvas (or a region's bounding box) |

#### B. Pre-segmented vector regions (SVG)

Each picture is an SVG with one `<path>` per fillable region. Tap → DOM hit-test → set `fill` attribute. Outlines are a separate path drawn on top.

| | |
| - | - |
| Authoring | high — every region must be traced as its own path; complex pictures become a chore |
| Quality | excellent — crisp outlines, instant fill, perfect antialiasing |
| Runtime cost | trivial — change one attribute |
| Memory | moderate (SVG can be large) |
| Scaling | infinite — vector |
| Undo cost | trivial — single attribute mutation |

#### C. Hybrid: outline PNG + indexed label-map PNG

One PNG holds the black outlines. A second image (or buffer) holds a **label map** where each pixel's value is a region ID. On tap, we look up the region ID under the tap point, then composite the chosen color into a per-region mask.

| | |
| - | - |
| Authoring | low–medium — draw outlines, run a one-time preprocessor that flood-fills every white region into a label map |
| Quality | excellent — outlines are pristine PNG, fills are clean because they're masked, not bitmap-flooded |
| Runtime cost | minimal at fill time — `globalCompositeOperation = 'source-in'` + `fillRect` is O(W×H) of the region's bounding box and feels instant |
| Memory | moderate — need outline PNG + label data; with up to 255 regions per picture we can pack labels into a single alpha channel |
| Scaling | bitmap, but the outline PNG is the only thing eyes are critical of and we ship at 2× DPR |
| Undo cost | trivial — a `regionId → color` map |

### 2.2 Recommendation: **C, the hybrid label-map approach**

This is what well-known apps in the genre (Colorfy, Happy Color) effectively do under the hood. The pattern is well-described in Shane O'Sullivan's "Instant colour fill with HTML Canvas" (2023): preprocess the line art in a Web Worker, flood-fill every connected white region in the source image, and assign each region a unique ID stored in the alpha channel. At runtime, taps become an O(1) lookup, and fills become a single `globalCompositeOperation` paint.

Why this beats A:

- No antialias halo. We never run flood fill at runtime against an antialiased outline. The label map is computed once, offline (or in a worker on first load), with whatever tolerance + erosion knobs we want — the *runtime* path is mask-paint, not pixel-walk.
- Predictable, instant feel. No "watch the fill spread."
- Cheap undo: `regionId → previousColor`.

Why this beats B:

- Authoring is a single layered PNG (or even a flat PNG of outlines). Artists don't have to vectorize every region. We can take any well-formed line art and run it through the preprocessor.
- Ships smaller than a multi-path SVG for complex pictures (mandalas, animals with detail).
- Renders the outline as the artist drew it, including subtle line-weight variation, which a path stroke can lose.

When B would win: a very small, hand-crafted catalog (~20 pictures) with a pro illustrator who already works in vector. Not our world. We want to be able to drop in 100+ images.

### 2.3 Author / source workflow

1. **Source.** PNG, transparent background, **pure black** outlines on **pure white** interior. 2048×2048 max, will downsample to 1024×1024 for runtime. Outlines should be solid (not dashed) and closed (no gaps a flood fill could escape through). License-clean sources only — public domain, CC0, or commissioned.
2. **Lint.** A `tools/lint-lineart.ts` script (Node, runs in CI) checks: image is RGBA, all non-transparent non-near-white pixels are near-black (we'll define a tolerance), every connected white region is large enough (≥200 px²), no fewer than 4 and no more than 220 distinct regions (we reserve 0 = background, 255 = outline; 1–254 = regions).
3. **Preprocess.** A `tools/preprocess.ts` script generates, per picture:
   - `outline.png` — the original line art, with outlines forced to either pure black or transparent (no soft AA), light dilation by 1 px to seal hairline gaps.
   - `labels.bin` — a packed `Uint8Array` of size W×H, one byte per pixel, region ID. Gzipped this is small (regions are large flat areas, gzip eats them).
   - `meta.json` — `{ width, height, regions: [{ id, bbox: [x,y,w,h], pixelCount }] }`. The `bbox` is what M4 zoom-to-region uses.
4. **Cache.** All three files live alongside their source PNG in `assets/pictures/<slug>/`. Source PNG is checked in for re-preprocessing; the generated outputs are also checked in (so we don't run the worker on every cold load).
5. **Online fallback.** If the user uploads their own line art (M4+ feature), the worker runs at load time. Average preprocessing for 1024² is well under 2 seconds based on Shane O'Sullivan's report.

### 2.4 Preprocessor details

The preprocessor is a span-fill (§3.2) with these knobs:

- **Outline binarization.** Any pixel where `R+G+B < threshold && alpha > 128` becomes pure black; everything else is the white interior. This kills antialiasing on the outline before we look for regions.
- **Outline dilation.** A 1-pixel morphological dilation seals subpixel gaps where two outline strokes nearly-but-not-quite meet. We tune this per art style. Too much dilation eats thin features.
- **Region sweep.** Iterate every pixel; if it's a non-outline pixel with no label assigned, span-fill from there with a fresh region ID. Skip regions with `pixelCount < MIN_REGION_PIXELS` (assign them to a "skip" label so they're not tappable but don't get filled either).
- **Output.** `labels.bin` (W×H bytes), `meta.json`.

The preprocessor lives in `tools/` and runs under Node + `pngjs`. The same code can run in a Web Worker for user-uploaded images — we share the source between Node and worker entry points.

---

## 3. Flood-fill best practices (still relevant)

Even with the hybrid label-map approach, we run flood fill in two places: (a) the offline preprocessor, (b) a possible bitmap fallback for images without a label map. The choices matter.

### 3.1 Algorithm: **iterative span-fill (scanline)**

The right algorithm for canvas paint-bucket is span-based scanline fill. It is iterative (no recursion), it uses a small queue (one entry per row span, not per pixel), and it is well-tested in production paint apps. This is "Algorithm #4" in Ben Akrin's well-known canvas flood-fill comparison.

Avoid:

- **4-way recursive.** Stack overflow on any region larger than ~250 px square.
- **Per-pixel iterative with `Array.shift`.** `shift` is O(n); the queue dominates runtime on large fills.
- **8-way.** For our use (regions bordered by outlines), 4-way is correct and faster. 8-way leaks across diagonal outline corners.

Sketch:

```ts
function spanFill(
  data: Uint8ClampedArray,      // RGBA
  width: number, height: number,
  startX: number, startY: number,
  match: (i: number) => boolean,  // is this pixel part of the region?
  paint: (i: number) => void      // mark/color this pixel
): void {
  const stack: Array<[number, number]> = [[startX, startY]];
  while (stack.length) {
    const [sx, sy] = stack.pop()!;
    let x = sx;
    // walk left to find the start of the span
    while (x >= 0 && match((sy * width + x) * 4)) x--;
    x++;
    let spanAbove = false, spanBelow = false;
    while (x < width && match((sy * width + x) * 4)) {
      paint((sy * width + x) * 4);
      // check the row above
      if (sy > 0) {
        const above = match(((sy - 1) * width + x) * 4);
        if (!spanAbove && above)      { stack.push([x, sy - 1]); spanAbove = true; }
        else if (spanAbove && !above) { spanAbove = false; }
      }
      // check the row below
      if (sy < height - 1) {
        const below = match(((sy + 1) * width + x) * 4);
        if (!spanBelow && below)      { stack.push([x, sy + 1]); spanBelow = true; }
        else if (spanBelow && !below) { spanBelow = false; }
      }
      x++;
    }
  }
}
```

The queue is a plain array used as a stack (`push`/`pop`, both O(1)). We never use `Array.shift`.

### 3.2 Tolerance for antialiased edges

If we ever flood-fill against an antialiased outline (we shouldn't — but for the bitmap fallback path):

- Define `match(i)` as "alpha < 16 OR (R+G+B)/3 > 230". This treats both transparent and "near-white" as fillable, catching the soft AA edge.
- Erode outlines first. After binarizing the outline, dilate it by 1 pixel into the white interior. This pulls the fill away from the line and avoids the visible halo.
- Do not paint right up to the outline. Leave a 1-pixel gap if the artist's outline is thin, otherwise bumping the dilation creates broken-looking regions.

In short: **fix the line art, don't tune the tolerance.** Tolerance is a knob with no good setting; preprocessing is deterministic.

### 3.3 Stack depth & memory

- Span-fill is iterative; no recursion. Stack depth is "number of seed spans not yet processed," which for typical line-art regions is in the hundreds, not millions.
- For a 1024×1024 picture, peak working memory is the image's `Uint8ClampedArray` (4 MB) + a small fill queue. Well under any mobile budget.

### 3.4 Performance expectations

For a typical region of 500×500 pixels (≈250 K pixels):

- Span-fill in the main thread: ~5–15 ms on a mid-range phone (2024 baseline). Visually a single frame.
- Span-fill on `OffscreenCanvas` in a Worker: same throughput, but no main-thread jank — keeps the camera responsive during the fill.
- Mask-paint via `globalCompositeOperation` (the label-map path): sub-millisecond. The browser does it as a blit.

### 3.5 Worker / OffscreenCanvas?

- **Preprocessor:** yes, always in a Worker. Loading a new picture must not block the main thread.
- **Runtime fill (label-map path):** no need. Mask-paint is too cheap to bother.
- **Runtime fill (bitmap fallback):** yes if the image is >512² and we have `OffscreenCanvas` support. We feature-detect; the fallback for older Safari is on-thread span-fill, which is acceptable for our target sizes.

### 3.6 Outline color handling

A robust line-art image must be:

- **Pure black** (`#000000`) outlines — no soft gray AA pixels.
- **Transparent or pure white** interior — anything in between is treated as outline by the preprocessor.

The lint script (§2.3) enforces this. Source images that fail are bounced back to the artist. We do not try to "be clever" with arbitrary line art at runtime.

---

## 4. Color palette UI

The palette is the second-most-touched UI surface. It must feel like jewelry.

### 4.1 Layout

- **Right rail on desktop / landscape tablet.** Fixed width, ~88 px, hugs the right edge.
- **Bottom strip on portrait phone.** Horizontal scroller pinned to the bottom safe area, ~96 px tall.
- The breakpoint is media-query driven: `(orientation: portrait) and (max-width: 600px)` → bottom strip; otherwise → right rail.
- The picture canvas takes the remaining space, centered, with `object-fit: contain` semantics (we letterbox; we never crop the artwork).

### 4.2 Swatch sizing & touch targets

- Swatches are **48×48 px** with a 4 px gap. Apple HIG and Material both call for ≥44 px tap targets; 48 is comfortable and aesthetically square.
- Selected swatch grows to 56×56, gets a 2 px white inner border, a 1 px black outer border, and a shadow. The border colors guarantee visibility on both very light and very dark swatches.
- Hover is a 1.05× scale on desktop. No hover effect on touch devices (use `@media (hover: hover)`).

### 4.3 Palette content

- **Default palette:** 24 swatches arranged in a 2-wide right-rail (or 2-tall bottom strip). 6 hues × 4 lightness steps, plus white and a few neutrals.
- **Recent colors row:** the last 6 picked colors, deduped, persisted in `localStorage`. Always visible above (or to the left of) the main palette.
- **Eyedropper:** on desktop, the EyeDropper API (`new EyeDropper().open()`) lets us pick from anywhere on screen. On mobile, we fall back to a "tap a colored region in the picture to pick its color." Both routes feed the recent-colors row.
- **Custom color picker:** an `<input type="color">` is a one-line fallback in M3+ if users ask for it. We don't ship it in M1 — it adds UI weight for an underused feature.

### 4.4 DOM, not Phaser

The palette is HTML. Phaser draws the picture canvas; the palette is a sibling `<aside>`. Reasons:

- Native scroll, native focus, native a11y (each swatch is a `<button>` with `aria-label="orange"`).
- CSS handles the breakpoint switch; Phaser's UI system would force us to re-implement layout primitives.
- Cross-element hover/focus is free.

The palette communicates with Phaser through a tiny event bus (`window.dispatchEvent(new CustomEvent('palette:select', { detail: { hex } }))` or, more cleanly, a typed singleton). The Phaser scene listens and stores the selected color. No global state framework needed.

---

## 5. Picture picker

### 5.1 Layout

- A modal grid of thumbnails, opened from a "Pictures" button in the top-left.
- Grid: 3 columns on phone, 4 on tablet, 6 on desktop. Each cell is the picture thumbnail with a small title beneath.
- Tapping a thumbnail loads that picture and closes the modal.
- The currently-selected picture is highlighted.
- Each thumbnail shows a small badge if the picture has unsaved progress (we autosave to `localStorage`, so this badge means "you're partway through this one").

### 5.2 Thumbnails

- A 256×256 JPEG generated by the preprocessor. Lazy-loaded (`loading="lazy"`), so the modal opens instantly even with 100+ pictures.
- Source PNGs are not loaded until the user picks a picture.

### 5.3 Categories (M4)

A simple top-row category tab (`Animals | Mandalas | Floral | More`). Just a filter on a `category: string` field in `meta.json`. Don't ship until catalog hits ~30 pictures.

### 5.4 No carousel

A "next/prev" carousel sounds friendly but breaks down past 10 pictures. Grid scales. We start with grid.

---

## 6. Save / share / export

### 6.1 Composition for export

The export is a flattened PNG of `outline + filled regions`, at the source resolution (not the rendered resolution). We render off-screen:

```ts
function exportPNG(picture: Picture, fills: Map<RegionId, Color>): Promise<Blob> {
  const c = new OffscreenCanvas(picture.width, picture.height);
  const ctx = c.getContext('2d')!;
  // 1. paint the white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, picture.width, picture.height);
  // 2. paint each region's color through its mask
  for (const [regionId, color] of fills) {
    paintRegion(ctx, picture, regionId, color);
  }
  // 3. composite the outline on top
  ctx.drawImage(picture.outlineImage, 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}
```

The runtime canvas is at display resolution; the export is at source resolution (typically 2×). The user gets a poster-quality file.

### 6.2 Share via Web Share API (Level 2, with files)

```ts
const blob = await exportPNG(picture, fills);
const file = new File([blob], `${picture.slug}.png`, { type: 'image/png' });
if (navigator.canShare?.({ files: [file] })) {
  await navigator.share({ files: [file], title: picture.title });
} else {
  triggerDownload(blob, `${picture.slug}.png`);
}
```

- iOS Safari and Android Chrome both support `share({ files })`.
- Desktop Safari / Firefox fall through to download (anchor with `download` attribute).
- We never branch by user-agent string; we feature-detect with `canShare`.

### 6.3 Gallery (local saves)

- Autosave on every fill: `localStorage[`save:${slug}`] = JSON.stringify(fills)`. Cheap — a `Map<RegionId, "#hex">` for ≤220 regions is well under 4 KB serialized.
- Manual "save to gallery": same data plus a render of the export PNG as a base64 data URL, so the gallery can show a thumbnail of the user's actual coloring. We cap the gallery at 50 entries (`localStorage` quota is ~5 MB).
- "My Gallery" is a second tab in the picture picker modal (M3+).

### 6.4 No backend

We considered a "share to URL" feature where a friend opens a link and sees the colored picture. This would need either Cloudflare R2 or a Supabase-style backend. **Out of scope.** If it matters in M5+, we add a tiny upload endpoint then. Until then, share = file share.

---

## 7. Undo, clear, redo

### 7.1 The cheap undo: command stack

State per picture is `Map<RegionId, Color>` ("paint" map). Every fill is the command `setRegionColor(regionId, prevColor → newColor)`. We push to a `history: Command[]` array and an `redoStack: Command[]` we clear on every new action.

```ts
type Command = { regionId: RegionId; from: Color | null; to: Color };
```

- **Single-step undo (M4 baseline):** pop the last command, restore `from`. O(1).
- **Multi-step undo:** loop. We cap history at 50 entries to bound memory.
- **Redo:** re-apply the popped command's `to`. We clear `redoStack` on any new fill.
- **Clear:** push N undo entries (one per filled region) so "Clear" is itself undoable. Or: clear the paint map, snapshot it as one big undo entry, store the previous map in the undo entry. The latter is cleaner; we go with it.

We never snapshot the canvas pixels. The label-map architecture means the canvas is a deterministic function of `picture + paint-map`, so the paint map *is* the save game. This is a major reason we picked approach C in §2.

### 7.2 What "stroke history" looks like

- One entry per tap. Not per pixel, not per row, not per millisecond.
- Persisted in `localStorage` together with the paint map, so undo survives a refresh on the same picture (M4).

### 7.3 UI

- Undo / Redo / Clear buttons in the top toolbar.
- Undo and Redo grey out when their stacks are empty.
- Clear shows a confirmation modal (single tap to clear is a regret-trap).

---

## 8. Mobile considerations

### 8.1 Touch handling — tap, not drag

- The fill action is **tap**, not "tap-and-hold," not "drag-to-paint." A tap is `pointerdown` followed by `pointerup` within 250 ms and within 10 px of the start.
- We implement this on top of Phaser's `pointerup` (with a guard against `pointerupoutside`).
- Long-press is reserved for the eyedropper on mobile (held for 400 ms over a colored region).
- Drag is reserved for pan-when-zoomed (§9.3).

### 8.2 Pinch zoom & pan

We use `phaser3-rex-plugins` for pinch detection because the manual approach with two pointers is finicky around browser zoom fighting:

```ts
const pinch = this.plugins.get('rexPinch').add(this);
pinch.on('pinch', (p) => {
  this.cameras.main.zoom *= p.scaleFactor;
  this.cameras.main.zoom = Phaser.Math.Clamp(this.cameras.main.zoom, 1, 6);
});
```

- Min zoom = 1 (fit to viewport). Max zoom = 6.
- Pan is enabled only when zoomed in. Pan respects bounds — you can't drag the picture off-screen.
- Tap-to-fill must still work while zoomed; we translate world coords correctly through the camera. Phaser's `pointer.worldX` does this.

### 8.3 Viewport & scaling

The page sets:

```html
<meta name="viewport" content="width=device-width,
  initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
```

`user-scalable=no` blocks the *browser's* pinch zoom (which would otherwise zoom the whole page including chrome) and lets *our* pinch handler own the gesture. `viewport-fit=cover` lets us put the bottom palette under the home-indicator on iPhone notched devices.

### 8.4 Prevent accidental scroll & rubber-band

- The Phaser canvas container has `touch-action: none`. This stops the browser from interpreting two-finger drags as page scrolls.
- The palette container has `touch-action: pan-x` (bottom strip) or `pan-y` (right rail) so the palette itself can scroll.
- iOS Safari's overscroll bounce is disabled with `overscroll-behavior: none` on `<body>`.

### 8.5 DPR & crispness

- Phaser is initialized with `resolution: window.devicePixelRatio`. The runtime canvas is rendered at native pixel density, so outlines stay crisp on retina.
- Source line art is provided at 2048² and downsampled to 1024² for non-retina, used at full 2048² on retina. The label map is computed at the *runtime* resolution to keep the byte count down.

### 8.6 Performance budget

- **First paint:** ≤2.5 s on mid-range Android over 4G. Vite's tree-shaken Phaser bundle is ~700 KB gzipped; a single picture asset is ~80 KB.
- **Tap-to-fill latency:** ≤32 ms (two frames) from pointerup to color visible on screen.
- **Interaction during fill:** zero jank. Achieved by mask-paint (no per-pixel work) and worker preprocessing.

---

## 9. Suggested directory structure

```
html/
├── index.html                # Vite entry; mounts #game and the palette
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── assets/
│       └── pictures/
│           ├── kitten/
│           │   ├── source.png        # author's line art (2048²)
│           │   ├── outline.png       # binarized outlines
│           │   ├── labels.bin        # region-id buffer (W×H bytes, gzipped)
│           │   ├── thumb.jpg         # 256² for picker
│           │   └── meta.json         # { width, height, regions: [...] }
│           └── mandala-1/ ...
├── src/
│   ├── main.ts                # boots Phaser game, mounts UI
│   ├── ui/
│   │   ├── palette.ts         # HTML palette controller
│   │   ├── palette.css
│   │   ├── picker.ts          # picture picker modal
│   │   ├── picker.css
│   │   ├── toolbar.ts         # undo/redo/clear/share buttons
│   │   └── share.ts           # Web Share / download fallback
│   ├── game/
│   │   ├── ColorBookGame.ts   # Phaser.Game config
│   │   ├── scenes/
│   │   │   ├── BootScene.ts   # asset preload
│   │   │   ├── PickerScene.ts # (only if we move picker into Phaser; default DOM)
│   │   │   └── ColorScene.ts  # the actual coloring scene
│   │   ├── PictureRenderer.ts # outline + filled-region compositing
│   │   ├── HitTester.ts       # tap → regionId (label-map lookup)
│   │   └── input/
│   │       ├── pinchPan.ts    # rex-plugin glue
│   │       └── tapDetector.ts # tap vs drag classifier
│   ├── state/
│   │   ├── GameState.ts       # paintMap, selectedColor, selectedPicture
│   │   ├── history.ts         # Command stack, undo/redo
│   │   └── persistence.ts     # localStorage adapters
│   ├── flood/
│   │   ├── spanFill.ts        # iterative scanline (shared by tools/ and worker)
│   │   ├── preprocess.ts      # outline binarize + dilate + region sweep
│   │   └── worker.ts          # entry for offline preprocessing
│   ├── types.ts               # RegionId, Color, Picture, Command, etc.
│   └── events.ts              # typed event bus between UI and Phaser
├── tools/
│   ├── lint-lineart.ts        # CI guard for source PNGs
│   └── preprocess.ts          # Node entry for the offline pipeline
└── tests/
    ├── spanFill.test.ts
    └── history.test.ts
```

Notes:

- `flood/` is shared between Node (`tools/preprocess.ts`) and the browser (worker + runtime fallback). Vite handles this with conditional exports.
- `state/` is plain TS, no Phaser dependency, so we can unit-test it.
- We do not premake `scenes/PickerScene.ts`; the picker is DOM (§5). The file is in the diagram only as a hedge if we later move it into Phaser for animation.

---

## 10. Phased build plan

### M1 — Walking skeleton (target: 2–3 days)

Goal: one picture, one color, tap fills.

- Vite + TS + Phaser project from official template.
- One hand-prepped picture committed with its `outline.png`, `labels.bin`, `meta.json`. We do the preprocessing manually from a notebook for this milestone — no `tools/preprocess.ts` yet.
- `BootScene` loads the picture; `ColorScene` renders the outline on top of a white background.
- `HitTester` looks up the region ID at the tap position from `labels.bin`.
- `PictureRenderer` paints the region with `globalCompositeOperation: 'source-in'` against a per-region mask cached on first hit.
- Color is hard-coded to `#ff8800`. No palette yet.
- No save, no share, no undo.

**Done when:** open page, see kitten, tap each region, regions turn orange, no UI jank.

### M2 — Palette + multiple pictures (target: 3–4 days)

Goal: real product.

- DOM palette (right rail / bottom strip) per §4.
- Picture picker modal per §5.
- Thumbnail generation added to `tools/preprocess.ts`.
- 5 starter pictures in the catalog.
- `tools/preprocess.ts` becomes the canonical offline pipeline; we re-process all five through it.
- `tools/lint-lineart.ts` runs in CI (GitHub Actions) on every PR.
- Autosave paint-map to `localStorage` per picture. Reload restores progress.

**Done when:** pick any of 5 pictures, pick any of 24 colors, color it, switch pictures, come back, progress is still there.

### M3 — Save, share, gallery (target: 2–3 days)

Goal: shareable artifact.

- "Share" button → Web Share API with PNG, fallback to download.
- "My Gallery" tab in picker (saved finished pieces; thumbnail = the user's actual rendering).
- "Eyedropper" via the EyeDropper API on desktop, "tap-a-region" on mobile.

**Done when:** finish coloring, hit Share, send the PNG to yourself in Messages, see it.

### M4 — Polish (target: 4–6 days, can be split)

Goal: this feels like a real app.

- Undo / Redo / Clear with full history (§7).
- Pinch zoom + pan (§8.2).
- 30 pictures total, organized into categories (§5.3).
- PWA manifest + service worker for offline use.
- Recent-colors row in the palette.
- Confirmation on Clear.
- "Tap to pick color" eyedropper on mobile.
- Subtle fill animation (a 100 ms ease-in alpha mask) on each tap so the action feels responsive even when it's instant.

**Done when:** install to home screen, color a picture offline on a plane, plane lands, share the result.

---

## 11. Risks & open questions

- **Outline gaps in user-uploaded line art (M5+).** The preprocessor's 1-pixel dilation handles most authoring slop, but a gap of 3+ pixels will let the fill leak. We may need an interactive "seal this gap" tool. Out of scope for M1–M4, which only ships curated content.
- **`labels.bin` size for very-large regions.** A 1024² label buffer is 1 MB raw; gzip typically compresses it to 30–80 KB because adjacent pixels share IDs. If a future picture has thousands of tiny detail regions, gzip helps less. We measure as we add pictures and downscale to 768² if a single asset crosses 200 KB gzipped.
- **iOS Safari quirks.** `OffscreenCanvas` + Web Workers has had bumpy support on older Safari. We feature-detect; the on-thread fallback is fine for our scale, but the M2 acceptance test must include "load on iOS 16 Safari" explicitly.
- **EyeDropper API not on all browsers.** Falls back to mobile-style "tap a colored region." Acceptable.
- **Color blindness.** The default 24-color palette has hue overlap that's hard for deuteranopes (e.g., red/green at the same lightness). We add a "colorblind-friendly" palette toggle in M4 — same APIs, different swatch list.

---

## 12. Recommendation summary (one-screen version)

| Decision | Choice |
| --- | --- |
| Engine | Phaser 3.90.0 |
| Bundler | Vite |
| Language | TypeScript (strict) |
| Deployment | GitHub Pages (primary), itch.io (secondary). No Roblox. |
| Asset strategy | Hybrid label-map: outline PNG + per-pixel region IDs |
| Preprocessing | Offline (Node) for shipped pictures; Web Worker for user uploads (M5+) |
| Flood-fill algorithm | Iterative scanline span-fill |
| Outline handling | Pre-binarize + 1-px dilate. No runtime AA tolerance. |
| Palette | DOM, right rail / bottom strip, 48 px swatches |
| Picker | DOM modal grid |
| Share | `navigator.share` files, anchor-download fallback |
| Undo | Command stack on `Map<RegionId, Color>`; no canvas snapshots |
| Mobile gestures | rex-plugins pinch, custom tap-vs-drag classifier |
| Persistence | `localStorage` per-picture paint maps + gallery |
| Backend | none |

This plan is small enough to ship M1 in one focused week and big enough to make M4 actually feel like a product. The hybrid label-map decision in §2 is the load-bearing wall — once it's in place, every other feature gets cheaper.
