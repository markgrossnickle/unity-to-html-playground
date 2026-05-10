// Convert a color image (photo, illustration, AI art) into a clean
// black-on-white outline ImageData that the rest of the import pipeline
// (threshold + erode → CC labeling) can swallow as if the user had handed us
// hand-drawn line art.
//
// Pipeline: posterize → boundary trace.
//
//   1. Heavy separable Gaussian blur (σ ~2.5). The point is not denoising —
//      it is to wash out fine detail so adjacent similar colors merge into
//      flat regions before quantization. Without this, noise survives
//      quantization and the boundary trace lights up on per-pixel speckle.
//   2. Uniform RGB quantization to N levels per channel (N=4 → 64 colors).
//      Cheap, predictable, and at N=4 already produces a strong posterized
//      look. K-means / median-cut would be smarter but slower and more code,
//      and the gains don't show through the downstream label pass.
//   3. Boundary trace on the quantized image: for each pixel, compare to its
//      right and down neighbor; if either differs, mark it an edge. (Right-
//      and-down only, so we do not double-mark both sides of a boundary.)
//   4. Optional 1-px morphological dilation, 4-connected. Lines render as
//      2-px-wide strokes — reads as "drawn" rather than "scanned line."
//   5. Output ImageData: edge → pure black opaque, non-edge → pure white opaque.
//
// WHY this beats Sobel-then-threshold:
//
//   Sobel responds to per-pixel intensity gradients. A smooth tonal ramp
//   across a fur patch produces a sea of weak gradients; threshold them and
//   you get a constellation of dots, not a line. Following with morphological
//   thinning makes it worse — every speckle gets carved further apart.
//
//   Posterize-then-trace works the opposite way: we collapse smooth ramps
//   into flat regions on purpose, then draw a line precisely where two
//   regions meet. The result is a small number of long, continuous outlines —
//   the silhouette, the eyes, the major interior boundaries — instead of a
//   field of broken dots.
//
// All passes operate on the source resolution. Hot loops use typed arrays;
// allocations stay flat. Performance target: <1.5 s for a 2400×2400 source on
// Android Chrome (a one-time cost at import).

export interface CartoonizeOptions {
  blurSigma?: number;       // gaussian sigma in pixels; 2.5 ≈ 15-tap kernel
  quantizeLevels?: number;  // levels per RGB channel (4 → 64 colors total)
  dilate?: number;          // morphological dilation iterations (line thickness − 1)

  // Deprecated. Old Sobel-pipeline knobs; accepted but ignored so callers that
  // were typed against the previous shape (e.g. importParser, future UIs)
  // still compile.
  edgeThreshold?: number;
  thinIterations?: number;
  invert?: boolean;
}

const DEFAULTS = {
  blurSigma: 2.5,
  quantizeLevels: 4,
  dilate: 1,
};

export function cartoonizeImageData(
  src: ImageData,
  opts: CartoonizeOptions = {}
): ImageData {
  const blurSigma = opts.blurSigma ?? DEFAULTS.blurSigma;
  const quantizeLevels = Math.max(2, opts.quantizeLevels ?? DEFAULTS.quantizeLevels);
  const dilate = Math.max(0, opts.dilate ?? DEFAULTS.dilate);

  const { width, height, data } = src;
  const N = width * height;

  // Step 1 — split into R/G/B float planes, then blur each. Working in three
  // planes (instead of one luma plane) preserves color contrast that drives
  // the boundary trace later — two regions with the same luminance but
  // different hue must still produce a boundary.
  const rPlane = new Float32Array(N);
  const gPlane = new Float32Array(N);
  const bPlane = new Float32Array(N);
  for (let i = 0, j = 0; j < N; i += 4, j++) {
    rPlane[j] = data[i]!;
    gPlane[j] = data[i + 1]!;
    bPlane[j] = data[i + 2]!;
  }

  const rBlur = gaussianBlur(rPlane, width, height, blurSigma);
  const gBlur = gaussianBlur(gPlane, width, height, blurSigma);
  const bBlur = gaussianBlur(bPlane, width, height, blurSigma);

  // Step 2 — uniform per-channel quantization. step = 256 / N produces N bins
  // of equal width; we map each blurred sample to its bin index (0..N−1).
  // Storing the bin index (not the reconstructed color) keeps the comparison
  // in step 3 cheap: a single integer compare per channel.
  //
  // We pack the three bin indices into a single uint16 ID per pixel, so the
  // boundary check is one int compare instead of three. With levelsPerChannel
  // ≤ 16, three 4-bit fields fit comfortably in 16 bits.
  const step = 256 / quantizeLevels;
  const id = new Uint16Array(N);
  for (let p = 0; p < N; p++) {
    let r = (rBlur[p]! / step) | 0;
    let g = (gBlur[p]! / step) | 0;
    let b = (bBlur[p]! / step) | 0;
    if (r >= quantizeLevels) r = quantizeLevels - 1;
    if (g >= quantizeLevels) g = quantizeLevels - 1;
    if (b >= quantizeLevels) b = quantizeLevels - 1;
    id[p] = (r << 8) | (g << 4) | b;
  }

  // Step 3 — boundary trace. We walk every pixel except the right/bottom edge
  // and compare against the right and down neighbors only. If either differs,
  // mark the current pixel as edge. This single-side comparison guarantees
  // each boundary is drawn exactly once (on the upper/left side), giving a
  // crisp 1-pixel line rather than a 2-pixel doubled line.
  // Explicit annotation: `edge` is reassigned from `dilate4`, whose return
  // type widens to Uint8Array<ArrayBufferLike>; the inferred narrower type
  // from `new Uint8Array(N)` would clash under strict TS.
  let edge: Uint8Array = new Uint8Array(N);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = id[i]!;
      if (x + 1 < width && id[i + 1]! !== c) {
        edge[i] = 1;
        continue;
      }
      if (y + 1 < height && id[i + width]! !== c) {
        edge[i] = 1;
      }
    }
  }

  // Step 4 — optional dilation, 4-connected, repeated `dilate` times.
  // Each pass thickens the line by one pixel. We snapshot before each pass
  // so we never read pixels we just wrote in the same iteration.
  for (let d = 0; d < dilate; d++) {
    edge = dilate4(edge, width, height);
  }

  // Step 5 — pack to RGBA. Edge → black, non-edge → white. Alpha 255 always,
  // matching the contract the rest of the import pipeline expects.
  const out = new ImageData(width, height);
  const o = out.data;
  for (let p = 0; p < N; p++) {
    const v = edge[p] === 1 ? 0 : 255;
    const i = p * 4;
    o[i] = v;
    o[i + 1] = v;
    o[i + 2] = v;
    o[i + 3] = 255;
  }
  return out;
}

// Separable Gaussian blur over a Float32 plane. Two 1-D passes
// (horizontal into a temp buffer, then vertical into the result) gives
// O(N·k) instead of O(N·k²) for a k-tap kernel. Edges clamp.
function gaussianBlur(
  src: Float32Array,
  width: number,
  height: number,
  sigma: number
): Float32Array {
  const kernel = buildGaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;

  const tmp = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        let xx = x + k;
        if (xx < 0) xx = 0;
        else if (xx >= width) xx = width - 1;
        sum += src[row + xx]! * kernel[k + radius]!;
      }
      tmp[row + x] = sum;
    }
  }

  const dst = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        let yy = y + k;
        if (yy < 0) yy = 0;
        else if (yy >= height) yy = height - 1;
        sum += tmp[yy * width + x]! * kernel[k + radius]!;
      }
      dst[y * width + x] = sum;
    }
  }
  return dst;
}

function buildGaussianKernel(sigma: number): Float32Array {
  // Truncate at 3σ. For σ=2.5 that's a 15-tap kernel.
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const size = radius * 2 + 1;
  const k = new Float32Array(size);
  const inv2sigma2 = 1 / (2 * sigma * sigma);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const v = Math.exp(-(x * x) * inv2sigma2);
    k[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i] = k[i]! / sum;
  return k;
}

// 4-connected morphological dilation. Each output pixel is lit iff itself or
// any N/E/S/W neighbor is lit in the snapshot. Reading from the input
// snapshot (not in-place) keeps the iteration uniform — dilation never
// "spreads" within a single pass.
function dilate4(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (src[i] === 1) { out[i] = 1; continue; }
      if (x > 0 && src[i - 1] === 1) { out[i] = 1; continue; }
      if (x + 1 < width && src[i + 1] === 1) { out[i] = 1; continue; }
      if (y > 0 && src[i - width] === 1) { out[i] = 1; continue; }
      if (y + 1 < height && src[i + width] === 1) { out[i] = 1; continue; }
    }
  }
  return out;
}
