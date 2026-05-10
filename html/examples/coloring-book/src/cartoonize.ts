// Convert a color image (photo, illustration, AI art) into a clean
// black-on-white outline ImageData that the rest of the import pipeline
// (threshold + erode → CC labeling) can swallow as if the user had handed us
// hand-drawn line art.
//
// Three-stage philosophy: blur → quantize → merge-small → trace.
//
//   The earlier version (heavy blur → quantize 4 per channel → boundary trace)
//   produced a noisy mess on portraits: a line on every wrinkle, every fabric
//   crease, every minor shading band. The fix is layered:
//
//     1. HEAVIER BLUR (σ ≈ 6.0). Wash out skin texture, fabric weave, hair
//        strands. The kernel half-width is 3σ ≈ 18 px — wide enough to
//        dissolve a 30-px-wide wrinkle into the surrounding cheek.
//
//     2. COARSER QUANTIZATION, ON LUMA. Convert to luma (Rec. 601) and bin
//        into 3 levels. Throwing away chroma kills the "two same-luminance
//        regions different hue" boundaries that draw lines around every
//        reflection. Three luma bins maps roughly to shadow / mid / highlight
//        — the regions a cartoonist would actually outline. (Fall-back: if
//        useLuma is false, we keep the old per-channel RGB quantization for
//        callers that need hue-driven boundaries.)
//
//     3. MINIMUM-REGION-AREA FILTER. Connected-component label the quantized
//        buffer (4-connected). Any component smaller than `minRegionFraction`
//        of total area gets MERGED INTO ITS LARGEST 4-NEIGHBOR before tracing.
//        This is the single biggest fix: a wrinkle that survives blur+quantize
//        as a 50-pixel sliver gets absorbed into the surrounding face region
//        and never produces an edge. Iterate until no small components remain
//        (capped at 5 passes).
//
//     4. BOUNDARY TRACE on the merged component-ID buffer (NOT against raw
//        quantized colors). Single-side comparison (right and down only) so
//        each boundary is drawn exactly once.
//
//     5. Optional 1-px morphological dilation, 4-connected, for a "drawn"
//        2-px-wide stroke.
//
//     6. Output ImageData: edge → pure black opaque, non-edge → pure white opaque.
//
// WHY this beats Sobel-then-threshold AND beats the old quantize-then-trace:
//
//   Sobel responds to per-pixel intensity gradients. A smooth tonal ramp
//   produces a sea of weak gradients; threshold them and you get a
//   constellation of dots, not a line.
//
//   Quantize-then-trace WITHOUT the merge step still draws every quantization
//   sliver — and at high sigma you get long, smooth slivers that look like
//   lines. The merge pass is what turns "every wrinkle is a line" into "head
//   silhouette + a few major features."
//
// Performance: separable Gaussian (two 1-D passes), typed-array hot loops,
// flat allocations. At σ=6 the kernel is ~37 taps; the blur is the heaviest
// step but still well under a second on modern phones for 2400×2400. The
// connected-component + merge pass is a couple of linear sweeps. Target
// budget: <2.5 s for a 2400×2400 source on Android Chrome (one-time cost at
// import). If this gets blown, the right move is to downscale the source 2×
// for the cartoonize pass — same lines layer, 4× cheaper.

export interface CartoonizeOptions {
  blurSigma?: number;          // gaussian sigma in pixels; default 6.0
  quantizeLevels?: number;     // levels per channel (or luma bins if useLuma); default 3
  useLuma?: boolean;           // quantize on luma instead of per-channel RGB; default true
  minRegionFraction?: number;  // merge components smaller than this fraction of area; default 0.005 (0.5%)
  dilate?: number;             // morphological dilation iterations (line thickness − 1); default 1

  // Deprecated. Old-pipeline knobs; accepted but ignored so callers that were
  // typed against earlier shapes still compile.
  edgeThreshold?: number;
  thinIterations?: number;
  invert?: boolean;
}

const DEFAULTS = {
  blurSigma: 6.0,
  quantizeLevels: 3,
  useLuma: true,
  minRegionFraction: 0.005,
  dilate: 1,
};

export function cartoonizeImageData(
  src: ImageData,
  opts: CartoonizeOptions = {}
): ImageData {
  const blurSigma = opts.blurSigma ?? DEFAULTS.blurSigma;
  const quantizeLevels = Math.max(2, opts.quantizeLevels ?? DEFAULTS.quantizeLevels);
  const useLuma = opts.useLuma ?? DEFAULTS.useLuma;
  const minRegionFraction = Math.max(0, opts.minRegionFraction ?? DEFAULTS.minRegionFraction);
  const dilate = Math.max(0, opts.dilate ?? DEFAULTS.dilate);

  const { width, height, data } = src;
  const N = width * height;

  // Step 1 — blur. Luma path needs one plane; RGB path needs three.
  // Working in float planes keeps the separable convolution clean.
  let id: Uint16Array;
  if (useLuma) {
    const lumaPlane = new Float32Array(N);
    for (let i = 0, j = 0; j < N; i += 4, j++) {
      // Rec. 601 luma. Integer photometric weights would also work, but
      // we already have floats from the blur path so the multiply is free.
      lumaPlane[j] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    }
    const lumaBlur = gaussianBlur(lumaPlane, width, height, blurSigma);

    // Step 2 — quantize luma into N bins of equal width (256 / N).
    // Storing the bin index gives us a single-int-compare boundary check.
    const step = 256 / quantizeLevels;
    id = new Uint16Array(N);
    for (let p = 0; p < N; p++) {
      let v = (lumaBlur[p]! / step) | 0;
      if (v < 0) v = 0;
      else if (v >= quantizeLevels) v = quantizeLevels - 1;
      id[p] = v;
    }
  } else {
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

    // Pack three 4-bit channel bins into one uint16 (works up to 16 levels).
    const step = 256 / quantizeLevels;
    id = new Uint16Array(N);
    for (let p = 0; p < N; p++) {
      let r = (rBlur[p]! / step) | 0;
      let g = (gBlur[p]! / step) | 0;
      let b = (bBlur[p]! / step) | 0;
      if (r >= quantizeLevels) r = quantizeLevels - 1;
      if (g >= quantizeLevels) g = quantizeLevels - 1;
      if (b >= quantizeLevels) b = quantizeLevels - 1;
      id[p] = (r << 8) | (g << 4) | b;
    }
  }

  // Step 3 — connected-component label, then merge components smaller than
  // minSize into their largest neighbor. Iterate because merging can leave
  // a chain of thin slivers that only collapses across multiple passes.
  const minSize = Math.max(50, Math.floor(N * minRegionFraction));
  const labels = mergeSmallRegions(id, width, height, minSize, 5);

  // Step 4 — boundary trace on the merged label buffer. Compare each pixel
  // to its right and down neighbor only — single-side guarantees a 1-px line.
  let edge: Uint8Array = new Uint8Array(N);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = labels[i]!;
      if (x + 1 < width && labels[i + 1]! !== c) {
        edge[i] = 1;
        continue;
      }
      if (y + 1 < height && labels[i + width]! !== c) {
        edge[i] = 1;
      }
    }
  }

  // Step 5 — optional 4-connected dilation for thicker strokes.
  for (let d = 0; d < dilate; d++) {
    edge = dilate4(edge, width, height);
  }

  // Step 6 — pack to RGBA. Edge → black, non-edge → white. Alpha 255.
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

// 4-connected connected-component labeling using iterative stack flood fill.
// `id` is the per-pixel quantized region ID; pixels share a component iff
// they're 4-adjacent and have the same id. Returns a fresh Int32Array of
// component labels (0..numComponents-1) and a parallel array of component
// sizes. We use Int32 for labels because component count can exceed 65k on
// a noisy 2400×2400 (worst-case ≈ N).
function labelComponents(
  id: Uint16Array,
  width: number,
  height: number
): { labels: Int32Array; sizes: number[] } {
  const N = width * height;
  const labels = new Int32Array(N);
  labels.fill(-1);
  const sizes: number[] = [];
  // Reusable stack for the flood fill. Worst case it grows to N, but in
  // practice it tracks the perimeter of the current component.
  const stack = new Int32Array(N);

  let nextLabel = 0;
  for (let seed = 0; seed < N; seed++) {
    if (labels[seed] !== -1) continue;
    const seedId = id[seed]!;
    const label = nextLabel++;
    let size = 0;
    let sp = 0;
    stack[sp++] = seed;
    labels[seed] = label;
    while (sp > 0) {
      const p = stack[--sp]!;
      size++;
      const x = p % width;
      const y = (p / width) | 0;
      // West
      if (x > 0) {
        const q = p - 1;
        if (labels[q] === -1 && id[q] === seedId) {
          labels[q] = label;
          stack[sp++] = q;
        }
      }
      // East
      if (x + 1 < width) {
        const q = p + 1;
        if (labels[q] === -1 && id[q] === seedId) {
          labels[q] = label;
          stack[sp++] = q;
        }
      }
      // North
      if (y > 0) {
        const q = p - width;
        if (labels[q] === -1 && id[q] === seedId) {
          labels[q] = label;
          stack[sp++] = q;
        }
      }
      // South
      if (y + 1 < height) {
        const q = p + width;
        if (labels[q] === -1 && id[q] === seedId) {
          labels[q] = label;
          stack[sp++] = q;
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

// Iteratively merge any component smaller than minSize into the neighboring
// component (4-connected) that shares the most border with it. After each
// pass we relabel; we cap at maxPasses to avoid pathological inputs.
//
// Returns a label buffer where every label is "large enough" — that buffer is
// what the boundary trace operates on. Crucially, the SAME quantized id can
// span multiple merged labels (two cheek regions at id=mid stay separate if
// they're not 4-connected through mid pixels), and DIFFERENT quantized ids
// can collapse to the SAME label (a wrinkle sliver merges into the cheek).
function mergeSmallRegions(
  id: Uint16Array,
  width: number,
  height: number,
  minSize: number,
  maxPasses: number
): Int32Array {
  const N = width * height;
  // Keep a writable copy of `id` so we can rewrite small components into the
  // id of their dominant neighbor, then re-label on the next pass.
  const work = new Uint16Array(N);
  work.set(id);

  for (let pass = 0; pass < maxPasses; pass++) {
    const { labels, sizes } = labelComponents(work, width, height);
    const numComponents = sizes.length;

    // Bucket every pixel by label in one O(N) sweep, so each component's
    // pixels are contiguous in `pixelOfLabel` from `labelStart[lab]` to
    // `labelStart[lab+1]`. This is what keeps the per-pass work O(N) total
    // even when there are thousands of small components — without it, each
    // small component would re-scan the whole image.
    const labelStart = new Int32Array(numComponents + 1);
    for (let p = 0; p < N; p++) {
      const idx = labels[p]! + 1;
      labelStart[idx] = labelStart[idx]! + 1;
    }
    for (let i = 1; i <= numComponents; i++) {
      labelStart[i] = labelStart[i]! + labelStart[i - 1]!;
    }
    const cursor = new Int32Array(numComponents);
    const pixelOfLabel = new Int32Array(N);
    for (let p = 0; p < N; p++) {
      const lab = labels[p]!;
      pixelOfLabel[labelStart[lab]! + cursor[lab]!] = p;
      cursor[lab] = cursor[lab]! + 1;
    }

    // For each small component, count which neighboring component shares the
    // longest 4-border with it. We use a single Map keyed by label and clear
    // it between components.
    const neighborCount = new Map<number, number>();
    let merged = 0;

    // Component label → its current quantized id. Read from any one pixel of
    // the component; bucketing makes that the first entry in its run.
    const labelToId = new Uint16Array(numComponents);
    for (let lab = 0; lab < numComponents; lab++) {
      labelToId[lab] = work[pixelOfLabel[labelStart[lab]!]!]!;
    }

    for (let lab = 0; lab < numComponents; lab++) {
      if (sizes[lab]! >= minSize) continue;

      neighborCount.clear();
      const start = labelStart[lab]!;
      const end = labelStart[lab + 1]!;
      for (let k = start; k < end; k++) {
        const p = pixelOfLabel[k]!;
        const x = p % width;
        const y = (p / width) | 0;
        if (x > 0) {
          const nl = labels[p - 1]!;
          if (nl !== lab) neighborCount.set(nl, (neighborCount.get(nl) ?? 0) + 1);
        }
        if (x + 1 < width) {
          const nl = labels[p + 1]!;
          if (nl !== lab) neighborCount.set(nl, (neighborCount.get(nl) ?? 0) + 1);
        }
        if (y > 0) {
          const nl = labels[p - width]!;
          if (nl !== lab) neighborCount.set(nl, (neighborCount.get(nl) ?? 0) + 1);
        }
        if (y + 1 < height) {
          const nl = labels[p + width]!;
          if (nl !== lab) neighborCount.set(nl, (neighborCount.get(nl) ?? 0) + 1);
        }
      }

      if (neighborCount.size === 0) continue; // image-wide single component

      let bestLabel = -1;
      let bestCount = -1;
      for (const [k, v] of neighborCount) {
        if (v > bestCount) {
          bestCount = v;
          bestLabel = k;
        }
      }
      if (bestLabel < 0) continue;

      const newId = labelToId[bestLabel]!;
      // Rewrite all pixels of this small component to the winner's id.
      // The next pass's labelComponents will see them as part of the
      // neighbor's component (or, if the neighbor was itself small and got
      // merged this pass too, a later pass keeps collapsing).
      for (let k = start; k < end; k++) work[pixelOfLabel[k]!] = newId;
      merged++;
    }

    if (merged === 0) {
      return labels;
    }
  }

  // Final relabel after the last merging pass.
  return labelComponents(work, width, height).labels;
}

// Separable Gaussian blur over a Float32 plane. Two 1-D passes
// (horizontal into a temp buffer, then vertical into the result) gives
// O(N·k) instead of O(N·k²) for a k-tap kernel. Edges clamp.
//
// At very high sigma, three sequential blurs of σ' = σ/√3 give the same
// result as one blur of σ (Gaussians are associative under convolution:
// σ_total² = Σ σᵢ²) and are cheaper because each kernel is 1/√3 the width.
// We don't bother for σ≤8 — the win is small and the code is simpler.
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
  // Truncate at 3σ. For σ=6 that's a 37-tap kernel.
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
