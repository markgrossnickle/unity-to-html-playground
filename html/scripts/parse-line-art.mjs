// Auto-parse a B&W line-art PNG into the lines+labels PNG pair the
// coloring-book runtime understands.
//
// Pipeline:
//   1. Read input → grayscale.
//   2. Threshold (pixels darker than --threshold → outline; lighter → fillable).
//   3. Optional erode pass: any fillable pixel adjacent to an outline pixel
//      becomes outline. Repeated --erode times. This absorbs antialiased
//      outline edges so colors don't leak across them.
//   4. Connected-component label (4-connectivity, two-pass union-find) over
//      the fillable pixels.
//   5. Drop components smaller than --min-region pixels → reassigned to
//      OUTLINE (alpha=0 in the labels image). Outline-reassignment was chosen
//      because nearest-region merging would silently change region shapes
//      based on labeling order; turning specks into outline is visually
//      indistinguishable (the lines layer covers them) and keeps the contract
//      "every region has size >= min-region".
//   6. Pick the background: the largest fillable component touching the
//      image border. Assigned id 255 (the runtime's reserved background id).
//   7. Remaining components → ids 1..254 in size-descending order.
//      Components beyond 254 are demoted to outline.
//   8. Emit:
//        <slug>_lines.png  — transparent PNG, black where outline.
//        <slug>_labels.png — RGBA: R=region id, alpha=255 inside a region,
//                            alpha=0 elsewhere. No antialiasing.
//
// CLI:
//   node scripts/parse-line-art.mjs \
//       --in path/to/line-art.png \
//       --out-dir examples/coloring-book/assets \
//       --slug myslug \
//       [--threshold 128] [--min-region 50] [--erode 1]

import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// id 255 is reserved by the coloring-book runtime as the auto-background.
// LabelMap.ts samples the R channel; 255 is the largest single-byte id.
const BACKGROUND_ID = 255;
const MAX_REGION_ID = 254; // 1..254 for foreground regions

function parseArgs(argv) {
  const args = {
    in: null,
    outDir: null,
    slug: null,
    threshold: 128,
    minRegion: 50,
    erode: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--in":
        args.in = next();
        break;
      case "--out-dir":
        args.outDir = next();
        break;
      case "--slug":
        args.slug = next();
        break;
      case "--threshold":
        args.threshold = Number(next());
        break;
      case "--min-region":
        args.minRegion = Number(next());
        break;
      case "--erode":
        args.erode = Number(next());
        break;
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!args.in || !args.outDir || !args.slug)
    throw new Error("required: --in <path> --out-dir <dir> --slug <name>");
  return args;
}

// Read PNG → { width, height, gray: Uint8Array (W*H, 0..255) }.
async function readGrayscale(inPath) {
  const img = sharp(inPath).removeAlpha().grayscale();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  // grayscale().raw() returns 1 channel per pixel.
  if (info.channels !== 1)
    throw new Error(`expected 1 channel after grayscale, got ${info.channels}`);
  return { width: info.width, height: info.height, gray: data };
}

// Threshold to a Uint8Array of 0=fillable / 1=outline.
function threshold(gray, t) {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] < t ? 1 : 0;
  return out;
}

// One erode pass: any 0 (fillable) adjacent to a 1 (outline) becomes 1.
// Implemented in plain JS over the byte buffer; one pass is O(W*H), and we
// use a separate read/write buffer per iteration so neighbor checks see the
// previous iteration's state (otherwise erosion would cascade unboundedly
// across a single pass).
function erodeOnce(mask, width, height) {
  const out = new Uint8Array(mask); // copy
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] === 1) continue; // already outline
      // 4-connectivity neighbor check
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

function erode(mask, width, height, n) {
  let m = mask;
  for (let i = 0; i < n; i++) m = erodeOnce(m, width, height);
  return m;
}

// Two-pass connected-component labeling (4-connectivity, union-find).
// mask: 0=fillable / 1=outline. Returns:
//   labels: Int32Array (W*H) — 0 for outline, 1..N for component ids
//   sizes:  Map<id, pixelCount>
//   touchesBorder: Set<id>
function labelComponents(mask, width, height) {
  const N = width * height;
  const labels = new Int32Array(N);
  // Union-find — parent[0] unused; we grow as we allocate new labels.
  const parent = [0];
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]; // path compression (one step)
      a = parent[a];
    }
    return a;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra > rb ? ra : rb] = ra > rb ? rb : ra;
  };

  // Pass 1: assign provisional labels.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] === 1) continue;
      const w = x > 0 ? labels[i - 1] : 0;
      const n = y > 0 ? labels[i - width] : 0;
      if (w === 0 && n === 0) {
        const id = parent.length;
        parent.push(id);
        labels[i] = id;
      } else if (w !== 0 && n !== 0) {
        const m = w < n ? w : n;
        labels[i] = m;
        if (w !== n) union(w, n);
      } else {
        labels[i] = w !== 0 ? w : n;
      }
    }
  }

  // Pass 2: relabel to root + collect sizes + border-touching set.
  const sizes = new Map();
  const touchesBorder = new Set();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (labels[i] === 0) continue;
      const root = find(labels[i]);
      labels[i] = root;
      sizes.set(root, (sizes.get(root) || 0) + 1);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
        touchesBorder.add(root);
    }
  }
  return { labels, sizes, touchesBorder };
}

// Drop components smaller than minSize: rewrite their pixels to 0 (outline)
// in `labels`. Returns dropped count.
function dropTinyComponents(labels, sizes, minSize) {
  let dropped = 0;
  const keep = new Set();
  for (const [id, sz] of sizes) {
    if (sz < minSize) dropped++;
    else keep.add(id);
  }
  if (dropped === 0) return 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== 0 && !keep.has(labels[i])) labels[i] = 0;
  }
  for (const [id, sz] of sizes) if (sz < minSize) sizes.delete(id);
  return dropped;
}

// Pick the background: the largest size-touching-border component. Returns
// its raw label id, or null if no component touches the border (degenerate
// input — every region is enclosed somehow).
function pickBackground(sizes, touchesBorder) {
  let best = null;
  let bestSize = 0;
  for (const id of touchesBorder) {
    const sz = sizes.get(id) || 0;
    if (sz > bestSize) {
      bestSize = sz;
      best = id;
    }
  }
  return best;
}

// Build the raw-label-id → final-id map. Background → 255. Other regions →
// 1..MAX_REGION_ID in size-descending order. Anything beyond the cap is
// mapped to 0 (outline).
function assignFinalIds(sizes, backgroundRaw) {
  const idMap = new Map();
  if (backgroundRaw !== null) idMap.set(backgroundRaw, BACKGROUND_ID);
  const others = [];
  for (const [id, sz] of sizes) {
    if (id === backgroundRaw) continue;
    others.push([id, sz]);
  }
  others.sort((a, b) => b[1] - a[1]);
  let next = 1;
  let demoted = 0;
  for (const [id] of others) {
    if (next > MAX_REGION_ID) {
      idMap.set(id, 0);
      demoted++;
      continue;
    }
    idMap.set(id, next++);
  }
  return { idMap, demoted };
}

// Assemble the lines RGBA buffer: black where mask=1, transparent elsewhere.
function buildLinesRGBA(mask, width, height) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    if (mask[i] === 1) {
      buf[o] = 0;
      buf[o + 1] = 0;
      buf[o + 2] = 0;
      buf[o + 3] = 255;
    } // else stays 0,0,0,0
  }
  return buf;
}

// Assemble the labels RGBA buffer: R = final id, A=255 for region pixels;
// fully transparent for outline pixels (label=0). G/B left at 0.
function buildLabelsRGBA(labels, idMap, width, height) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < labels.length; i++) {
    const raw = labels[i];
    if (raw === 0) continue; // outline → transparent (0,0,0,0)
    const finalId = idMap.get(raw);
    if (!finalId) continue; // demoted-to-outline
    const o = i * 4;
    buf[o] = finalId;
    buf[o + 1] = 0;
    buf[o + 2] = 0;
    buf[o + 3] = 255;
  }
  return buf;
}

async function writePng(rgba, width, height, outPath) {
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

export async function parseLineArt(opts) {
  const { width, height, gray } = await readGrayscale(opts.in);
  let mask = threshold(gray, opts.threshold);
  if (opts.erode > 0) mask = erode(mask, width, height, opts.erode);

  const { labels, sizes, touchesBorder } = labelComponents(mask, width, height);
  const dropped = dropTinyComponents(labels, sizes, opts.minRegion);

  // Recompute touchesBorder against the surviving sizes only (a dropped
  // component might have been the only border-toucher, in which case we
  // fall through to "no background").
  const survivingBorder = new Set();
  for (const id of touchesBorder) if (sizes.has(id)) survivingBorder.add(id);

  const backgroundRaw = pickBackground(sizes, survivingBorder);
  const { idMap, demoted } = assignFinalIds(sizes, backgroundRaw);

  // Repaint the lines mask: include the (possibly eroded) outline mask, plus
  // any pixel whose component was dropped/demoted (so the outline image
  // visually accounts for it).
  const linesMask = new Uint8Array(mask);
  for (let i = 0; i < labels.length; i++) {
    const raw = labels[i];
    if (raw !== 0) {
      const finalId = idMap.get(raw);
      if (!finalId) linesMask[i] = 1; // dropped/demoted → outline
    }
  }

  const linesRGBA = buildLinesRGBA(linesMask, width, height);
  const labelsRGBA = buildLabelsRGBA(labels, idMap, width, height);

  mkdirSync(opts.outDir, { recursive: true });
  const linesPath = resolve(opts.outDir, `${opts.slug}_lines.png`);
  const labelsPath = resolve(opts.outDir, `${opts.slug}_labels.png`);
  await writePng(linesRGBA, width, height, linesPath);
  await writePng(labelsRGBA, width, height, labelsPath);

  const bgSize = backgroundRaw !== null ? sizes.get(backgroundRaw) : 0;
  const regionCount = idMap.size - (backgroundRaw !== null ? 1 : 0);
  return {
    width,
    height,
    regionCount,
    droppedTiny: dropped,
    demoted,
    backgroundSize: bgSize,
    linesPath,
    labelsPath,
  };
}

// Run as CLI when invoked directly.
const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const opts = {
    in: resolve(process.cwd(), args.in),
    outDir: resolve(process.cwd(), args.outDir),
    slug: args.slug,
    threshold: args.threshold,
    minRegion: args.minRegion,
    erode: args.erode,
  };
  parseLineArt(opts).then((r) => {
    console.log(
      `[${args.slug}] parsed ${r.regionCount} regions, dropped ${r.droppedTiny} tiny ones` +
        (r.demoted ? `, demoted ${r.demoted} (>254 cap)` : "") +
        `, background size = ${r.backgroundSize} pixels`
    );
    console.log(`  → ${r.linesPath}`);
    console.log(`  → ${r.labelsPath}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
