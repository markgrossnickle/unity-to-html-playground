// Convert a color image (photo, illustration, AI art) into a clean
// black-on-white outline ImageData that the rest of the import pipeline
// (threshold + erode → CC labeling) can swallow as if the user had handed us
// hand-drawn line art.
//
// Pipeline: bilateral filter → Sobel gradient → non-max suppression → double
// threshold + hysteresis → optional dilation. This is the classic Canny
// edge-detection sequence with a bilateral pre-filter instead of a Gaussian.
// It's what every "photo to pencil sketch" filter does, and there's a reason:
// the parts work well together.
//
// WHY THIS PIPELINE (and what previous iterations got wrong)
//
//   v2 (Sobel + threshold) produced dotty speckle: a pure Sobel response on
//   photo input is a constellation of weak gradients across every shaded
//   surface. Thresholding that gives you noise, not lines.
//
//   v3 (Gaussian blur + luma posterize + region merge + boundary trace) was
//   better but still drew lines on every wrinkle and shading band, while
//   sometimes missing the silhouette entirely. The fundamental problem with
//   Gaussian + posterize is that Gaussian blurs *everything* uniformly —
//   including the strong edges we want to keep — and posterize quantizes
//   brightness without regard for spatial context, so a smooth tonal ramp
//   that crosses a bin boundary becomes a long sliver "edge."
//
//   This iteration (bilateral + Canny) addresses both halves of that:
//
//     1. BILATERAL FILTER replaces Gaussian. Bilateral smooths flat regions
//        (skin, sky, fabric) while preserving strong edges (silhouette, eye
//        boundary, mouth line). It does this by weighting each neighbor by
//        BOTH spatial distance AND intensity similarity — neighbors whose
//        intensity differs by more than ~rangeSigma contribute almost nothing
//        to the average. The strong edges we want survive the smoothing pass;
//        the texture we don't want gets washed out.
//
//     2. CANNY replaces posterize-and-trace. Canny is a four-step recipe
//        designed specifically to produce thin, connected outlines:
//          a) Sobel gradient magnitude AND direction.
//          b) Non-max suppression: at each pixel, keep magnitude only if it's
//             the local max along the gradient direction. This thins ridges
//             from "fat blob of high gradient" to "1 px line down the middle."
//          c) Double threshold: pixels above highThreshold are STRONG, pixels
//             above lowThreshold are WEAK. Strong always pass; weak pass only
//             if 8-connected to a strong (hysteresis).
//          d) Hysteresis: BFS from strong seeds through weak pixels.
//        The result is connected lines with their endpoints intact and no
//        floating noise speckles.
//
// PERFORMANCE
//
//   Bilateral is O(N · windowArea). At spatialSigma=3 the window is 13×13 =
//   169 ops per pixel; on a 2400×2400 source that's ~970M multiply-adds. In
//   pure JS hot loops this is the most expensive step — expect 1–3 s on a
//   modern phone. Acceptable for a one-time import. The spatial Gaussian
//   weights are precomputed once and indexed in the inner loop, which is the
//   main optimization that keeps this practical without going to a separable
//   approximation or a grid-based bilateral. Canny itself is O(N).
//
// EDGE CASES NOTE
//
//   The default thresholds (low=30, high=80) are calibrated for typical
//   photo input on the [0,255] gradient scale that 8-bit Sobel produces. They
//   are intentionally permissive — the existing downstream pipeline
//   (threshold + erode + CC labeling) tolerates a few extra edge pixels far
//   better than it tolerates missing the silhouette.

export interface CartoonizeOptions {
  spatialSigma?: number;   // bilateral spatial Gaussian σ in px; default 3
  rangeSigma?: number;     // bilateral intensity-range σ in [0,255]; default 25
  lowThreshold?: number;   // Canny weak-edge threshold; default 30
  highThreshold?: number;  // Canny strong-edge threshold; default 80
  dilate?: number;         // post-Canny dilation iterations (line thickness − 1); default 1

  // Deprecated / legacy. Earlier pipelines exposed these knobs; we accept them
  // so callers typed against older shapes still compile, but they are no-ops.
  blurSigma?: number;
  quantizeLevels?: number;
  useLuma?: boolean;
  minRegionFraction?: number;
  edgeThreshold?: number;
  thinIterations?: number;
  invert?: boolean;
}

const DEFAULTS = {
  spatialSigma: 3,
  rangeSigma: 25,
  lowThreshold: 30,
  highThreshold: 80,
  dilate: 1,
};

export function cartoonizeImageData(
  src: ImageData,
  opts: CartoonizeOptions = {}
): ImageData {
  const spatialSigma = Math.max(0.5, opts.spatialSigma ?? DEFAULTS.spatialSigma);
  const rangeSigma = Math.max(1, opts.rangeSigma ?? DEFAULTS.rangeSigma);
  const lowThreshold = Math.max(0, opts.lowThreshold ?? DEFAULTS.lowThreshold);
  const highThreshold = Math.max(lowThreshold, opts.highThreshold ?? DEFAULTS.highThreshold);
  const dilate = Math.max(0, opts.dilate ?? DEFAULTS.dilate);

  const { width, height, data } = src;
  const N = width * height;

  // Step 1 — RGBA → grayscale luma (Rec. 601). Canny is a luminance operator;
  // we throw chroma away so two regions of equal brightness but different hue
  // (a common source of spurious "edges" around saturated colors) don't draw
  // a line. Working in Float32 keeps the bilateral and Sobel passes precise.
  const gray = new Float32Array(N);
  for (let i = 0, j = 0; j < N; i += 4, j++) {
    gray[j] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  }

  // Step 2 — bilateral filter. Edge-preserving smoothing. See bilateralFilter
  // for the per-pixel math; the takeaway is that flat regions get blurred
  // away while strong edges stay sharp, which is exactly what Canny needs.
  const smoothed = bilateralFilter(gray, width, height, spatialSigma, rangeSigma);

  // Step 3 — Sobel gradient. We need both magnitude (how strong is the edge?)
  // and direction (which way does brightness change?) because non-max
  // suppression compares each pixel to neighbors *along* the gradient
  // direction, not to all 8 neighbors.
  const { mag, dir } = sobelGradient(smoothed, width, height);

  // Step 4 — non-max suppression. Thins gradient ridges to a single pixel
  // wide by keeping a pixel's magnitude only if it's a local max along the
  // gradient direction. Without this step a "strong edge" is a 3–5 px wide
  // band of high gradient, which would hysterese into a fat blob.
  const thinned = nonMaxSuppression(mag, dir, width, height);

  // Step 5 — double threshold + hysteresis. Pixels above highThreshold seed
  // the edge map; pixels above lowThreshold are pulled in only if they're
  // connected (8-way) to a seed. This is what kills isolated high-frequency
  // noise spots: a lone weak gradient with no strong neighbor disappears.
  let edges = hysteresis(thinned, width, height, lowThreshold, highThreshold);

  // Step 6 — optional dilation. Canny output is exactly 1 px wide, which can
  // alias on screen. One round of 4-connected dilation gives a 2-px stroke
  // that reads better and matches what hand-drawn line art tends to look like.
  for (let d = 0; d < dilate; d++) {
    edges = dilate4(edges, width, height);
  }

  // Step 7 — pack to RGBA. Edge → black, non-edge → white. Alpha 255.
  const out = new ImageData(width, height);
  const o = out.data;
  for (let p = 0; p < N; p++) {
    const v = edges[p] === 1 ? 0 : 255;
    const i = p * 4;
    o[i] = v;
    o[i + 1] = v;
    o[i + 2] = v;
    o[i + 3] = 255;
  }
  return out;
}

// Bilateral filter on a single Float32 plane.
//
// For each output pixel we average a square window of neighbors, weighting
// each neighbor by the product of two Gaussians:
//
//   spatial weight = exp(-(dx² + dy²) / (2σ_s²))   — falls off with distance
//   range weight   = exp(-ΔI² / (2σ_r²))           — falls off with intensity gap
//
// The range weight is the magic ingredient. A neighbor on the far side of a
// strong edge has ΔI ≫ σ_r and contributes almost nothing to the average, so
// the smoothed value at the current pixel reflects only neighbors on its own
// side of the edge. Edges are preserved; flats are smoothed.
//
// Window half-size = 2·σ_s rather than the usual 3·σ_s. We're saving a chunk
// of inner-loop work (a 13×13 kernel instead of 19×19) and the truncation
// error from the tail of the spatial Gaussian is negligible — the range
// weight typically dominates at the kernel edge anyway.
//
// Performance note: the spatial weights depend only on (dx, dy), not on the
// image, so we precompute them once into a flat array. The range weight has
// to be recomputed per pair (it depends on ΔI), but it's a single exp() per
// neighbor with no allocation. Border handling: clamp to the inside of the
// image (mirror / wrap would be slightly more correct but no human will see
// the difference at the 6-pixel border).
function bilateralFilter(
  src: Float32Array,
  width: number,
  height: number,
  spatialSigma: number,
  rangeSigma: number
): Float32Array {
  const halfSize = Math.max(1, Math.ceil(spatialSigma * 2));
  const kernelSize = halfSize * 2 + 1;

  // Precompute spatial Gaussian weights into a flat (kernelSize × kernelSize)
  // array indexed as [(dy + halfSize) * kernelSize + (dx + halfSize)].
  const spatialKernel = new Float32Array(kernelSize * kernelSize);
  const inv2SpatialSigma2 = 1 / (2 * spatialSigma * spatialSigma);
  for (let dy = -halfSize; dy <= halfSize; dy++) {
    for (let dx = -halfSize; dx <= halfSize; dx++) {
      spatialKernel[(dy + halfSize) * kernelSize + (dx + halfSize)] =
        Math.exp(-(dx * dx + dy * dy) * inv2SpatialSigma2);
    }
  }

  const inv2RangeSigma2 = 1 / (2 * rangeSigma * rangeSigma);
  const dst = new Float32Array(src.length);

  for (let y = 0; y < height; y++) {
    const yMin = Math.max(0, y - halfSize);
    const yMax = Math.min(height - 1, y + halfSize);
    for (let x = 0; x < width; x++) {
      const center = src[y * width + x]!;
      const xMin = Math.max(0, x - halfSize);
      const xMax = Math.min(width - 1, x + halfSize);
      let sum = 0;
      let weightSum = 0;
      for (let yy = yMin; yy <= yMax; yy++) {
        const dy = yy - y;
        const krow = (dy + halfSize) * kernelSize + halfSize;
        const srow = yy * width;
        for (let xx = xMin; xx <= xMax; xx++) {
          const dx = xx - x;
          const neighbor = src[srow + xx]!;
          const di = center - neighbor;
          const w = spatialKernel[krow + dx]! * Math.exp(-di * di * inv2RangeSigma2);
          sum += w * neighbor;
          weightSum += w;
        }
      }
      dst[y * width + x] = sum / weightSum;
    }
  }

  return dst;
}

// Sobel 3×3 gradient. Returns magnitude and direction quantized to 4 bins:
//
//   bin 0 → gradient ≈ horizontal (E–W), edge runs vertically (N–S neighbors)
//   bin 1 → gradient ≈ NE–SW          , edge runs NW–SE
//   bin 2 → gradient ≈ vertical (N–S) , edge runs horizontally (E–W neighbors)
//   bin 3 → gradient ≈ NW–SE          , edge runs NE–SW
//
// Why 4 bins and not 8: gradient direction has 180° symmetry (going from
// dark→light is the same edge as light→dark), so we only care about the line
// direction, which lives in [0°, 180°). Splitting into four 45° bins gives us
// the coarse "which two neighbors do I compare to" answer that NMS needs.
//
// The 1-pixel border is left at zero — Sobel needs a 3×3 neighborhood and
// downstream NMS skips the border anyway, so we don't lose anything.
function sobelGradient(
  src: Float32Array,
  width: number,
  height: number
): { mag: Float32Array; dir: Uint8Array } {
  const N = width * height;
  const mag = new Float32Array(N);
  const dir = new Uint8Array(N);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const nw = src[i - width - 1]!;
      const n  = src[i - width]!;
      const ne = src[i - width + 1]!;
      const w  = src[i - 1]!;
      const e  = src[i + 1]!;
      const sw = src[i + width - 1]!;
      const s  = src[i + width]!;
      const se = src[i + width + 1]!;

      // Sobel X: detects horizontal gradient (vertical edges).
      const gx = -nw + ne - 2 * w + 2 * e - sw + se;
      // Sobel Y: detects vertical gradient (horizontal edges).
      const gy = -nw - 2 * n - ne + sw + 2 * s + se;

      mag[i] = Math.sqrt(gx * gx + gy * gy);

      // Quantize gradient angle to 4 bins. atan2 gives [-π, π]; we fold into
      // [0, π) because direction is symmetric, then split into 45° buckets
      // centered on 0°, 45°, 90°, 135°.
      let a = Math.atan2(gy, gx);
      if (a < 0) a += Math.PI;
      const deg = a * (180 / Math.PI);
      let bin: number;
      if (deg < 22.5 || deg >= 157.5) bin = 0;        // ~0°  (horizontal gradient)
      else if (deg < 67.5)            bin = 1;        // ~45°
      else if (deg < 112.5)           bin = 2;        // ~90° (vertical gradient)
      else                            bin = 3;        // ~135°
      dir[i] = bin;
    }
  }

  return { mag, dir };
}

// Non-maximum suppression along the gradient direction.
//
// For each pixel, look at its two neighbors along the gradient direction (NOT
// the edge direction) and keep this pixel's magnitude only if it's >= both.
// That collapses a fat ridge of high gradient into a single-pixel-wide line
// running perpendicular to the gradient.
//
// We use ≥ rather than > so that a perfectly flat ridge (two equal neighbors)
// still survives. It produces 2-px-wide artifacts in rare edge cases but
// avoids the much worse failure of erasing a clean straight line entirely.
function nonMaxSuppression(
  mag: Float32Array,
  dir: Uint8Array,
  width: number,
  height: number
): Float32Array {
  const N = width * height;
  const out = new Float32Array(N);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const m = mag[i]!;
      if (m === 0) continue;
      let n1 = 0, n2 = 0;
      switch (dir[i]) {
        case 0: // horizontal gradient → compare to W and E
          n1 = mag[i - 1]!;
          n2 = mag[i + 1]!;
          break;
        case 1: // NE-SW gradient → compare to NE and SW
          n1 = mag[i - width + 1]!;
          n2 = mag[i + width - 1]!;
          break;
        case 2: // vertical gradient → compare to N and S
          n1 = mag[i - width]!;
          n2 = mag[i + width]!;
          break;
        case 3: // NW-SE gradient → compare to NW and SE
          n1 = mag[i - width - 1]!;
          n2 = mag[i + width + 1]!;
          break;
      }
      if (m >= n1 && m >= n2) out[i] = m;
    }
  }

  return out;
}

// Double threshold + hysteresis. Two-pass:
//   Pass 1: every pixel with magnitude ≥ highThreshold becomes a strong edge
//           and gets pushed onto the BFS stack.
//   Pass 2: BFS through 8-connected neighbors, promoting any unset pixel
//           whose magnitude is ≥ lowThreshold. This is what propagates a
//           confident edge along its weaker tail without admitting isolated
//           weak gradients elsewhere.
//
// Output is a {0, 1} mask. The stack is a flat Int32Array sized to N — the
// worst case is "every pixel is an edge," which is fine; in practice it
// stays small because most pixels are below lowThreshold.
function hysteresis(
  mag: Float32Array,
  width: number,
  height: number,
  low: number,
  high: number
): Uint8Array {
  const N = width * height;
  const out = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;

  for (let i = 0; i < N; i++) {
    if (mag[i]! >= high) {
      out[i] = 1;
      stack[sp++] = i;
    }
  }

  while (sp > 0) {
    const p = stack[--sp]!;
    const x = p % width;
    const y = (p / width) | 0;
    const xMin = x > 0 ? -1 : 0;
    const xMax = x + 1 < width ? 1 : 0;
    const yMin = y > 0 ? -1 : 0;
    const yMax = y + 1 < height ? 1 : 0;
    for (let dy = yMin; dy <= yMax; dy++) {
      const row = (y + dy) * width;
      for (let dx = xMin; dx <= xMax; dx++) {
        if (dx === 0 && dy === 0) continue;
        const q = row + (x + dx);
        if (out[q] === 0 && mag[q]! >= low) {
          out[q] = 1;
          stack[sp++] = q;
        }
      }
    }
  }

  return out;
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
