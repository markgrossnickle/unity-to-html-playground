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
//   - The visible LINES layer is drawn from the original source image's luma
//     (black with alpha = 1 − lightness), so antialiased outlines stay smooth
//     and the user's drawing isn't aliased into pixelated mush. Threshold +
//     erode are still used for the LABELS layer where we need a binary mask.
//
// Output is a pair of canvases that match the runtime's expected format:
//   lines:  RGBA, black with luma-derived alpha (preserves antialiasing).
//   labels: RGBA, R=region id (1..255), alpha=255 inside a region, 0 outside.

const BACKGROUND_ID = 255;
const MAX_REGION_ID = 254;

export interface ParseOptions {
  threshold?: number;
  minRegion?: number;
  erode?: number;
  maxDim?: number;
}

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
  const { width, height, gray } = drawToGrayscale(img, settings.maxDim);

  let mask = threshold(gray, settings.threshold);
  for (let i = 0; i < settings.erode; i++) mask = erodeOnce(mask, width, height);

  const { labels, sizes, touchesBorder } = labelComponents(mask, width, height);
  dropTinyComponents(labels, sizes, settings.minRegion);

  const survivingBorder = new Set<number>();
  for (const id of touchesBorder) if (sizes.has(id)) survivingBorder.add(id);

  const backgroundRaw = pickBackground(sizes, survivingBorder);
  const idMap = assignFinalIds(sizes, backgroundRaw);

  // Lines layer is drawn straight from source luma — keep the outline's
  // antialiasing so it doesn't look pixelated when scaled up. The runtime
  // composites this on top of the fill canvas, so the original outline
  // appearance is preserved exactly.
  const linesPng = buildLinesPng(gray, width, height);
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

function drawToGrayscale(
  img: HTMLImageElement,
  maxDim: number
): { width: number; height: number; gray: Uint8Array } {
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
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  // Rec. 601 luma. Matches sharp's default grayscale, close enough for the
  // threshold step that follows.
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
  }
  return { width: w, height: h, gray };
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

// Build the visible outline layer directly from the source's luma channel.
// Each pixel becomes pure black with alpha = 255 - luma, so a fully-black
// source pixel stays fully opaque, fully-white becomes transparent, and gray
// edge pixels become semi-transparent black — preserving antialiasing exactly
// the way the source artist drew it. We don't binarize for the visible layer.
function buildLinesPng(gray: Uint8Array, width: number, height: number): string {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable for lines canvas");
  const img = ctx.createImageData(width, height);
  const out = img.data;
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    // RGB stays 0 (black); alpha = darkness of source pixel.
    out[o + 3] = 255 - gray[i]!;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
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
