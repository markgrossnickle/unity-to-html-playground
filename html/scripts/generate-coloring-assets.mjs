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
//   apple    — body, stem, leaf, highlight                            (4 regions)
//   house    — sky, walls, roof, door, two windows                    (6 regions)
//   star     — five outer points + center pentagon                    (6 regions)
//   cat      — body, head, two ears, two eyes, nose, tail             (8 regions)
//   fish     — body, top fin, bottom fin, tail fin, eye, scales       (6 regions)
//   balloon  — sky, three balloon stripes, basket                     (5 regions)
//   cupcake  — three frosting layers, wrapper, cherry                 (5 regions)
//   robot    — body, two arms, head, two eyes, antenna ball           (7 regions)
//   sailboat — sky, water, hull, two sails, sun                       (6 regions)
//   flower   — stem, leaf, five petals, center                        (8 regions)
//   wolf     — node-canvas portrait, 12 regions
//   mermaid  — node-canvas figure, 16 regions (incl. 4 bubbles)
//   unicorn  — node-canvas profile, 14 regions
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

// Like fillEllipse but only fills pixels where yMin <= y < yMax. Used to slice
// an ellipse into horizontal stripes (balloon, swirly frosting).
function fillEllipseSlab(img, cx, cy, rx, ry, yMin, yMax, c) {
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const minY = Math.max(yMin, Math.max(0, Math.floor(cy - ry)));
  const maxY = Math.min(yMax - 1, Math.min(img.height - 1, Math.ceil(cy + ry)));
  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    const span = Math.sqrt(Math.max(0, rx2 * (1 - (dy * dy) / ry2)));
    const minX = Math.max(0, Math.floor(cx - span));
    const maxX = Math.min(img.width - 1, Math.ceil(cx + span));
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
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

// Horizontal chord across an ellipse at y, drawn as a thick stroke. Used for
// the balloon stripe separators (outline-only — the regions are already split
// in the labels via fillEllipseSlab).
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

function makeCat() {
  const labels = makeImage(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Body sits low; head perches above; ears cap the head; tail curls out to
  // the right. Eyes + nose overlay the head and need to be small but still
  // ≥30px so a finger pad can hit them on a phone.
  const tail = { cx: 388, cy: 410, rx: 78, ry: 18 };
  fillEllipse(labels, tail.cx, tail.cy, tail.rx, tail.ry, id(8));

  const body = { cx: 256, cy: 380, rx: 120, ry: 80 };
  fillEllipse(labels, body.cx, body.cy, body.rx, body.ry, id(1));

  const head = { cx: 256, cy: 230, rx: 110, ry: 95 };
  fillEllipse(labels, head.cx, head.cy, head.rx, head.ry, id(2));

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
  fillPolygon(labels, earL, id(3));
  fillPolygon(labels, earR, id(4));

  const eyeL = { cx: 220, cy: 220, rx: 14, ry: 18 };
  const eyeR = { cx: 292, cy: 220, rx: 14, ry: 18 };
  fillEllipse(labels, eyeL.cx, eyeL.cy, eyeL.rx, eyeL.ry, id(5));
  fillEllipse(labels, eyeR.cx, eyeR.cy, eyeR.rx, eyeR.ry, id(6));

  const nose = [
    [246, 252],
    [266, 252],
    [256, 268],
  ];
  fillPolygon(labels, nose, id(7));

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

  return { labels, lines };
}

function makeFish() {
  const labels = makeImage(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Body is a horizontal oval; tail fin sits behind on the right; top + bottom
  // fins above/below body; eye and a "scales" oval inside the body.
  const tail = [
    [360, 256],
    [450, 180],
    [450, 332],
  ];
  fillPolygon(labels, tail, id(2));

  const body = { cx: 240, cy: 256, rx: 140, ry: 85 };
  fillEllipse(labels, body.cx, body.cy, body.rx, body.ry, id(1));

  const topFin = [
    [200, 180],
    [260, 100],
    [300, 180],
  ];
  fillPolygon(labels, topFin, id(3));

  const botFin = [
    [200, 332],
    [260, 410],
    [300, 332],
  ];
  fillPolygon(labels, botFin, id(4));

  // Scales: an oval segment inside the body (the "tummy" patch).
  fillEllipse(labels, 270, 285, 60, 35, id(6));

  const eye = { cx: 165, cy: 240, rx: 16, ry: 16 };
  fillEllipse(labels, eye.cx, eye.cy, eye.rx, eye.ry, id(5));

  // Lines
  strokePolygon(lines, tail, BLACK, STROKE);
  strokeEllipse(lines, body.cx, body.cy, body.rx, body.ry, BLACK, STROKE);
  strokePolygon(lines, topFin, BLACK, STROKE);
  strokePolygon(lines, botFin, BLACK, STROKE);
  strokeEllipse(lines, 270, 285, 60, 35, BLACK, STROKE);
  strokeEllipse(lines, eye.cx, eye.cy, eye.rx, eye.ry, BLACK, STROKE);

  return { labels, lines };
}

function makeBalloon() {
  const labels = makeImage(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Sky covers everything; balloon + basket overlay it. Balloon is a single
  // circle split into 3 horizontal stripes via fillEllipseSlab.
  fillRect(labels, 0, 0, SIZE, SIZE, id(1));

  const balloon = { cx: 256, cy: 200, r: 130 };
  const yTop = balloon.cy - balloon.r;       // 70
  const yMid1 = balloon.cy - balloon.r / 3;  // ~157
  const yMid2 = balloon.cy + balloon.r / 3;  // ~243
  const yBot = balloon.cy + balloon.r;       // 330
  fillEllipseSlab(labels, balloon.cx, balloon.cy, balloon.r, balloon.r, yTop, yMid1, id(2));
  fillEllipseSlab(labels, balloon.cx, balloon.cy, balloon.r, balloon.r, yMid1, yMid2, id(3));
  fillEllipseSlab(labels, balloon.cx, balloon.cy, balloon.r, balloon.r, yMid2, yBot + 1, id(4));

  const basket = { x: 226, y: 380, w: 60, h: 50 };
  fillRect(labels, basket.x, basket.y, basket.w, basket.h, id(5));

  // Lines: balloon silhouette + 2 stripe-divider chords + basket + ropes.
  strokeEllipse(lines, balloon.cx, balloon.cy, balloon.r, balloon.r, BLACK, STROKE);
  drawEllipseChord(lines, balloon.cx, balloon.cy, balloon.r, balloon.r, yMid1, BLACK, STROKE);
  drawEllipseChord(lines, balloon.cx, balloon.cy, balloon.r, balloon.r, yMid2, BLACK, STROKE);
  strokeRect(lines, basket.x, basket.y, basket.w, basket.h, BLACK, STROKE);
  // Ropes from balloon bottom to basket top corners.
  drawLine(lines, balloon.cx - 60, yBot - 8, basket.x + 6, basket.y, BLACK, STROKE);
  drawLine(lines, balloon.cx + 60, yBot - 8, basket.x + basket.w - 6, basket.y, BLACK, STROKE);

  return { labels, lines };
}

function makeCupcake() {
  const labels = makeImage(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Wrapper trapezoid (wider at top, narrows toward bottom).
  const wrapper = [
    [148, 295],
    [364, 295],
    [340, 460],
    [172, 460],
  ];
  fillPolygon(labels, wrapper, id(4));

  // Three swirled frosting layers, painted bottom-up so each tier covers a
  // bit of the one below it.
  fillEllipse(labels, 256, 275, 130, 55, id(1));
  fillEllipse(labels, 256, 220, 100, 45, id(2));
  fillEllipse(labels, 256, 170, 70, 35, id(3));

  // Cherry on top.
  fillEllipse(labels, 256, 125, 22, 22, id(5));

  // Lines
  strokePolygon(lines, wrapper, BLACK, STROKE);
  strokeEllipse(lines, 256, 275, 130, 55, BLACK, STROKE);
  strokeEllipse(lines, 256, 220, 100, 45, BLACK, STROKE);
  strokeEllipse(lines, 256, 170, 70, 35, BLACK, STROKE);
  strokeEllipse(lines, 256, 125, 22, 22, BLACK, STROKE);

  return { labels, lines };
}

function makeRobot() {
  const labels = makeImage(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Body first, then arms attach to its sides, then head sits above, then
  // facial features overlay the head.
  const body = { x: 184, y: 280, w: 144, h: 160 };
  fillRect(labels, body.x, body.y, body.w, body.h, id(1));

  const armL = { x: 130, y: 290, w: 50, h: 110 };
  const armR = { x: 332, y: 290, w: 50, h: 110 };
  fillRect(labels, armL.x, armL.y, armL.w, armL.h, id(2));
  fillRect(labels, armR.x, armR.y, armR.w, armR.h, id(3));

  const head = { x: 200, y: 130, w: 112, h: 130 };
  fillRect(labels, head.x, head.y, head.w, head.h, id(4));

  const eyeL = { cx: 228, cy: 175, r: 14 };
  const eyeR = { cx: 284, cy: 175, r: 14 };
  fillEllipse(labels, eyeL.cx, eyeL.cy, eyeL.r, eyeL.r, id(5));
  fillEllipse(labels, eyeR.cx, eyeR.cy, eyeR.r, eyeR.r, id(6));

  const antenna = { cx: 256, cy: 90, r: 16 };
  fillEllipse(labels, antenna.cx, antenna.cy, antenna.r, antenna.r, id(7));

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

  return { labels, lines };
}

function makeSailboat() {
  const labels = makeImage(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // Sky → water → hull → sails → sun. Sails painted last so the mast line
  // (drawn only on the lines image) cuts cleanly between them.
  fillRect(labels, 0, 0, SIZE, SIZE, id(1)); // sky
  fillRect(labels, 0, 380, SIZE, SIZE - 380, id(2)); // water

  const hull = [
    [165, 360],
    [347, 360],
    [310, 412],
    [202, 412],
  ];
  fillPolygon(labels, hull, id(3));

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
  fillPolygon(labels, sailBack, id(4));
  fillPolygon(labels, sailFront, id(5));

  const sun = { cx: 420, cy: 110, r: 42 };
  fillEllipse(labels, sun.cx, sun.cy, sun.r, sun.r, id(6));

  // Lines
  drawLine(lines, 0, 380, SIZE - 1, 380, BLACK, STROKE); // waterline
  strokePolygon(lines, hull, BLACK, STROKE);
  strokePolygon(lines, sailBack, BLACK, STROKE);
  strokePolygon(lines, sailFront, BLACK, STROKE);
  drawLine(lines, 256, 195, 256, 360, BLACK, STROKE); // mast
  strokeEllipse(lines, sun.cx, sun.cy, sun.r, sun.r, BLACK, STROKE);

  return { labels, lines };
}

function makeFlower() {
  const labels = makeImage(SIZE, SIZE);
  const lines = makeImage(SIZE, SIZE);

  // 5 petals around a center, plus stem and leaf below.
  const cx = 256;
  const cy = 220;
  const R = 80;
  const petalR = 50;
  const centerR = 38;

  const stem = { x: 248, y: 295, w: 16, h: 165 };
  fillRect(labels, stem.x, stem.y, stem.w, stem.h, id(1));

  const leaf = { cx: 320, cy: 365, rx: 50, ry: 22 };
  fillEllipse(labels, leaf.cx, leaf.cy, leaf.rx, leaf.ry, id(2));

  // 5 evenly spaced petals at angles 90°, 162°, 234°, 306°, 18°. Petal
  // circles overlap each other near the center; the center disk on top
  // overwrites the overlap zone so each petal owns the "outer half" of its
  // own circle.
  const petalAngles = [90, 162, 234, 306, 18];
  const petalPositions = petalAngles.map((deg) => {
    const r = (deg * Math.PI) / 180;
    return [cx + R * Math.cos(r), cy - R * Math.sin(r)];
  });
  petalPositions.forEach(([px, py], i) => {
    fillEllipse(labels, px, py, petalR, petalR, id(3 + i));
  });

  fillEllipse(labels, cx, cy, centerR, centerR, id(8));

  // Lines
  strokeRect(lines, stem.x, stem.y, stem.w, stem.h, BLACK, STROKE);
  strokeEllipse(lines, leaf.cx, leaf.cy, leaf.rx, leaf.ry, BLACK, STROKE);
  petalPositions.forEach(([px, py]) => {
    strokeEllipse(lines, px, py, petalR, petalR, BLACK, STROKE);
  });
  strokeEllipse(lines, cx, cy, centerR, centerR, BLACK, STROKE);

  return { labels, lines };
}

// ---------- node-canvas helpers (wolf / mermaid / unicorn) ----------
//
// The original 10 pictures are simple-enough to express as pngjs primitives.
// The three showcase subjects (wolf, mermaid, unicorn) need real curves, so
// we draw them with node-canvas and then wrap each canvas back into a pngjs
// PNG so the rest of the pipeline (background pass, file write) is uniform.
//
// Two canvases per picture: a `labels` canvas with antialias='none' so the
// label-map stays a flat-color id buffer (every pixel snaps to one region),
// and a `lines` canvas with normal AA so the visible outlines look smooth.

function newLabelsCanvas() {
  const cv = createCanvas(SIZE, SIZE);
  const ctx = cv.getContext("2d");
  ctx.antialias = "none"; // crisp edges — every label pixel must be flat color
  ctx.imageSmoothingEnabled = false;
  return { cv, ctx };
}

function newLinesCanvas() {
  const cv = createCanvas(SIZE, SIZE);
  const ctx = cv.getContext("2d");
  ctx.antialias = "default";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
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

// Paint one region: fill the path with the region's id-color in the labels
// canvas AND stroke its outline in the lines canvas. The `path` callback
// runs against whichever ctx we're using — don't allocate Path2D, just
// re-issue the same path commands twice.
function paintRegion(labelsCtx, linesCtx, regionId, path) {
  labelsCtx.fillStyle = `rgb(${regionId},0,0)`;
  labelsCtx.beginPath();
  path(labelsCtx);
  labelsCtx.fill();

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
  const { cv: labelsCv, ctx: labelsCtx } = newLabelsCanvas();
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

  // --- paint in dependency order: back → front. ids stay independent. ---

  paintRegion(labelsCtx, linesCtx, 11, neckFur);
  paintRegion(labelsCtx, linesCtx, 1, head);
  paintRegion(labelsCtx, linesCtx, 2, earL);
  paintRegion(labelsCtx, linesCtx, 3, earR);
  paintRegion(labelsCtx, linesCtx, 4, earInL);
  paintRegion(labelsCtx, linesCtx, 5, earInR);
  paintRegion(labelsCtx, linesCtx, 6, snout);
  paintRegion(labelsCtx, linesCtx, 7, nose);
  paintRegion(labelsCtx, linesCtx, 8, eyeL);
  paintRegion(labelsCtx, linesCtx, 9, eyeR);
  paintRegion(labelsCtx, linesCtx, 10, mouth);
  paintRegion(labelsCtx, linesCtx, 12, chest);

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

  return { labels: canvasToPng(labelsCv), lines: canvasToPng(linesCv) };
}

// ---------- mermaid ----------
//
// Front-facing figure with a long S-curve tail and four bubble accents.
// 16 regions: hair, face, neck, two shell-bra cups, torso skin, two arms,
// two hands, tail upper, tail lower, two flukes, four bubbles.

function makeMermaid() {
  const { cv: labelsCv, ctx: labelsCtx } = newLabelsCanvas();
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

  // --- paint order (back to front) ---

  paintRegion(labelsCtx, linesCtx, 1, hair); // hair behind everything
  paintRegion(labelsCtx, linesCtx, 7, armL); // arms partly behind torso
  paintRegion(labelsCtx, linesCtx, 8, armR);
  paintRegion(labelsCtx, linesCtx, 11, tailUpper);
  paintRegion(labelsCtx, linesCtx, 12, tailLower);
  paintRegion(labelsCtx, linesCtx, 13, flukeL);
  paintRegion(labelsCtx, linesCtx, 14, flukeR);
  paintRegion(labelsCtx, linesCtx, 6, torso);
  paintRegion(labelsCtx, linesCtx, 4, braL);
  paintRegion(labelsCtx, linesCtx, 5, braR);
  paintRegion(labelsCtx, linesCtx, 3, neck);
  paintRegion(labelsCtx, linesCtx, 2, face);
  paintRegion(labelsCtx, linesCtx, 9, handL);
  paintRegion(labelsCtx, linesCtx, 10, handR);
  // Bubbles each get their own id so the player can pick a different colour
  // for every one. Sized ≥18px radius so finger pads can hit them on phones.
  paintRegion(labelsCtx, linesCtx, 15, bubble(70, 90, 24));
  paintRegion(labelsCtx, linesCtx, 16, bubble(442, 124, 20));
  paintRegion(labelsCtx, linesCtx, 17, bubble(88, 358, 18));
  paintRegion(labelsCtx, linesCtx, 18, bubble(454, 396, 22));

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

  return { labels: canvasToPng(labelsCv), lines: canvasToPng(linesCv) };
}

// ---------- unicorn ----------
//
// Profile facing left: head + neck + chest, with three flowing mane sections,
// a spiral horn, and a small star sparkle. ~14 regions.

function makeUnicorn() {
  const { cv: labelsCv, ctx: labelsCtx } = newLabelsCanvas();
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

  // --- paint order: mane back layers and ear behind head, head over them,
  // then snout, then features, neck/chest below. ---

  // Paint order: body (neck/chest/head/ear) first so the silhouette is
  // established, then mane locks on top (their inner edges trace the body
  // boundary so they don't spill INTO the silhouette), forelock last over
  // the brow, then face features and the star.
  paintRegion(labelsCtx, linesCtx, 8, neck);
  paintRegion(labelsCtx, linesCtx, 9, chest);
  paintRegion(labelsCtx, linesCtx, 6, ear);
  paintRegion(labelsCtx, linesCtx, 1, head);
  paintRegion(labelsCtx, linesCtx, 10, maneLong);
  paintRegion(labelsCtx, linesCtx, 13, maneTip1);
  paintRegion(labelsCtx, linesCtx, 11, maneMid);
  paintRegion(labelsCtx, linesCtx, 14, maneTip2);
  paintRegion(labelsCtx, linesCtx, 16, maneTop); // numbered after tips so paint order works
  paintRegion(labelsCtx, linesCtx, 7, horn);
  paintRegion(labelsCtx, linesCtx, 12, maneFore);
  paintRegion(labelsCtx, linesCtx, 2, snout);
  paintRegion(labelsCtx, linesCtx, 3, nostril);
  paintRegion(labelsCtx, linesCtx, 4, mouth);
  paintRegion(labelsCtx, linesCtx, 5, eye);
  paintRegion(labelsCtx, linesCtx, 15, star);

  // Spiral grooves on the horn — line-only.
  strokeDetail(linesCtx, (c) => {
    c.moveTo(176, 110);
    c.bezierCurveTo(190, 96, 198, 86, 204, 76);
    c.moveTo(192, 88);
    c.bezierCurveTo(204, 76, 214, 64, 220, 54);
    c.moveTo(208, 64);
    c.bezierCurveTo(220, 52, 228, 42, 234, 34);
  }, 2);

  return { labels: canvasToPng(labelsCv), lines: canvasToPng(linesCv) };
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
