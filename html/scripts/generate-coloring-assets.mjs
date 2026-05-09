// Generates the line-art + label-map PNG pairs for the coloring-book example.
//
// For each picture <slug> we emit:
//   examples/coloring-book/assets/<slug>_lines.png
//       Black outlines on transparent background. Drawn on top of the fill canvas
//       at runtime; this is the only visible layer of the source artwork.
//
//   examples/coloring-book/assets/<slug>_labels.png
//       Each colorable region painted a unique flat RGB ID — the region's numeric
//       id (1..N) goes in the R channel; alpha is 255 inside a region and 0
//       outside. NO antialiasing — a single pixel must map to exactly one region.
//       This image is never displayed; it's loaded into an off-screen ImageData
//       at runtime and sampled at the tap point to convert (x,y) → regionId.
//
// ---- Overlap-aware region authoring ----
//
// The label map is assembled in two passes. Pass 1: each *source shape* (one
// fillEllipse, fillPolygon, paintShape, …) gets a unique BIT INDEX — drawing
// ORs that bit into a 32-bit-per-pixel buffer instead of overwriting an id.
// Pass 2: walk the buffer, collect every distinct non-zero bitmask, and
// assign each one a sequential region id (1..254, skipping 255 which the
// background pass reserves).
//
// Why bitmasks? When two shapes overlap, the overlap zone is its own
// region — naturally distinct from either source. A flower with overlapping
// petals gets lens-shaped sub-regions you can fill independently; fish
// scales get crescent intersections. Under the old approach (write the id
// directly), the overlap pixels just took on whichever shape was drawn last.
//
// Constraints:
//   * 30 source-shape bits per subject (32-bit int, with a couple to spare).
//     If a subject ever needs more, split it into "shape groups": shapes
//     within a group still overwrite each other, but groups can overlap
//     each other to form intersection regions. (Not needed today — the
//     biggest subject, mermaid, has 18 shapes.)
//   * Region id 255 is reserved for the auto-added background. Pictures
//     with > 254 distinct overlap masks would overflow; current art is far
//     from that ceiling.
//
// Subjects (regions are dynamic now — counts include overlap sub-regions):
//   apple    — body, stem, leaf, highlight (lens on body)             (~5 regions)
//   house    — sky, walls, roof, door, two windows                    (~6 regions)
//   star     — five outer points + center pentagon (no overlap)       (6 regions)
//   cat      — body, head, two ears, two eyes, nose, tail             (~10 regions)
//   fish     — body, fins, eye, ROW OF OVERLAPPING SCALES             (~15 regions)
//   balloon  — sky, three balloon stripes, basket                     (~5 regions)
//   cupcake  — three frosting layers, wrapper, cherry                 (~8 regions)
//   robot    — body, two arms, head, two eyes, antenna ball           (~8 regions)
//   sailboat — sky, water, hull, two sails, sun                       (~7 regions)
//   flower   — stem, leaf, FIVE OVERLAPPING PETALS + center           (~17 regions)
//   wolf     — node-canvas portrait                                   (~20 regions)
//   mermaid  — node-canvas figure (incl. 4 bubbles)                   (~25 regions)
//   unicorn  — node-canvas profile                                    (~20 regions)
//
// Plus an automatically-added "background" region on every picture: every
// pixel that's NOT inside another colorable region AND NOT directly under an
// outline pixel gets the background label id. The runtime treats it like any
// other region — taps on the negative space fill it with the chosen color.

import { PNG } from "pngjs";
import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS = resolve(__dirname, "../examples/coloring-book/assets");
mkdirSync(ASSETS, { recursive: true });

const SIZE = 512;
const STROKE = 4; // outline thickness in pixels

// Stable id for the auto-generated background region. The R-channel encoding
// has a 0..255 range; 255 sits at the top of that range and is far from any
// hand-assigned id (existing pictures use 1..14 max, the 3 new node-canvas
// subjects up to 16). Picked once here so authors of new pictures know which
// id to leave alone. LabelMap reads R-channel and does NOT filter this value
// out, so 255 is just another paintable region id at runtime.
const BACKGROUND_ID = 255;

// ---------- pixel primitives (no AA — flat fills only) ----------

function makeImage(w, h) {
  const png = new PNG({ width: w, height: h });
  png.data.fill(0);
  return png;
}

function setPx(img, x, y, c) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const idx = (img.width * y + x) << 2;
  img.data[idx] = c[0];
  img.data[idx + 1] = c[1];
  img.data[idx + 2] = c[2];
  img.data[idx + 3] = c[3];
}

function fillRect(img, x0, y0, w, h, c) {
  const xEnd = Math.min(img.width, x0 + w);
  const yEnd = Math.min(img.height, y0 + h);
  for (let y = Math.max(0, y0); y < yEnd; y++)
    for (let x = Math.max(0, x0); x < xEnd; x++) setPx(img, x, y, c);
}

// Bresenham line that stamps a (thick × thick) square at every step. Sharp
// pixels — no AA — which is exactly what we want for a label-map outline
// reference, and is fine visually for this simple style.
function drawLine(img, x0, y0, x1, y1, c, thick) {
  const half = Math.floor((thick - 1) / 2);
  let X0 = Math.round(x0);
  let Y0 = Math.round(y0);
  const X1 = Math.round(x1);
  const Y1 = Math.round(y1);
  const dx = Math.abs(X1 - X0);
  const sx = X0 < X1 ? 1 : -1;
  const dy = -Math.abs(Y1 - Y0);
  const sy = Y0 < Y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    fillRect(img, X0 - half, Y0 - half, thick, thick, c);
    if (X0 === X1 && Y0 === Y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      X0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      Y0 += sy;
    }
  }
}

function strokePolygon(img, points, c, thick) {
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    drawLine(img, x1, y1, x2, y2, c, thick);
  }
}

function strokeRect(img, x, y, w, h, c, thick) {
  drawLine(img, x, y, x + w - 1, y, c, thick);
  drawLine(img, x, y + h - 1, x + w - 1, y + h - 1, c, thick);
  drawLine(img, x, y, x, y + h - 1, c, thick);
  drawLine(img, x + w - 1, y, x + w - 1, y + h - 1, c, thick);
}

// Horizontal chord across an ellipse at y, drawn as a thick stroke. Used for
// the balloon stripe separators (outline-only — the regions are already split
// in the labels via fillEllipseSlabBit).
function drawEllipseChord(img, cx, cy, rx, ry, y, c, thick) {
  const dy = y - cy;
  if (Math.abs(dy) > ry) return;
  const half = rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry)));
  drawLine(img, cx - half, y, cx + half, y, c, thick);
}

// Annulus stroke for ellipses. Pixelated edges, but with thick=4 the staircase
// is barely visible at the runtime display size.
function strokeEllipse(img, cx, cy, rx, ry, c, thick) {
  const rxOut = rx + thick / 2;
  const ryOut = ry + thick / 2;
  const rxIn = Math.max(0.0001, rx - thick / 2);
  const ryIn = Math.max(0.0001, ry - thick / 2);
  const minY = Math.max(0, Math.floor(cy - ryOut));
  const maxY = Math.min(img.height - 1, Math.ceil(cy + ryOut));
  for (let y = minY; y <= maxY; y++) {
    const minX = Math.max(0, Math.floor(cx - rxOut));
    const maxX = Math.min(img.width - 1, Math.ceil(cx + rxOut));
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const o = (dx * dx) / (rxOut * rxOut) + (dy * dy) / (ryOut * ryOut);
      const i = (dx * dx) / (rxIn * rxIn) + (dy * dy) / (ryIn * ryIn);
      if (o <= 1 && i >= 1) setPx(img, x, y, c);
    }
  }
}

// ---------- color helpers ----------

const BLACK = [0, 0, 0, 255];

// ---------- bitmask label buffer ----------
//
// `Mask` mirrors the PNG-shape (`width`, `height`, `data`) but its `data` is a
// Uint32Array — one cell per pixel — so each fill primitive ORs in a shape's
// bit instead of overwriting an id byte. We keep the geometry routines almost
// identical to the byte-writing versions; only the per-pixel write differs.
//
// 32-bit JS bitwise ops treat the high bit as a sign bit, so we cap shape
// counts at 30 and treat the result as a Uint32 (the typed array stores it
// unsigned regardless). MAX_BITS=30 gives every current subject room to
// breathe; bumping past 30 needs the "shape groups" treatment.

const MAX_BITS = 30;

function makeMask(w, h) {
  return { width: w, height: h, data: new Uint32Array(w * h) };
}

function bitFor(shapeIndex) {
  if (shapeIndex < 0 || shapeIndex >= MAX_BITS) {
    throw new Error(
      `shape index ${shapeIndex} out of range — split into shape groups (max ${MAX_BITS} per subject)`
    );
  }
  return 1 << shapeIndex;
}

function fillRectBit(mask, x0, y0, w, h, bit) {
  const xEnd = Math.min(mask.width, x0 + w);
  const yEnd = Math.min(mask.height, y0 + h);
  for (let y = Math.max(0, y0); y < yEnd; y++)
    for (let x = Math.max(0, x0); x < xEnd; x++)
      mask.data[mask.width * y + x] |= bit;
}

function fillEllipseBit(mask, cx, cy, rx, ry, bit) {
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const minY = Math.max(0, Math.floor(cy - ry));
  const maxY = Math.min(mask.height - 1, Math.ceil(cy + ry));
  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    const span = Math.sqrt(Math.max(0, rx2 * (1 - (dy * dy) / ry2)));
    const minX = Math.max(0, Math.floor(cx - span));
    const maxX = Math.min(mask.width - 1, Math.ceil(cx + span));
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1)
        mask.data[mask.width * y + x] |= bit;
    }
  }
}

function fillEllipseSlabBit(mask, cx, cy, rx, ry, yMin, yMax, bit) {
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  // yMin / yMax can be fractional (slabs are computed from cy ± r/3); floor
  // them before iterating so the Uint32Array index stays integer — otherwise
  // typed-array writes are silently dropped on fractional indices.
  const minY = Math.floor(Math.max(yMin, Math.max(0, Math.floor(cy - ry))));
  const maxY = Math.floor(Math.min(yMax - 1, Math.min(mask.height - 1, Math.ceil(cy + ry))));
  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    const span = Math.sqrt(Math.max(0, rx2 * (1 - (dy * dy) / ry2)));
    const minX = Math.max(0, Math.floor(cx - span));
    const maxX = Math.min(mask.width - 1, Math.ceil(cx + span));
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1)
        mask.data[mask.width * y + x] |= bit;
    }
  }
}

function fillPolygonBit(mask, points, bit) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(mask.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 > y) !== (y2 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(xs[i]));
      const x1 = Math.min(mask.width - 1, Math.floor(xs[i + 1]));
      for (let x = x0; x <= x1; x++) mask.data[mask.width * y + x] |= bit;
    }
  }
}

// Smallest "real" overlap region we'll emit. Below this, a multi-bit mask
// is treated as a vertex-coincidence artifact (two adjacent polygons sharing
// a vertex pixel because of scanline-rounding) and merged back into the
// highest set bit's single-bit mask — matching the pre-bitmask "later-drawn
// shape wins at boundaries" behaviour. Anything larger is a real overlap
// (fish scales, flower petals, …) and gets its own region id.
const MIN_OVERLAP_PIXELS = 4;

function popcount(n) {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

// Convert the bitmask buffer into the final 8-bit-per-channel labels PNG.
//
// Every distinct non-zero bitmask becomes its own region id; pixels with
// mask==0 stay alpha=0 (caught later by addBackgroundRegion). IDs are
// assigned in ASCENDING MASK ORDER which means a subject whose shapes never
// genuinely overlap (e.g. star, where tips touch only at shared vertices)
// gets ids 1..N matching shape-index+1 — keeping its labels PNG byte-
// identical to the pre-bitmask generator. Subjects with overlap get fresh
// ids that no longer line up with hand-written numbers in the source, but
// since the runtime only cares that each region has a unique id, that's fine.
function maskToLabelsPng(mask) {
  // Iteratively cull tiny masks until stable. Each pass: count distinct
  // masks; for any with count ≤ MIN_OVERLAP_PIXELS, remap multi-bit slivers
  // (vertex-coincidence overlaps from polygon scanlining) into their
  // highest single bit — matching the pre-bitmask "later-drawn shape wins"
  // boundary behaviour — and drop single-bit slivers (boundary noise from
  // node-canvas path rasterization) to mask=0 so the background pass
  // absorbs them. We loop because folding a multi-bit mask into a
  // single-bit target can itself produce a NEW small single-bit region if
  // that bit had no standalone area before.
  while (true) {
    const counts = new Map();
    for (let i = 0; i < mask.data.length; i++) {
      const m = mask.data[i];
      if (m !== 0) counts.set(m, (counts.get(m) || 0) + 1);
    }
    const remap = new Map();
    for (const [m, count] of counts) {
      if (count <= MIN_OVERLAP_PIXELS) {
        if (popcount(m) > 1) {
          remap.set(m, 1 << (31 - Math.clz32(m)));
        } else {
          remap.set(m, 0);
        }
      }
    }
    if (remap.size === 0) break;
    for (let i = 0; i < mask.data.length; i++) {
      const m = mask.data[i];
      if (m !== 0 && remap.has(m)) mask.data[i] = remap.get(m);
    }
  }
  // Now-stable distinct masks → sequential ids in ascending mask-value order.
  const distinct = new Set();
  for (let i = 0; i < mask.data.length; i++) {
    const m = mask.data[i];
    if (m !== 0) distinct.add(m);
  }
  const sorted = [...distinct].sort((a, b) => a - b);
  const idForMask = new Map();
  let nextId = 1;
  for (const m of sorted) {
    if (nextId === BACKGROUND_ID) nextId++;
    if (nextId > 254) {
      throw new Error(
        `too many distinct regions in one subject — overflowed past id 254`
      );
    }
    idForMask.set(m, nextId);
    nextId++;
  }
  const png = makeImage(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) {
    const m = mask.data[i];
    if (m === 0) continue; // leave alpha=0; background pass picks it up
    const p = i << 2;
    png.data[p] = idForMask.get(m);
    png.data[p + 3] = 255;
  }
  return png;
}

// ---------- pictures ----------

function makeApple() {
  const mask = makeMask(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Geometry (chosen so each region is comfortably tappable on a phone)
  const bodyCX = 256;
  const bodyCY = 310;
  const bodyRX = 150;
  const bodyRY = 145;
  const stemX = 248;
  const stemY = 130;
  const stemW = 16;
  const stemH = 50;
  const leafCX = 305;
  const leafCY = 145;
  const leafRX = 40;
  const leafRY = 22;
  const hlCX = 200;
  const hlCY = 250;
  const hlRX = 28;
  const hlRY = 18;

  // Labels: each shape gets its own bit. The highlight sits inside the body,
  // so the (body | highlight) overlap pixels become their own region.
  fillEllipseBit(mask, bodyCX, bodyCY, bodyRX, bodyRY, bitFor(0)); // body
  fillRectBit(mask, stemX, stemY, stemW, stemH, bitFor(1)); // stem
  fillEllipseBit(mask, leafCX, leafCY, leafRX, leafRY, bitFor(2)); // leaf
  fillEllipseBit(mask, hlCX, hlCY, hlRX, hlRY, bitFor(3)); // highlight

  // Lines: same shape outlines, sharp black on transparent.
  strokeEllipse(lines, bodyCX, bodyCY, bodyRX, bodyRY, BLACK, STROKE);
  strokeEllipse(lines, hlCX, hlCY, hlRX, hlRY, BLACK, STROKE);
  strokeRect(lines, stemX, stemY, stemW, stemH, BLACK, STROKE);
  strokeEllipse(lines, leafCX, leafCY, leafRX, leafRY, BLACK, STROKE);

  return { labels: maskToLabelsPng(mask), lines };
}

function makeHouse() {
  const mask = makeMask(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Sky covers the whole canvas; walls/roof/door/windows OR additional bits
  // on top, so the overlap with sky becomes the foreground region for each.
  fillRectBit(mask, 0, 0, SIZE, SIZE, bitFor(0)); // sky

  // Walls: the body of the house.
  const wallX = 100;
  const wallY = 280;
  const wallW = 312;
  const wallH = 180;
  fillRectBit(mask, wallX, wallY, wallW, wallH, bitFor(1));

  // Roof: triangular cap above walls.
  const roof = [
    [80, 280],
    [256, 130],
    [432, 280],
  ];
  fillPolygonBit(mask, roof, bitFor(2));

  // Door + windows: own bits — under bitmask semantics they form
  // (sky | wall | door) etc. overlap regions, distinct from plain wall.
  const doorX = 220;
  const doorY = 360;
  const doorW = 70;
  const doorH = 100;
  fillRectBit(mask, doorX, doorY, doorW, doorH, bitFor(3)); // door

  const w1X = 140;
  const w1Y = 320;
  const w2X = 310;
  const w2Y = 320;
  const winW = 60;
  const winH = 60;
  fillRectBit(mask, w1X, w1Y, winW, winH, bitFor(4)); // window 1
  fillRectBit(mask, w2X, w2Y, winW, winH, bitFor(5)); // window 2

  // Lines: outline every region.
  strokePolygon(lines, roof, BLACK, STROKE);
  strokeRect(lines, wallX, wallY, wallW, wallH, BLACK, STROKE);
  strokeRect(lines, doorX, doorY, doorW, doorH, BLACK, STROKE);
  strokeRect(lines, w1X, w1Y, winW, winH, BLACK, STROKE);
  strokeRect(lines, w2X, w2Y, winW, winH, BLACK, STROKE);

  return { labels: maskToLabelsPng(mask), lines };
}

function makeStar() {
  const mask = makeMask(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  const cx = 256;
  const cy = 256;
  const outerR = 220;
  const innerR = 90;

  // 10-vertex star: alternating outer/inner. verts[0,2,4,6,8] are tips.
  const verts = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerR : innerR;
    verts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }

  // Center pentagon: connect the inner verts.
  const pentagon = [verts[1], verts[3], verts[5], verts[7], verts[9]];

  // Each tip triangle uses [outer, prev_inner, next_inner]. Tips and pentagon
  // are disjoint shapes, so each pixel gets exactly one bit set — and the
  // mask→id pass assigns ids 1..6 in bit order, byte-identical to the old
  // hand-numbered output.
  for (let i = 0; i < 5; i++) {
    const outer = verts[i * 2];
    const prevInner = verts[(i * 2 - 1 + 10) % 10];
    const nextInner = verts[(i * 2 + 1) % 10];
    fillPolygonBit(mask, [outer, nextInner, prevInner], bitFor(i));
  }
  fillPolygonBit(mask, pentagon, bitFor(5));

  // Outlines: the star silhouette + the pentagon (which separates tips from center).
  strokePolygon(lines, verts, BLACK, STROKE);
  strokePolygon(lines, pentagon, BLACK, STROKE);

  return { labels: maskToLabelsPng(mask), lines };
}

function makeCat() {
  const mask = makeMask(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Body sits low; head perches above; ears cap the head; tail curls out to
  // the right. Eyes + nose overlay the head and need to be small but still
  // ≥30px so a finger pad can hit them on a phone.
  const tail = { cx: 388, cy: 410, rx: 78, ry: 18 };
  fillEllipseBit(mask, tail.cx, tail.cy, tail.rx, tail.ry, bitFor(0));

  const body = { cx: 256, cy: 380, rx: 120, ry: 80 };
  fillEllipseBit(mask, body.cx, body.cy, body.rx, body.ry, bitFor(1));

  const head = { cx: 256, cy: 230, rx: 110, ry: 95 };
  fillEllipseBit(mask, head.cx, head.cy, head.rx, head.ry, bitFor(2));

  const earL = [
    [180, 145],
    [205, 175],
    [165, 215],
  ];
  const earR = [
    [307, 175],
    [332, 145],
    [347, 215],
  ];
  fillPolygonBit(mask, earL, bitFor(3));
  fillPolygonBit(mask, earR, bitFor(4));

  const eyeL = { cx: 220, cy: 220, rx: 14, ry: 18 };
  const eyeR = { cx: 292, cy: 220, rx: 14, ry: 18 };
  fillEllipseBit(mask, eyeL.cx, eyeL.cy, eyeL.rx, eyeL.ry, bitFor(5));
  fillEllipseBit(mask, eyeR.cx, eyeR.cy, eyeR.rx, eyeR.ry, bitFor(6));

  const nose = [
    [246, 252],
    [266, 252],
    [256, 268],
  ];
  fillPolygonBit(mask, nose, bitFor(7));

  // Lines: outline every region. Tail sits behind the body so its outer arc
  // is the only visible part — but stroking the full ellipse looks fine
  // because the body outline overlays the inner half.
  strokeEllipse(lines, tail.cx, tail.cy, tail.rx, tail.ry, BLACK, STROKE);
  strokeEllipse(lines, body.cx, body.cy, body.rx, body.ry, BLACK, STROKE);
  strokeEllipse(lines, head.cx, head.cy, head.rx, head.ry, BLACK, STROKE);
  strokePolygon(lines, earL, BLACK, STROKE);
  strokePolygon(lines, earR, BLACK, STROKE);
  strokeEllipse(lines, eyeL.cx, eyeL.cy, eyeL.rx, eyeL.ry, BLACK, STROKE);
  strokeEllipse(lines, eyeR.cx, eyeR.cy, eyeR.rx, eyeR.ry, BLACK, STROKE);
  strokePolygon(lines, nose, BLACK, STROKE);

  return { labels: maskToLabelsPng(mask), lines };
}

function makeFish() {
  const mask = makeMask(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Body is a horizontal oval; tail fin sits behind on the right; top + bottom
  // fins above/below body; eye on the head end; and a row of overlapping
  // scale circles along the lower body — each scale is its own bit, so the
  // crescent overlaps between adjacent scales become their own paintable
  // sub-regions (the headline overlap-aware feature).
  const tail = [
    [360, 256],
    [450, 180],
    [450, 332],
  ];
  fillPolygonBit(mask, tail, bitFor(0));

  const body = { cx: 240, cy: 256, rx: 140, ry: 85 };
  fillEllipseBit(mask, body.cx, body.cy, body.rx, body.ry, bitFor(1));

  const topFin = [
    [200, 180],
    [260, 100],
    [300, 180],
  ];
  fillPolygonBit(mask, topFin, bitFor(2));

  const botFin = [
    [200, 332],
    [260, 410],
    [300, 332],
  ];
  fillPolygonBit(mask, botFin, bitFor(3));

  const eye = { cx: 165, cy: 240, rx: 16, ry: 16 };
  fillEllipseBit(mask, eye.cx, eye.cy, eye.rx, eye.ry, bitFor(4));

  // Five overlapping scale circles. r=28, spacing=32 → adjacent overlap is
  // 24px wide along the centerline — comfortably tappable lens regions.
  // Each scale gets its own bit (5..9); the body bit is also set under every
  // scale, so distinct masks are: body+scale_i (5 of them), body+scale_i+
  // scale_{i+1} (4 lenses), giving 9 paintable sub-regions across the row.
  const scaleY = 295;
  const scaleR = 28;
  const scaleXs = [180, 212, 244, 276, 308];
  scaleXs.forEach((sx, i) => {
    fillEllipseBit(mask, sx, scaleY, scaleR, scaleR, bitFor(5 + i));
  });

  // Lines
  strokePolygon(lines, tail, BLACK, STROKE);
  strokeEllipse(lines, body.cx, body.cy, body.rx, body.ry, BLACK, STROKE);
  strokePolygon(lines, topFin, BLACK, STROKE);
  strokePolygon(lines, botFin, BLACK, STROKE);
  strokeEllipse(lines, eye.cx, eye.cy, eye.rx, eye.ry, BLACK, STROKE);
  scaleXs.forEach((sx) => {
    strokeEllipse(lines, sx, scaleY, scaleR, scaleR, BLACK, STROKE);
  });

  return { labels: maskToLabelsPng(mask), lines };
}

function makeBalloon() {
  const mask = makeMask(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Sky covers everything; balloon + basket OR additional bits on top.
  // The three balloon stripes use disjoint y-slabs so they don't overlap each
  // other (only the sky bit shares with them).
  fillRectBit(mask, 0, 0, SIZE, SIZE, bitFor(0));

  const balloon = { cx: 256, cy: 200, r: 130 };
  const yTop = balloon.cy - balloon.r;       // 70
  const yMid1 = balloon.cy - balloon.r / 3;  // ~157
  const yMid2 = balloon.cy + balloon.r / 3;  // ~243
  const yBot = balloon.cy + balloon.r;       // 330
  fillEllipseSlabBit(mask, balloon.cx, balloon.cy, balloon.r, balloon.r, yTop, yMid1, bitFor(1));
  fillEllipseSlabBit(mask, balloon.cx, balloon.cy, balloon.r, balloon.r, yMid1, yMid2, bitFor(2));
  fillEllipseSlabBit(mask, balloon.cx, balloon.cy, balloon.r, balloon.r, yMid2, yBot + 1, bitFor(3));

  const basket = { x: 226, y: 380, w: 60, h: 50 };
  fillRectBit(mask, basket.x, basket.y, basket.w, basket.h, bitFor(4));

  // Lines: balloon silhouette + 2 stripe-divider chords + basket + ropes.
  strokeEllipse(lines, balloon.cx, balloon.cy, balloon.r, balloon.r, BLACK, STROKE);
  drawEllipseChord(lines, balloon.cx, balloon.cy, balloon.r, balloon.r, yMid1, BLACK, STROKE);
  drawEllipseChord(lines, balloon.cx, balloon.cy, balloon.r, balloon.r, yMid2, BLACK, STROKE);
  strokeRect(lines, basket.x, basket.y, basket.w, basket.h, BLACK, STROKE);
  // Ropes from balloon bottom to basket top corners.
  drawLine(lines, balloon.cx - 60, yBot - 8, basket.x + 6, basket.y, BLACK, STROKE);
  drawLine(lines, balloon.cx + 60, yBot - 8, basket.x + basket.w - 6, basket.y, BLACK, STROKE);

  return { labels: maskToLabelsPng(mask), lines };
}

function makeCupcake() {
  const mask = makeMask(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Wrapper trapezoid (wider at top, narrows toward bottom).
  const wrapper = [
    [148, 295],
    [364, 295],
    [340, 460],
    [172, 460],
  ];
  fillPolygonBit(mask, wrapper, bitFor(0));

  // Three swirled frosting layers; each adjacent pair overlaps slightly so
  // overlap-aware regions add a thin "edge" sub-region between tiers.
  fillEllipseBit(mask, 256, 275, 130, 55, bitFor(1));
  fillEllipseBit(mask, 256, 220, 100, 45, bitFor(2));
  fillEllipseBit(mask, 256, 170, 70, 35, bitFor(3));

  // Cherry on top.
  fillEllipseBit(mask, 256, 125, 22, 22, bitFor(4));

  // Lines
  strokePolygon(lines, wrapper, BLACK, STROKE);
  strokeEllipse(lines, 256, 275, 130, 55, BLACK, STROKE);
  strokeEllipse(lines, 256, 220, 100, 45, BLACK, STROKE);
  strokeEllipse(lines, 256, 170, 70, 35, BLACK, STROKE);
  strokeEllipse(lines, 256, 125, 22, 22, BLACK, STROKE);

  return { labels: maskToLabelsPng(mask), lines };
}

function makeRobot() {
  const mask = makeMask(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Body first, then arms attach to its sides, then head sits above, then
  // facial features OR additional bits onto the head — eye pixels carry both
  // the head bit and their own bit, distinguishing them as separate regions.
  const body = { x: 184, y: 280, w: 144, h: 160 };
  fillRectBit(mask, body.x, body.y, body.w, body.h, bitFor(0));

  const armL = { x: 130, y: 290, w: 50, h: 110 };
  const armR = { x: 332, y: 290, w: 50, h: 110 };
  fillRectBit(mask, armL.x, armL.y, armL.w, armL.h, bitFor(1));
  fillRectBit(mask, armR.x, armR.y, armR.w, armR.h, bitFor(2));

  const head = { x: 200, y: 130, w: 112, h: 130 };
  fillRectBit(mask, head.x, head.y, head.w, head.h, bitFor(3));

  const eyeL = { cx: 228, cy: 175, r: 14 };
  const eyeR = { cx: 284, cy: 175, r: 14 };
  fillEllipseBit(mask, eyeL.cx, eyeL.cy, eyeL.r, eyeL.r, bitFor(4));
  fillEllipseBit(mask, eyeR.cx, eyeR.cy, eyeR.r, eyeR.r, bitFor(5));

  const antenna = { cx: 256, cy: 90, r: 16 };
  fillEllipseBit(mask, antenna.cx, antenna.cy, antenna.r, antenna.r, bitFor(6));

  // Lines
  strokeRect(lines, body.x, body.y, body.w, body.h, BLACK, STROKE);
  strokeRect(lines, armL.x, armL.y, armL.w, armL.h, BLACK, STROKE);
  strokeRect(lines, armR.x, armR.y, armR.w, armR.h, BLACK, STROKE);
  strokeRect(lines, head.x, head.y, head.w, head.h, BLACK, STROKE);
  strokeEllipse(lines, eyeL.cx, eyeL.cy, eyeL.r, eyeL.r, BLACK, STROKE);
  strokeEllipse(lines, eyeR.cx, eyeR.cy, eyeR.r, eyeR.r, BLACK, STROKE);
  strokeEllipse(lines, antenna.cx, antenna.cy, antenna.r, antenna.r, BLACK, STROKE);
  // Antenna stem from head top to antenna ball — outline only.
  drawLine(lines, antenna.cx, head.y, antenna.cx, antenna.cy + antenna.r, BLACK, STROKE);
  // Mouth bar — outline only, gives a face.
  drawLine(lines, head.x + 28, head.y + 95, head.x + head.w - 28, head.y + 95, BLACK, STROKE);

  return { labels: maskToLabelsPng(mask), lines };
}

function makeSailboat() {
  const mask = makeMask(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Sky → water → hull → sails → sun. Sky and water are full-canvas tiles
  // that don't overlap each other (water is below y=380). Other shapes OR
  // additional bits on top of sky/water as appropriate.
  fillRectBit(mask, 0, 0, SIZE, SIZE, bitFor(0)); // sky covers all
  fillRectBit(mask, 0, 380, SIZE, SIZE - 380, bitFor(1)); // water (overrides sky bit by adding water bit)

  const hull = [
    [165, 360],
    [347, 360],
    [310, 412],
    [202, 412],
  ];
  fillPolygonBit(mask, hull, bitFor(2));

  // Mast at x=256 splits the two sails (no region on the mast itself; just an
  // outline line). Sails are wedge triangles flanking the mast.
  const sailBack = [
    [260, 200],
    [260, 360],
    [342, 360],
  ];
  const sailFront = [
    [252, 200],
    [170, 360],
    [252, 360],
  ];
  fillPolygonBit(mask, sailBack, bitFor(3));
  fillPolygonBit(mask, sailFront, bitFor(4));

  const sun = { cx: 420, cy: 110, r: 42 };
  fillEllipseBit(mask, sun.cx, sun.cy, sun.r, sun.r, bitFor(5));

  // Lines
  drawLine(lines, 0, 380, SIZE - 1, 380, BLACK, STROKE); // waterline
  strokePolygon(lines, hull, BLACK, STROKE);
  strokePolygon(lines, sailBack, BLACK, STROKE);
  strokePolygon(lines, sailFront, BLACK, STROKE);
  drawLine(lines, 256, 195, 256, 360, BLACK, STROKE); // mast
  strokeEllipse(lines, sun.cx, sun.cy, sun.r, sun.r, BLACK, STROKE);

  return { labels: maskToLabelsPng(mask), lines };
}

function makeFlower() {
  const mask = makeMask(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Five petals around a center, plus stem and leaf below. Petal centers
  // sit at radius R from the flower center; petal circles have radius
  // petalR. Adjacent petal centers are 2*R*sin(36°) ≈ 82px apart, so with
  // petalR=55 each pair overlaps by ~28px — substantial lens regions.
  // The center disk overlaps every petal's inner edge for another set of
  // sub-regions. Under the bitmask scheme each of these overlaps is its
  // own paintable region, so the flower ends up with ~17 colorable cells.
  const cx = 256;
  const cy = 220;
  const R = 70;
  const petalR = 55;
  const centerR = 38;

  const stem = { x: 248, y: 295, w: 16, h: 165 };
  fillRectBit(mask, stem.x, stem.y, stem.w, stem.h, bitFor(0));

  const leaf = { cx: 320, cy: 365, rx: 50, ry: 22 };
  fillEllipseBit(mask, leaf.cx, leaf.cy, leaf.rx, leaf.ry, bitFor(1));

  // 5 evenly spaced petals at angles 90°, 162°, 234°, 306°, 18°. Each gets
  // its own bit; pairs of adjacent petals share ~28px-wide lens overlaps;
  // the center disk has its own bit so center∩petal pixels become per-petal
  // sub-regions.
  const petalAngles = [90, 162, 234, 306, 18];
  const petalPositions = petalAngles.map((deg) => {
    const r = (deg * Math.PI) / 180;
    return [cx + R * Math.cos(r), cy - R * Math.sin(r)];
  });
  petalPositions.forEach(([px, py], i) => {
    fillEllipseBit(mask, px, py, petalR, petalR, bitFor(2 + i));
  });

  fillEllipseBit(mask, cx, cy, centerR, centerR, bitFor(7));

  // Lines
  strokeRect(lines, stem.x, stem.y, stem.w, stem.h, BLACK, STROKE);
  strokeEllipse(lines, leaf.cx, leaf.cy, leaf.rx, leaf.ry, BLACK, STROKE);
  petalPositions.forEach(([px, py]) => {
    strokeEllipse(lines, px, py, petalR, petalR, BLACK, STROKE);
  });
  strokeEllipse(lines, cx, cy, centerR, centerR, BLACK, STROKE);

  return { labels: maskToLabelsPng(mask), lines };
}

// ---------- node-canvas helpers (wolf / mermaid / unicorn) ----------
//
// The original 10 pictures are simple-enough to express as pngjs primitives.
// The three showcase subjects (wolf, mermaid, unicorn) need real curves, so
// we draw their lines with node-canvas (AA on, beautiful curves). The label
// map is built by rasterizing each path's *fill* onto a scratch canvas and
// ORing its bit into the shared bitmask buffer — same overlap-aware semantics
// as the pngjs pictures.

function newLinesCanvas() {
  const cv = createCanvas(SIZE, SIZE);
  const ctx = cv.getContext("2d");
  ctx.antialias = "default";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { cv, ctx };
}

// Scratch canvas — paths get filled onto this one shape at a time so we can
// read back which pixels were covered. Antialiasing OFF so the alpha mask is
// a hard 0/255 boundary; otherwise edge pixels would land in two shapes.
function newScratchCanvas() {
  const cv = createCanvas(SIZE, SIZE);
  const ctx = cv.getContext("2d");
  ctx.antialias = "none";
  ctx.imageSmoothingEnabled = false;
  return { cv, ctx };
}

// Wrap a node-canvas Canvas into a pngjs PNG-shaped object so addBackground
// + the writer can treat all pictures the same.
function canvasToPng(cv) {
  const ctx = cv.getContext("2d");
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const png = new PNG({ width: cv.width, height: cv.height });
  png.data = Buffer.from(data); // copy out of clamped array into pngjs buffer
  return png;
}

// Paint one shape: rasterize its fill onto the scratch canvas, OR the bit
// into the mask wherever alpha > 0, then stroke its outline onto the lines
// canvas. The `path` callback runs against whichever ctx we're using.
function paintShape(scratchCtx, mask, bit, linesCtx, path) {
  scratchCtx.clearRect(0, 0, SIZE, SIZE);
  scratchCtx.fillStyle = "#fff";
  scratchCtx.beginPath();
  path(scratchCtx);
  scratchCtx.fill();
  const px = scratchCtx.getImageData(0, 0, SIZE, SIZE).data;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    if (px[i + 3] > 0) mask.data[j] |= bit;
  }

  linesCtx.strokeStyle = "#000";
  linesCtx.lineWidth = STROKE;
  linesCtx.beginPath();
  path(linesCtx);
  linesCtx.stroke();
}

// Stroke-only detail — eyebrows, whiskers, mouth lines, mane wisps. No region
// associated; just goes onto the lines canvas.
function strokeDetail(linesCtx, path, width = STROKE) {
  linesCtx.strokeStyle = "#000";
  linesCtx.lineWidth = width;
  linesCtx.beginPath();
  path(linesCtx);
  linesCtx.stroke();
}

// ---------- background region pass ----------
//
// Adds a `BACKGROUND_ID`-tagged region covering every pixel that's currently
// outside any region (labels alpha=0) AND not directly under an outline
// pixel (lines alpha=0). Outline pixels stay as id=0 so the label map shows
// a clean unpainted seam between background and foreground regions; the
// lines PNG drawn on top at runtime covers that seam visually.
//
// Why exclude outline pixels at all — the lines image is on top anyway, so
// it'd be invisible either way? Keeping the outline as id=0 means a tap that
// lands EXACTLY on the outline pixel still reads as "no region" and won't
// paint, which matches how the existing pictures already behave. We didn't
// want to retro-actively change the contract for already-shipped pictures.

function addBackgroundRegion(labels, lines) {
  const lab = labels.data;
  const ln = lines.data;
  for (let i = 0; i < lab.length; i += 4) {
    if (lab[i + 3] !== 0) continue; // already a region
    if (ln[i + 3] !== 0) continue; // outline pixel (lines layer claims it)
    lab[i] = BACKGROUND_ID;
    lab[i + 1] = 0;
    lab[i + 2] = 0;
    lab[i + 3] = 255;
  }
}

// ---------- wolf ----------
//
// 3/4-view portrait: triangular ears, chevron muzzle, ruff at the base.
// Painting order matters: outer/back regions paint first so foreground
// regions overwrite where they overlap. Path definitions are re-used between
// the labels fill and the lines stroke so the outlines and the region edges
// stay perfectly registered.

function makeWolf() {
  const mask = makeMask(SIZE, SIZE);
  const { ctx: scratchCtx } = newScratchCanvas();
  const { cv: linesCv, ctx: linesCtx } = newLinesCanvas();

  // --- paths ---

  // Head silhouette: angular wolf face — flatter top between the ears than a
  // teddy-bear oval, taper to a clear chin. Cheeks bulge wider than the
  // forehead to read as "fluff" without going round.
  const head = (c) => {
    c.moveTo(178, 134); // left ear root
    c.bezierCurveTo(208, 156, 232, 162, 256, 158); // shallow dip to center
    c.bezierCurveTo(280, 162, 304, 156, 334, 134); // up to right ear root
    c.bezierCurveTo(388, 144, 432, 188, 442, 244); // right brow → right cheek
    c.bezierCurveTo(448, 308, 420, 360, 384, 392); // down right cheek
    c.bezierCurveTo(354, 416, 322, 436, 290, 450); // jaw curve
    c.bezierCurveTo(276, 458, 236, 458, 222, 450);
    c.bezierCurveTo(190, 436, 158, 416, 128, 392);
    c.bezierCurveTo(92, 360, 64, 308, 70, 244);
    c.bezierCurveTo(80, 188, 124, 144, 178, 134);
    c.closePath();
  };

  // Outer ears: tall isoceles triangles with slight curve. Tip sweeps slightly
  // outward so the ears feel alert, not pinned.
  const earL = (c) => {
    c.moveTo(208, 134);
    c.bezierCurveTo(176, 96, 138, 56, 88, 22);
    c.bezierCurveTo(88, 56, 102, 102, 144, 146);
    c.bezierCurveTo(168, 142, 192, 138, 208, 134);
    c.closePath();
  };
  const earR = (c) => {
    c.moveTo(304, 134);
    c.bezierCurveTo(336, 96, 374, 56, 424, 22);
    c.bezierCurveTo(424, 56, 410, 102, 368, 146);
    c.bezierCurveTo(344, 142, 320, 138, 304, 134);
    c.closePath();
  };

  const earInL = (c) => {
    c.moveTo(196, 134);
    c.bezierCurveTo(168, 100, 134, 68, 108, 50);
    c.bezierCurveTo(112, 78, 128, 112, 160, 144);
    c.bezierCurveTo(174, 140, 184, 136, 196, 134);
    c.closePath();
  };
  const earInR = (c) => {
    c.moveTo(316, 134);
    c.bezierCurveTo(344, 100, 378, 68, 404, 50);
    c.bezierCurveTo(400, 78, 384, 112, 352, 144);
    c.bezierCurveTo(338, 140, 328, 136, 316, 134);
    c.closePath();
  };

  // Snout: tear-drop sitting on the lower half of the face.
  const snout = (c) => {
    c.moveTo(220, 296);
    c.bezierCurveTo(225, 268, 287, 268, 292, 296);
    c.bezierCurveTo(312, 320, 320, 380, 305, 416);
    c.bezierCurveTo(290, 442, 222, 442, 207, 416);
    c.bezierCurveTo(192, 380, 200, 320, 220, 296);
    c.closePath();
  };

  const nose = (c) => {
    c.moveTo(232, 305);
    c.bezierCurveTo(232, 285, 280, 285, 280, 305);
    c.bezierCurveTo(286, 322, 270, 335, 256, 338);
    c.bezierCurveTo(242, 335, 226, 322, 232, 305);
    c.closePath();
  };

  // Eyes: slanted almonds, inner corner higher than outer for an "intense"
  // expression. Big enough to fill with a contrasting color clearly.
  const eyeL = (c) => {
    c.moveTo(150, 252);
    c.bezierCurveTo(158, 224, 212, 220, 226, 240);
    c.bezierCurveTo(220, 264, 178, 268, 150, 252);
    c.closePath();
  };
  const eyeR = (c) => {
    c.moveTo(362, 252);
    c.bezierCurveTo(354, 224, 300, 220, 286, 240);
    c.bezierCurveTo(292, 264, 334, 268, 362, 252);
    c.closePath();
  };

  // Mouth: a flatter under-snout curve so it reads as a closed muzzle line.
  const mouth = (c) => {
    c.moveTo(216, 408);
    c.bezierCurveTo(232, 432, 280, 432, 296, 408);
    c.bezierCurveTo(286, 402, 226, 402, 216, 408);
    c.closePath();
  };

  // Neck-fur ruff: shaggy zig-zag bottom edge tapering up to where the head
  // ends at jaw level. The top edge re-traces the head's chin curve so the
  // shared outline gets stroked twice (visually one line). Painted before
  // the head so the chin reads as part of the head, not part of the ruff.
  const neckFur = (c) => {
    c.moveTo(128, 392);
    c.bezierCurveTo(72, 428, 36, 470, 30, 512);
    c.lineTo(80, 488);
    c.lineTo(112, 512);
    c.lineTo(150, 488);
    c.lineTo(186, 512);
    c.lineTo(220, 488);
    c.lineTo(256, 512);
    c.lineTo(292, 488);
    c.lineTo(326, 512);
    c.lineTo(362, 488);
    c.lineTo(400, 512);
    c.lineTo(432, 488);
    c.lineTo(482, 512);
    c.bezierCurveTo(476, 470, 440, 428, 384, 392);
    c.bezierCurveTo(354, 416, 322, 436, 290, 450);
    c.bezierCurveTo(276, 458, 236, 458, 222, 450);
    c.bezierCurveTo(190, 436, 158, 416, 128, 392);
    c.closePath();
  };

  const chest = (c) => {
    c.moveTo(220, 458);
    c.bezierCurveTo(220, 446, 292, 446, 292, 458);
    c.bezierCurveTo(310, 482, 290, 506, 256, 510);
    c.bezierCurveTo(222, 506, 202, 482, 220, 458);
    c.closePath();
  };

  // --- paint in dependency order: back → front. Each shape's bit is ORed
  // into the mask; overlap zones (snout∩head, eye∩head, chest∩neckFur, …)
  // become their own paintable sub-regions automatically. ---

  const shapes = [
    neckFur,
    head,
    earL,
    earR,
    earInL,
    earInR,
    snout,
    nose,
    eyeL,
    eyeR,
    mouth,
    chest,
  ];
  shapes.forEach((shape, i) => {
    paintShape(scratchCtx, mask, bitFor(i), linesCtx, shape);
  });

  // Brow furrows above each eye for an "intense" expression.
  strokeDetail(linesCtx, (c) => {
    c.moveTo(140, 218);
    c.bezierCurveTo(170, 200, 218, 198, 234, 218);
    c.moveTo(372, 218);
    c.bezierCurveTo(342, 200, 294, 198, 278, 218);
  }, 3);
  // Snout-bridge tick from nose tip down to mouth.
  strokeDetail(linesCtx, (c) => {
    c.moveTo(256, 340);
    c.lineTo(256, 410);
  }, 2);
  // Whiskers — three short strokes per cheek.
  strokeDetail(linesCtx, (c) => {
    c.moveTo(208, 360); c.lineTo(160, 354);
    c.moveTo(208, 374); c.lineTo(156, 376);
    c.moveTo(210, 388); c.lineTo(162, 398);
    c.moveTo(304, 360); c.lineTo(352, 354);
    c.moveTo(304, 374); c.lineTo(356, 376);
    c.moveTo(302, 388); c.lineTo(350, 398);
  }, 2);

  return { labels: maskToLabelsPng(mask), lines: canvasToPng(linesCv) };
}

// ---------- mermaid ----------
//
// Front-facing figure with a long S-curve tail and four bubble accents.
// 16 regions: hair, face, neck, two shell-bra cups, torso skin, two arms,
// two hands, tail upper, tail lower, two flukes, four bubbles.

function makeMermaid() {
  const mask = makeMask(SIZE, SIZE);
  const { ctx: scratchCtx } = newScratchCanvas();
  const { cv: linesCv, ctx: linesCtx } = newLinesCanvas();

  // Hair: large silhouette behind everything. Falls past the shoulders and
  // tapers into a tip on each side; the front center frames the face.
  const hair = (c) => {
    c.moveTo(170, 100);
    c.bezierCurveTo(160, 50, 210, 24, 256, 28);
    c.bezierCurveTo(302, 24, 352, 50, 342, 100);
    c.bezierCurveTo(382, 140, 398, 220, 384, 320);
    c.bezierCurveTo(376, 380, 360, 415, 320, 418);
    c.bezierCurveTo(296, 420, 280, 405, 276, 380);
    c.bezierCurveTo(272, 360, 280, 300, 296, 256);
    // tuck behind torso
    c.bezierCurveTo(290, 254, 222, 254, 216, 256);
    c.bezierCurveTo(232, 300, 240, 360, 236, 380);
    c.bezierCurveTo(232, 405, 216, 420, 192, 418);
    c.bezierCurveTo(152, 415, 136, 380, 128, 320);
    c.bezierCurveTo(114, 220, 130, 140, 170, 100);
    c.closePath();
  };

  const face = (c) => {
    c.moveTo(202, 132);
    c.bezierCurveTo(202, 90, 310, 90, 310, 132);
    c.bezierCurveTo(312, 168, 296, 200, 256, 204);
    c.bezierCurveTo(216, 200, 200, 168, 202, 132);
    c.closePath();
  };

  const neck = (c) => {
    c.moveTo(228, 198);
    c.lineTo(284, 198);
    c.lineTo(294, 222);
    c.lineTo(218, 222);
    c.closePath();
  };

  // Torso: shoulders → midriff → waist where the tail attaches. Shell-bra
  // and arms paint over this shape, so what's visible is shoulder skin +
  // midriff between the bra cups and the tail.
  const torso = (c) => {
    c.moveTo(200, 218);
    c.bezierCurveTo(176, 232, 168, 280, 196, 308);
    c.lineTo(316, 308);
    c.bezierCurveTo(344, 280, 336, 232, 312, 218);
    c.bezierCurveTo(298, 222, 226, 222, 200, 218);
    c.closePath();
  };

  // Shell-bra cups: scallop-shaped covers. Drawn on top of torso so torso's
  // remaining visible pixels become the "skin" region (single id = midriff +
  // shoulders + sides).
  const braL = (c) => {
    c.moveTo(184, 248);
    c.bezierCurveTo(184, 224, 246, 224, 246, 248);
    c.bezierCurveTo(244, 260, 234, 274, 215, 274);
    c.bezierCurveTo(196, 274, 186, 260, 184, 248);
    c.closePath();
  };
  const braR = (c) => {
    c.moveTo(266, 248);
    c.bezierCurveTo(266, 224, 328, 224, 328, 248);
    c.bezierCurveTo(326, 260, 316, 274, 297, 274);
    c.bezierCurveTo(278, 274, 268, 260, 266, 248);
    c.closePath();
  };

  // Arms: shoulder → wrist, curving outward. Hands sit at the wrist.
  const armL = (c) => {
    c.moveTo(196, 220);
    c.bezierCurveTo(176, 234, 138, 250, 118, 280);
    c.bezierCurveTo(106, 290, 100, 302, 110, 308);
    c.bezierCurveTo(124, 304, 142, 290, 162, 274);
    c.bezierCurveTo(184, 254, 200, 232, 196, 220);
    c.closePath();
  };
  const armR = (c) => {
    c.moveTo(316, 220);
    c.bezierCurveTo(336, 234, 374, 250, 394, 280);
    c.bezierCurveTo(406, 290, 412, 302, 402, 308);
    c.bezierCurveTo(388, 304, 370, 290, 350, 274);
    c.bezierCurveTo(328, 254, 312, 232, 316, 220);
    c.closePath();
  };

  const handL = (c) => {
    c.moveTo(96, 290);
    c.bezierCurveTo(80, 290, 72, 308, 84, 320);
    c.bezierCurveTo(96, 326, 116, 320, 122, 308);
    c.bezierCurveTo(120, 298, 110, 290, 96, 290);
    c.closePath();
  };
  const handR = (c) => {
    c.moveTo(416, 290);
    c.bezierCurveTo(432, 290, 440, 308, 428, 320);
    c.bezierCurveTo(416, 326, 396, 320, 390, 308);
    c.bezierCurveTo(392, 298, 402, 290, 416, 290);
    c.closePath();
  };

  // Tail: upper section (right after waist), lower section (toward fluke),
  // S-curving slightly to the right. Bottom of upper = top of lower so the
  // outline reads as one continuous tail with a scalloped midline.
  const tailUpper = (c) => {
    c.moveTo(196, 308);
    c.bezierCurveTo(186, 336, 192, 380, 226, 408);
    c.lineTo(330, 396);
    c.bezierCurveTo(338, 360, 332, 332, 316, 308);
    c.closePath();
  };
  const tailLower = (c) => {
    c.moveTo(226, 408);
    c.bezierCurveTo(216, 432, 230, 460, 262, 472);
    c.lineTo(312, 460);
    c.bezierCurveTo(326, 432, 332, 416, 330, 396);
    c.closePath();
  };

  // Fluke: split lobes flaring out from where tail-lower ends.
  const flukeL = (c) => {
    c.moveTo(262, 472);
    c.bezierCurveTo(220, 470, 156, 462, 96, 484);
    c.bezierCurveTo(150, 506, 220, 510, 280, 500);
    c.bezierCurveTo(282, 488, 274, 478, 262, 472);
    c.closePath();
  };
  const flukeR = (c) => {
    c.moveTo(312, 460);
    c.bezierCurveTo(354, 462, 410, 458, 460, 472);
    c.bezierCurveTo(420, 504, 360, 510, 296, 498);
    c.bezierCurveTo(294, 484, 302, 470, 312, 460);
    c.closePath();
  };

  // Bubbles: scatter four around for color variety.
  const bubble = (cx, cy, r) => (c) => {
    c.moveTo(cx + r, cy);
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.closePath();
  };

  // --- paint order (back to front). Bubbles each get their own bit so the
  // player can pick a different colour for every one (≥18px radius keeps
  // them tappable on phones). Overlap zones (face∩hair, bra∩torso, …)
  // become their own paintable sub-regions. ---

  const shapes = [
    hair,        // bit 0 — behind everything
    armL,        // bit 1
    armR,        // bit 2
    tailUpper,   // bit 3
    tailLower,   // bit 4
    flukeL,      // bit 5
    flukeR,      // bit 6
    torso,       // bit 7
    braL,        // bit 8
    braR,        // bit 9
    neck,        // bit 10
    face,        // bit 11
    handL,       // bit 12
    handR,       // bit 13
    bubble(70, 90, 24),    // bit 14
    bubble(442, 124, 20),  // bit 15
    bubble(88, 358, 18),   // bit 16
    bubble(454, 396, 22),  // bit 17
  ];
  shapes.forEach((shape, i) => {
    paintShape(scratchCtx, mask, bitFor(i), linesCtx, shape);
  });

  // Face details — eyes, mouth, eyebrows. Stroke-only.
  strokeDetail(linesCtx, (c) => {
    // eyes
    c.moveTo(232, 144);
    c.bezierCurveTo(228, 138, 244, 138, 240, 146);
    c.moveTo(280, 144);
    c.bezierCurveTo(276, 138, 292, 138, 288, 146);
  }, 3);
  strokeDetail(linesCtx, (c) => {
    // mouth — small smile
    c.moveTo(244, 178);
    c.bezierCurveTo(252, 184, 260, 184, 268, 178);
  }, 3);
  // Tail scallop seams — three subtle scale arcs across the upper tail.
  strokeDetail(linesCtx, (c) => {
    c.moveTo(204, 340);
    c.bezierCurveTo(232, 358, 280, 358, 312, 340);
    c.moveTo(208, 372);
    c.bezierCurveTo(232, 388, 282, 388, 316, 372);
  }, 2);

  return { labels: maskToLabelsPng(mask), lines: canvasToPng(linesCv) };
}

// ---------- unicorn ----------
//
// Profile facing left: head + neck + chest, with three flowing mane sections,
// a spiral horn, and a small star sparkle. ~14 regions.

function makeUnicorn() {
  const mask = makeMask(SIZE, SIZE);
  const { ctx: scratchCtx } = newScratchCanvas();
  const { cv: linesCv, ctx: linesCtx } = newLinesCanvas();

  // Head profile facing left: nose tip at far-left, forehead at top, jaw
  // along the bottom, neck join at the right. Snout (id=2) overlays the lower
  // muzzle so head reads as the upper face only.
  const head = (c) => {
    c.moveTo(56, 240); // nose tip
    c.bezierCurveTo(60, 210, 80, 180, 108, 158); // up the nose bridge
    c.bezierCurveTo(132, 138, 158, 130, 184, 130); // along forehead
    c.bezierCurveTo(212, 132, 234, 150, 246, 178); // top of skull / forehead curve
    c.bezierCurveTo(254, 208, 254, 240, 246, 268); // down the cheek
    c.bezierCurveTo(232, 290, 200, 300, 168, 296); // back of jaw → chin
    c.bezierCurveTo(140, 290, 112, 280, 88, 268); // along underside of jaw
    c.bezierCurveTo(72, 260, 60, 250, 56, 240); // back to nose tip
    c.closePath();
  };

  // Snout: lower muzzle. Sits on top of head; nose tip + lower lip belong here.
  const snout = (c) => {
    c.moveTo(56, 240);
    c.bezierCurveTo(58, 254, 70, 270, 88, 280);
    c.bezierCurveTo(112, 292, 140, 296, 168, 296);
    c.bezierCurveTo(186, 296, 198, 286, 196, 270);
    c.bezierCurveTo(190, 252, 170, 240, 148, 234);
    c.bezierCurveTo(112, 228, 80, 230, 56, 240);
    c.closePath();
  };

  // Nostril: small dark dot near the nose tip. Sized for a comfortable tap
  // target on phones (≈30×30 in source pixels).
  const nostril = (c) => {
    c.moveTo(72, 252);
    c.bezierCurveTo(72, 242, 108, 240, 112, 256);
    c.bezierCurveTo(108, 270, 76, 268, 72, 252);
    c.closePath();
  };

  // Mouth: gentle curve along the lower edge of the snout.
  const mouth = (c) => {
    c.moveTo(96, 286);
    c.bezierCurveTo(120, 302, 156, 304, 178, 296);
    c.bezierCurveTo(166, 286, 116, 282, 96, 286);
    c.closePath();
  };

  const eye = (c) => {
    c.moveTo(150, 192);
    c.bezierCurveTo(154, 174, 196, 174, 196, 196);
    c.bezierCurveTo(190, 214, 156, 212, 150, 192);
    c.closePath();
  };

  // Ear: leaf-shape pointing up at the top-back of the head, slightly behind
  // the horn so the horn reads as in front when both are stroked.
  const ear = (c) => {
    c.moveTo(218, 138);
    c.bezierCurveTo(228, 102, 248, 76, 264, 70);
    c.bezierCurveTo(272, 92, 264, 122, 248, 142);
    c.bezierCurveTo(238, 144, 224, 142, 218, 138);
    c.closePath();
  };

  // Horn: cone rising from the forehead, leaning slightly back. Spiral grooves
  // are line-only.
  const horn = (c) => {
    c.moveTo(180, 132);
    c.bezierCurveTo(190, 134, 204, 134, 212, 134);
    c.bezierCurveTo(220, 96, 232, 56, 240, 22);
    c.bezierCurveTo(228, 24, 218, 32, 210, 50);
    c.bezierCurveTo(196, 76, 184, 102, 180, 132);
    c.closePath();
  };

  // Neck: angled trapezoid from the back of the head down to the chest. Front
  // edge runs from chin → throat → brisket; back edge runs from poll → withers
  // → top of chest.
  const neck = (c) => {
    c.moveTo(168, 296); // throat (just below chin)
    c.bezierCurveTo(180, 304, 200, 320, 220, 344); // throat curving down/right
    c.bezierCurveTo(248, 380, 290, 432, 332, 488); // front of neck → brisket
    c.lineTo(456, 488); // along top of chest to back-shoulder
    c.bezierCurveTo(444, 432, 396, 360, 332, 296); // back-of-neck rising
    c.bezierCurveTo(304, 274, 272, 264, 246, 268); // poll/withers
    c.bezierCurveTo(232, 290, 200, 300, 168, 296);
    c.closePath();
  };

  // Chest: front-of-chest bump at the bottom.
  const chest = (c) => {
    c.moveTo(332, 488);
    c.bezierCurveTo(380, 484, 432, 488, 472, 504);
    c.lineTo(160, 504);
    c.bezierCurveTo(200, 484, 280, 484, 332, 488);
    c.closePath();
  };

  // Mane: three locks, each anchored along the head/neck boundary and curling
  // outward into the negative space. Designed so the inner edge of each lock
  // re-traces the head or neck silhouette — that way stroking the lock draws
  // its outer curl PLUS a stroke that exactly overlaps the head/neck outline
  // (one visible line, no spurious "interior" strokes through the body).
  const maneTop = (c) => {
    // Topmost lock: anchored at ear root → top-back of head, curling up/back.
    c.moveTo(218, 138);
    c.bezierCurveTo(244, 110, 280, 86, 304, 98);
    c.bezierCurveTo(316, 124, 300, 158, 270, 178);
    c.bezierCurveTo(258, 180, 250, 180, 246, 178);
    c.bezierCurveTo(238, 168, 226, 152, 218, 138);
    c.closePath();
  };
  const maneMid = (c) => {
    // Middle lock: anchored along upper cheek → poll, curling out behind ear.
    c.moveTo(246, 178);
    c.bezierCurveTo(304, 172, 368, 204, 384, 250);
    c.bezierCurveTo(372, 278, 332, 268, 296, 256);
    c.bezierCurveTo(276, 250, 260, 246, 254, 240);
    c.bezierCurveTo(252, 220, 248, 198, 246, 178);
    c.closePath();
  };
  const maneLong = (c) => {
    // Long lock: anchored along back-of-neck, falls down past the withers
    // toward the back of the chest. Closes by retracing the neck back-edge.
    c.moveTo(254, 240);
    c.bezierCurveTo(304, 232, 372, 268, 420, 316);
    c.bezierCurveTo(460, 364, 488, 420, 496, 472);
    c.bezierCurveTo(488, 500, 448, 492, 412, 464);
    c.bezierCurveTo(360, 416, 320, 364, 296, 320);
    c.bezierCurveTo(272, 290, 252, 270, 246, 268);
    c.bezierCurveTo(246, 256, 250, 248, 254, 240);
    c.closePath();
  };
  const maneFore = (c) => {
    // Forelock: small curl that DOES sit on top of the head — covers a slice
    // of the brow so it reads as hair falling forward over the face.
    c.moveTo(184, 130);
    c.bezierCurveTo(208, 132, 230, 146, 234, 168);
    c.bezierCurveTo(222, 184, 196, 184, 180, 174);
    c.bezierCurveTo(168, 158, 170, 140, 184, 130);
    c.closePath();
  };

  // Mane tips: small wisps anchoring on existing lock edges and curling
  // further out for extra color variety.
  const maneTip1 = (c) => {
    // End-of-long-lock wisp, curling outward at the bottom-right.
    c.moveTo(496, 472);
    c.bezierCurveTo(510, 488, 502, 510, 480, 510);
    c.bezierCurveTo(468, 502, 470, 488, 480, 478);
    c.bezierCurveTo(488, 472, 492, 470, 496, 472);
    c.closePath();
  };
  const maneTip2 = (c) => {
    // Wisp tucked between maneTop and maneMid, peeking out behind the ear.
    c.moveTo(304, 98);
    c.bezierCurveTo(330, 108, 348, 130, 348, 152);
    c.bezierCurveTo(330, 158, 310, 144, 304, 130);
    c.bezierCurveTo(298, 118, 300, 106, 304, 98);
    c.closePath();
  };

  // Star sparkle near the horn — a 4-point star.
  const star = (c) => {
    const cx = 280;
    const cy = 60;
    const big = 22;
    const small = 7;
    c.moveTo(cx, cy - big);
    c.lineTo(cx + small, cy - small);
    c.lineTo(cx + big, cy);
    c.lineTo(cx + small, cy + small);
    c.lineTo(cx, cy + big);
    c.lineTo(cx - small, cy + small);
    c.lineTo(cx - big, cy);
    c.lineTo(cx - small, cy - small);
    c.closePath();
  };

  // --- paint in the same back-to-front order as before: body silhouette
  // (neck/chest/head/ear) first, then mane locks layered on top, forelock
  // over the brow, face features, then the star. The lines canvas
  // composes them visually; the mask records each shape's bit so overlap
  // zones (face∩head, mane∩neck, …) become their own sub-regions. ---

  const shapes = [
    neck,      // bit 0
    chest,     // bit 1
    ear,       // bit 2
    head,      // bit 3
    maneLong,  // bit 4
    maneTip1,  // bit 5
    maneMid,   // bit 6
    maneTip2,  // bit 7
    maneTop,   // bit 8
    horn,      // bit 9
    maneFore,  // bit 10
    snout,     // bit 11
    nostril,   // bit 12
    mouth,     // bit 13
    eye,       // bit 14
    star,      // bit 15
  ];
  shapes.forEach((shape, i) => {
    paintShape(scratchCtx, mask, bitFor(i), linesCtx, shape);
  });

  // Spiral grooves on the horn — line-only.
  strokeDetail(linesCtx, (c) => {
    c.moveTo(176, 110);
    c.bezierCurveTo(190, 96, 198, 86, 204, 76);
    c.moveTo(192, 88);
    c.bezierCurveTo(204, 76, 214, 64, 220, 54);
    c.moveTo(208, 64);
    c.bezierCurveTo(220, 52, 228, 42, 234, 34);
  }, 2);

  return { labels: maskToLabelsPng(mask), lines: canvasToPng(linesCv) };
}

// ---------- write ----------

const PICTURES = [
  ["apple", makeApple()],
  ["house", makeHouse()],
  ["star", makeStar()],
  ["cat", makeCat()],
  ["fish", makeFish()],
  ["balloon", makeBalloon()],
  ["cupcake", makeCupcake()],
  ["robot", makeRobot()],
  ["sailboat", makeSailboat()],
  ["flower", makeFlower()],
  ["wolf", makeWolf()],
  ["mermaid", makeMermaid()],
  ["unicorn", makeUnicorn()],
];

for (const [slug, { labels, lines }] of PICTURES) {
  addBackgroundRegion(labels, lines);
  writeFileSync(resolve(ASSETS, `${slug}_labels.png`), PNG.sync.write(labels));
  writeFileSync(resolve(ASSETS, `${slug}_lines.png`), PNG.sync.write(lines));
}

console.log(
  `wrote ${PICTURES.length} (lines, labels) pairs to ${ASSETS}: ${PICTURES.map(
    ([s]) => s
  ).join(", ")}`
);
