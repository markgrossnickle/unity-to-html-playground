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
