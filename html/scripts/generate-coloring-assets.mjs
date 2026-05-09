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
// Subjects (each chosen to give the player a satisfyingly distinct set of
// regions, none too small to tap on a phone):
//   apple   — body, stem, leaf, highlight                            (4 regions)
//   house   — sky, walls, roof, door, two windows                    (6 regions)
//   star    — five outer points + center pentagon                    (6 regions)

import { PNG } from "pngjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS = resolve(__dirname, "../examples/coloring-book/assets");
mkdirSync(ASSETS, { recursive: true });

const SIZE = 512;
const STROKE = 4; // outline thickness in pixels

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

function fillEllipse(img, cx, cy, rx, ry, c) {
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const minY = Math.max(0, Math.floor(cy - ry));
  const maxY = Math.min(img.height - 1, Math.ceil(cy + ry));
  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    const span = Math.sqrt(Math.max(0, rx2 * (1 - (dy * dy) / ry2)));
    const minX = Math.max(0, Math.floor(cx - span));
    const maxX = Math.min(img.width - 1, Math.ceil(cx + span));
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      // tighter inside-ellipse test to avoid corner pixels bleeding
      if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1) setPx(img, x, y, c);
    }
  }
}

// Even-odd scanline fill; vertices may be fractional. Works for convex and
// simple concave polygons (the only kinds we author here).
function fillPolygon(img, points, c) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(img.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      // strict-on-one-side comparison handles vertices on the scanline
      if ((y1 > y) !== (y2 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(xs[i]));
      const x1 = Math.min(img.width - 1, Math.floor(xs[i + 1]));
      for (let x = x0; x <= x1; x++) setPx(img, x, y, c);
    }
  }
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
// Region color in labels PNG: id encoded into R channel, alpha=255.
// At runtime: regionId = labels[idx].r (when labels[idx].a > 0).
const id = (n) => [n, 0, 0, 255];

// ---------- pictures ----------

function makeApple() {
  const labels = makeImage(SIZE, SIZE);
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

  // Labels: paint regions in dependency order — body first, highlight on top
  // of body. Stem and leaf are outside the body.
  fillEllipse(labels, bodyCX, bodyCY, bodyRX, bodyRY, id(1)); // body
  fillEllipse(labels, hlCX, hlCY, hlRX, hlRY, id(4)); // highlight (overwrites body)
  fillRect(labels, stemX, stemY, stemW, stemH, id(2)); // stem
  fillEllipse(labels, leafCX, leafCY, leafRX, leafRY, id(3)); // leaf

  // Lines: same shape outlines, sharp black on transparent.
  strokeEllipse(lines, bodyCX, bodyCY, bodyRX, bodyRY, BLACK, STROKE);
  strokeEllipse(lines, hlCX, hlCY, hlRX, hlRY, BLACK, STROKE);
  strokeRect(lines, stemX, stemY, stemW, stemH, BLACK, STROKE);
  strokeEllipse(lines, leafCX, leafCY, leafRX, leafRY, BLACK, STROKE);

  return { labels, lines };
}

function makeHouse() {
  const labels = makeImage(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Sky covers the whole canvas; everything else paints on top.
  fillRect(labels, 0, 0, SIZE, SIZE, id(1)); // sky

  // Walls: the body of the house.
  const wallX = 100;
  const wallY = 280;
  const wallW = 312;
  const wallH = 180;
  fillRect(labels, wallX, wallY, wallW, wallH, id(2));

  // Roof: triangular cap above walls.
  const roof = [
    [80, 280],
    [256, 130],
    [432, 280],
  ];
  fillPolygon(labels, roof, id(3));

  // Door + windows overwrite parts of the wall.
  const doorX = 220;
  const doorY = 360;
  const doorW = 70;
  const doorH = 100;
  fillRect(labels, doorX, doorY, doorW, doorH, id(4)); // door

  const w1X = 140;
  const w1Y = 320;
  const w2X = 310;
  const w2Y = 320;
  const winW = 60;
  const winH = 60;
  fillRect(labels, w1X, w1Y, winW, winH, id(5)); // window 1
  fillRect(labels, w2X, w2Y, winW, winH, id(6)); // window 2

  // Lines: outline every region.
  strokePolygon(lines, roof, BLACK, STROKE);
  strokeRect(lines, wallX, wallY, wallW, wallH, BLACK, STROKE);
  strokeRect(lines, doorX, doorY, doorW, doorH, BLACK, STROKE);
  strokeRect(lines, w1X, w1Y, winW, winH, BLACK, STROKE);
  strokeRect(lines, w2X, w2Y, winW, winH, BLACK, STROKE);

  return { labels, lines };
}

function makeStar() {
  const labels = makeImage(SIZE, SIZE);
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

  // Each tip triangle uses [outer, prev_inner, next_inner]. Paint tips first
  // (regions 1..5), then center pentagon (region 6) — order doesn't matter
  // since the regions don't overlap.
  for (let i = 0; i < 5; i++) {
    const outer = verts[i * 2];
    const prevInner = verts[(i * 2 - 1 + 10) % 10];
    const nextInner = verts[(i * 2 + 1) % 10];
    fillPolygon(labels, [outer, nextInner, prevInner], id(i + 1));
  }
  fillPolygon(labels, pentagon, id(6));

  // Outlines: the star silhouette + the pentagon (which separates tips from center).
  strokePolygon(lines, verts, BLACK, STROKE);
  strokePolygon(lines, pentagon, BLACK, STROKE);

  return { labels, lines };
}

// ---------- write ----------

const PICTURES = [
  ["apple", makeApple()],
  ["house", makeHouse()],
  ["star", makeStar()],
];

for (const [slug, { labels, lines }] of PICTURES) {
  writeFileSync(resolve(ASSETS, `${slug}_labels.png`), PNG.sync.write(labels));
  writeFileSync(resolve(ASSETS, `${slug}_lines.png`), PNG.sync.write(lines));
}

console.log(
  `wrote ${PICTURES.length} (lines, labels) pairs to ${ASSETS}: ${PICTURES.map(
    ([s]) => s
  ).join(", ")}`
);
