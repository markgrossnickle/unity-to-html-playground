// Convert a color image (photo, illustration, AI art) into a clean
// black-on-white outline ImageData that the rest of the import pipeline
// (threshold + erode → CC labeling) can swallow as if the user had handed us
// hand-drawn line art.
//
// Pipeline:
//   1. RGBA → luma (Float32 grayscale).
//   2. Separable Gaussian blur (horizontal then vertical pass) — kills JPEG
//      noise and stops the Sobel pass from finding edges in every gradient.
//   3. Sobel 3x3 gradient magnitude (|gx| + |gy|, the cheap L1 form).
//   4. Threshold magnitude → binary edge map.
//   5. Optional thinning: remove edge pixels with too many edge neighbors so a
//      thick edge band collapses toward its center line. Cheap proxy for
//      Zhang-Suen, good enough for region-fill.
//   6. Output ImageData: edge = pure black opaque, non-edge = pure white opaque.
//
// All passes operate on the source resolution (caller is responsible for any
// downscaling). Hot loops use typed arrays; allocations stay flat.
//
// Tunables live as defaults on CartoonizeOptions — exposed as constants here
// so a future UI can wire sliders without changing the algorithm.

export interface CartoonizeOptions {
  blurSigma?: number;       // gaussian sigma in pixels; 1.4 ~ a 9-tap kernel
  edgeThreshold?: number;   // 0-255 magnitude cutoff; lower = more detail
  thinIterations?: number;  // 0 = no thinning; 1 = single morphological pass
  invert?: boolean;         // true → black outline on white (the default we want)
}

const DEFAULTS: Required<CartoonizeOptions> = {
  blurSigma: 1.4,
  edgeThreshold: 60,
  thinIterations: 1,
  invert: true,
};

export function cartoonizeImageData(
  src: ImageData,
  opts: CartoonizeOptions = {}
): ImageData {
  const blurSigma = opts.blurSigma ?? DEFAULTS.blurSigma;
  const edgeThreshold = opts.edgeThreshold ?? DEFAULTS.edgeThreshold;
  const thinIterations = opts.thinIterations ?? DEFAULTS.thinIterations;
  const invert = opts.invert ?? DEFAULTS.invert;

  const { width, height, data } = src;
  const N = width * height;

  // Step 1 — luma. Rec. 601 to match the rest of the parser.
  const gray = new Float32Array(N);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
  }

  // Step 2 — separable Gaussian.
  const blurred = gaussianBlur(gray, width, height, blurSigma);

  // Step 3 — Sobel magnitude (L1 norm; ~half the cost of L2 with imperceptible
  // difference once we threshold).
  const mag = sobelMagnitude(blurred, width, height);

  // Step 4 — threshold.
  const edge = new Uint8Array(N);
  for (let i = 0; i < N; i++) edge[i] = mag[i]! >= edgeThreshold ? 1 : 0;

  // Step 5 — optional thinning. Each pass strips edge pixels surrounded by
  // ≥6 of 8 edge neighbors; skeletonizes thick edge bands without erasing
  // single-pixel-wide strokes (which have ≤2 edge neighbors).
  // Explicit type annotation so the inferred ArrayBuffer flavor of `edge` and
  // the wider one returned by `thinOnce` don't clash under strict TS.
  let thinned: Uint8Array = edge;
  for (let i = 0; i < thinIterations; i++) {
    thinned = thinOnce(thinned, width, height);
  }

  // Step 6 — pack to RGBA. Edge → black (or white if !invert); non-edge → the
  // opposite. Alpha is always 255 so the downstream parser sees no surprises.
  const out = new ImageData(width, height);
  const o = out.data;
  const fg = invert ? 0 : 255;     // outline color
  const bg = invert ? 255 : 0;     // fillable interior color
  for (let p = 0; p < N; p++) {
    const v = thinned[p] === 1 ? fg : bg;
    const i = p * 4;
    o[i] = v;
    o[i + 1] = v;
    o[i + 2] = v;
    o[i + 3] = 255;
  }
  return out;
}

// Separable Gaussian blur over a Float32 grayscale buffer. Two 1-D passes
// (horizontal into a temp buffer, then vertical back into a result buffer)
// gives O(N·k) instead of O(N·k²) for a k-tap kernel. Edge handling clamps
// the read index so the blur never reads off the image.
function gaussianBlur(
  src: Float32Array,
  width: number,
  height: number,
  sigma: number
): Float32Array {
  const kernel = buildGaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;

  const tmp = new Float32Array(src.length);
  // Horizontal pass: src → tmp
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
  // Vertical pass: tmp → dst
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
  // Truncate at 3σ. For σ=1.4 that's a 9-tap kernel; tiny and fast.
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

// Sobel 3x3 over a Float32 buffer; returns gradient magnitude as Float32 in
// the loose 0..~1020 range (we threshold against an 0..255 cutoff so the
// scale is fine — small JPEG noise sits well under any sensible threshold).
//
// Border pixels get magnitude 0 (one pixel in from each edge). The image
// frame produced by the source-on-white canvas would otherwise show as a hard
// edge along every side; zeroing the border kills that artifact.
function sobelMagnitude(
  src: Float32Array,
  width: number,
  height: number
): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = src[i - width - 1]!;
      const t  = src[i - width]!;
      const tr = src[i - width + 1]!;
      const l  = src[i - 1]!;
      const r  = src[i + 1]!;
      const bl = src[i + width - 1]!;
      const b  = src[i + width]!;
      const br = src[i + width + 1]!;
      // Standard Sobel kernels.
      const gx = -tl - 2 * l - bl + tr + 2 * r + br;
      const gy = -tl - 2 * t - tr + bl + 2 * b + br;
      const a = gx < 0 ? -gx : gx;
      const c = gy < 0 ? -gy : gy;
      out[i] = a + c;
    }
  }
  return out;
}

// Single-pass morphological thinning: strip pixels with too many lit
// neighbors so thick edge bands collapse toward their center. Single-pixel
// strokes (≤2 neighbors) survive untouched; heavy 3-pixel-wide bands shrink.
// Not a true skeletonize — but a true Zhang-Suen would double the file and
// the labeling pass behind us is forgiving enough that this is sufficient.
function thinOnce(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(src);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (src[i] !== 1) continue;
      let n = 0;
      n += src[i - width - 1]!;
      n += src[i - width]!;
      n += src[i - width + 1]!;
      n += src[i - 1]!;
      n += src[i + 1]!;
      n += src[i + width - 1]!;
      n += src[i + width]!;
      n += src[i + width + 1]!;
      if (n >= 6) out[i] = 0;
    }
  }
  return out;
}
