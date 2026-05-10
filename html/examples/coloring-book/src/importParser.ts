// Browser-side port of `scripts/parse-line-art.mjs`. Same pipeline:
//   threshold → erode → 4-connected component labeling → drop tiny → pick
//   border-largest as background (id 255) → assign 1..254 by descending size.
//
// Differences from the Node parser:
//   - Uses Canvas 2D (`getImageData` / `putImageData`) for I/O instead of sharp.
//   - Uses iterative stack-based flood-fill instead of two-pass union-find.
//     Recursive DFS would blow the JS stack on a 1200² image; iterative with
//     a typed-array stack is bounded and ~as fast as the union-find pass.
//   - Optionally downscales large source images to keep parsing under ~3s on
//     mobile (Android Chrome on a mid-range phone is the target).
//   - For B&W input the visible LINES layer is the user's ORIGINAL image,
//     not transformed. The runtime composites it on top of the fill canvas
//     with multiply blend mode, so the user's drawing is preserved
//     pixel-for-pixel. For COLOR input we cartoonize first (see cartoonize.ts)
//     and use that black-on-white outline as both the visible lines layer
//     AND the input to the labels mask.
//   - Threshold + erode are still used for the LABELS layer where we need a
//     binary mask, but they never touch what the user actually sees.
//
// Output is a pair of canvases that match the runtime's expected format:
//   lines:  the (possibly cartoonized) outline image.
//   labels: RGBA, R=region id (1..255), alpha=255 inside a region, 0 outside.

import { cartoonizeImageData } from "./cartoonize";

const BACKGROUND_ID = 255;
const MAX_REGION_ID = 254;

export interface ParseOptions {
  threshold?: number;
  minRegion?: number;
  erode?: number;
  maxDim?: number;
  // Optional progress hook so the toolbar overlay can swap text between the
  // (slow) cartoonize pass and the labeling pass on color inputs.
  onProgress?: (stage: ParseStage) => void;
}

export type ParseStage = "cartoonize" | "label";

export interface ParsedPicture {
  name: string;
  width: number;
  height: number;
  linesPng: string;
  labelsPng: string;
  regionCount: number;
}

const DEFAULTS = {
  threshold: 128,
  minRegion: 50,
  erode: 1,
  // Cap the long side so a 6000 px scanned line-art doesn't OOM the phone
  // while parsing. 2400 = 4× the pixel count of the previous 1200 cap, which
  // keeps detail crisp on retina-class screens without blowing memory or
  // exceeding localStorage quotas (data-URL grows ~linearly with pixel count).
  maxDim: 2400,
} as const;

export async function parseImage(
  file: File,
  opts: ParseOptions = {}
): Promise<ParsedPicture> {
  const settings = {
    threshold: opts.threshold ?? DEFAULTS.threshold,
    minRegion: opts.minRegion ?? DEFAULTS.minRegion,
    erode: opts.erode ?? DEFAULTS.erode,
    maxDim: opts.maxDim ?? DEFAULTS.maxDim,
  };

  const img = await loadImage(file);
  const drawn = drawSource(img, settings.maxDim);
  const { width, height, sourceImageData } = drawn;
  let { gray, sourcePng } = drawn;

  // Color path: cartoonize the source into a B&W outline, then feed THAT into
  // the rest of the pipeline. The visible lines layer becomes the cartoon, so
  // the user sees the same outline that drives the labels mask.
  if (isColorImage(sourceImageData.data)) {
    opts.onProgress?.("cartoonize");
    // Yield once so the overlay text update repaints before the heavy passes.
    await new Promise((r) => requestAnimationFrame(r));
    const cartoon = cartoonizeImageData(sourceImageData);
    sourcePng = imageDataToDataURL(cartoon);
    gray = imageDataToGrayscale(cartoon);
  }
  opts.onProgress?.("label");

  let mask = threshold(gray, settings.threshold);
  for (let i = 0; i < settings.erode; i++) mask = erodeOnce(mask, width, height);

  const { labels, sizes, touchesBorder } = labelComponents(mask, width, height);
  dropTinyComponents(labels, sizes, settings.minRegion);

  const survivingBorder = new Set<number>();
  for (const id of touchesBorder) if (sizes.has(id)) survivingBorder.add(id);

  const backgroundRaw = pickBackground(sizes, survivingBorder);
  const idMap = assignFinalIds(sizes, backgroundRaw);

  // Lines layer is the user's source image, untouched. Threshold + erode are
  // applied only to the labels mask above; they never modify what is shown.
  const linesPng = sourcePng;
  const labelsPng = buildLabelsPng(labels, idMap, width, height);

  const regionCount = idMap.size - (backgroundRaw !== null ? 1 : 0);
  if (regionCount <= 0) {
    throw new Error(
      "no fillable regions detected — try a higher-contrast line drawing"
    );
  }

  const name = filenameToName(file.name);

  return { name, width, height, linesPng, labelsPng, regionCount };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode image — file may be corrupt or not an image"));
    };
    img.src = url;
  });
}

interface DrawnSource {
  width: number;
  height: number;
  gray: Uint8Array;
  sourceImageData: ImageData;
  sourcePng: string;
}

function drawSource(img: HTMLImageElement, maxDim: number): DrawnSource {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (w === 0 || h === 0) throw new Error("image has zero dimensions");

  if (w > maxDim || h > maxDim) {
    const scale = Math.min(maxDim / w, maxDim / h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D context unavailable for import canvas");
  // White underlay so transparent source PNGs (line art on alpha) read as
  // "fillable" rather than getting random noise from the canvas backing store.
  // Multiply blend in the runtime needs a white interior to show the fill
  // color through, so this also matches what the user expects on screen.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  // Snapshot the source-on-white canvas BEFORE we read pixel data. This is
  // the visible lines layer for B&W input the runtime composites with multiply
  // blending — we want the user's exact pixels here, including any antialiased
  // edges. (Color input throws this away in favor of the cartoonized output.)
  const sourcePng = c.toDataURL("image/png");

  const sourceImageData = ctx.getImageData(0, 0, w, h);
  const rgba = sourceImageData.data;
  const gray = new Uint8Array(w * h);
  // Rec. 601 luma. Matches sharp's default grayscale, close enough for the
  // threshold step that follows.
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = (rgba[i]! * 299 + rgba[i + 1]! * 587 + rgba[i + 2]! * 114) / 1000;
  }
  return { width: w, height: h, gray, sourceImageData, sourcePng };
}

// Detect whether the source has meaningful color content. We sample every
// Nth pixel (cap ~10K samples) and look at max|R-G|, |G-B|, |R-B|. Any
// value above COLOR_TOLERANCE counts; if that's true for >COLOR_FRACTION of
// samples, it's color. The thresholds are loose enough that JPEG chroma
// noise on a B&W scan (subtle yellow-blue speckle) doesn't trip the path,
// but a properly colored illustration trips it instantly.
const COLOR_TOLERANCE = 12;
const COLOR_FRACTION = 0.01;
const COLOR_SAMPLE_TARGET = 10_000;

export function isColorImage(rgba: Uint8ClampedArray): boolean {
  const pixelCount = rgba.length / 4;
  if (pixelCount === 0) return false;
  const stride = Math.max(1, Math.floor(pixelCount / COLOR_SAMPLE_TARGET));
  let samples = 0;
  let colored = 0;
  for (let p = 0; p < pixelCount; p += stride) {
    const i = p * 4;
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const drg = r > g ? r - g : g - r;
    const dgb = g > b ? g - b : b - g;
    const drb = r > b ? r - b : b - r;
    const m = drg > dgb ? (drg > drb ? drg : drb) : (dgb > drb ? dgb : drb);
    if (m > COLOR_TOLERANCE) colored++;
    samples++;
  }
  return colored / samples > COLOR_FRACTION;
}

function imageDataToDataURL(img: ImageData): string {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable for cartoon canvas");
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

function imageDataToGrayscale(img: ImageData): Uint8Array {
  const data = img.data;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
  }
  return out;
}

function threshold(gray: Uint8Array, t: number): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i]! < t ? 1 : 0;
  return out;
}

function erodeOnce(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] === 1) continue;
      if (
        (x > 0 && mask[i - 1] === 1) ||
        (x < width - 1 && mask[i + 1] === 1) ||
        (y > 0 && mask[i - width] === 1) ||
        (y < height - 1 && mask[i + width] === 1)
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

interface LabelResult {
  labels: Int32Array;
  sizes: Map<number, number>;
  touchesBorder: Set<number>;
}

// Iterative DFS flood-fill over fillable pixels. We mark labels[ni] before
// pushing so the stack high-water mark is ≤ N (each pixel pushed once).
function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number
): LabelResult {
  const N = width * height;
  const labels = new Int32Array(N);
  const sizes = new Map<number, number>();
  const touchesBorder = new Set<number>();

  const stack = new Int32Array(N);
  let top = 0;
  let nextId = 1;

  for (let start = 0; start < N; start++) {
    if (mask[start] === 1) continue;
    if (labels[start] !== 0) continue;

    const id = nextId++;
    let size = 0;
    let touches = false;

    stack[top++] = start;
    labels[start] = id;

    while (top > 0) {
      const i = stack[--top]!;
      size++;
      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touches = true;

      if (x > 0) {
        const ni = i - 1;
        if (mask[ni] === 0 && labels[ni] === 0) {
          labels[ni] = id;
          stack[top++] = ni;
        }
      }
      if (x < width - 1) {
        const ni = i + 1;
        if (mask[ni] === 0 && labels[ni] === 0) {
          labels[ni] = id;
          stack[top++] = ni;
        }
      }
      if (y > 0) {
        const ni = i - width;
        if (mask[ni] === 0 && labels[ni] === 0) {
          labels[ni] = id;
          stack[top++] = ni;
        }
      }
      if (y < height - 1) {
        const ni = i + width;
        if (mask[ni] === 0 && labels[ni] === 0) {
          labels[ni] = id;
          stack[top++] = ni;
        }
      }
    }

    sizes.set(id, size);
    if (touches) touchesBorder.add(id);
  }

  return { labels, sizes, touchesBorder };
}

function dropTinyComponents(
  labels: Int32Array,
  sizes: Map<number, number>,
  minSize: number
): void {
  const drop = new Set<number>();
  for (const [id, sz] of sizes) if (sz < minSize) drop.add(id);
  if (drop.size === 0) return;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]! !== 0 && drop.has(labels[i]!)) labels[i] = 0;
  }
  for (const id of drop) sizes.delete(id);
}

function pickBackground(
  sizes: Map<number, number>,
  touchesBorder: Set<number>
): number | null {
  let best: number | null = null;
  let bestSize = 0;
  for (const id of touchesBorder) {
    const sz = sizes.get(id) ?? 0;
    if (sz > bestSize) {
      bestSize = sz;
      best = id;
    }
  }
  return best;
}

function assignFinalIds(
  sizes: Map<number, number>,
  backgroundRaw: number | null
): Map<number, number> {
  const idMap = new Map<number, number>();
  if (backgroundRaw !== null) idMap.set(backgroundRaw, BACKGROUND_ID);

  const others: Array<[number, number]> = [];
  for (const [id, sz] of sizes) {
    if (id === backgroundRaw) continue;
    others.push([id, sz]);
  }
  others.sort((a, b) => b[1] - a[1]);

  let next = 1;
  for (const [id] of others) {
    if (next > MAX_REGION_ID) {
      idMap.set(id, 0); // demoted → folded into outline
      continue;
    }
    idMap.set(id, next++);
  }
  return idMap;
}

function buildLabelsPng(
  labels: Int32Array,
  idMap: Map<number, number>,
  width: number,
  height: number
): string {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable for labels canvas");
  const img = ctx.createImageData(width, height);
  const out = img.data;
  for (let i = 0; i < labels.length; i++) {
    const raw = labels[i]!;
    if (raw === 0) continue;
    const finalId = idMap.get(raw);
    if (!finalId) continue;
    const o = i * 4;
    out[o] = finalId;
    out[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

function filenameToName(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").trim();
  if (!stem) return "Imported";
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}
