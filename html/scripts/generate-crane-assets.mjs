// Generates programmatic art for examples/wrecking-crane:
//
//   sky.png            1600x900 blue gradient + clouds + distant ground
//   crane-base.png     200x600  yellow lattice tower
//   crane-arm.png      500x80   yellow horizontal arm with a hook at the end
//   wrecking-ball.png  120x120  dark gray sphere with highlight
//   chain-link.png     16x24    single chain link (optional rope-style chain)
//   house-wall-*.png   ~100x100 brick wall pieces (a few variants)
//   house-roof-*.png   ~120x80  red roof tiles (left/right slopes + flat)
//   house-door.png     ~70x110  wooden door
//   house-window.png   ~80x80   blue window with frame
//   house-chimney.png  ~60x110  brick chimney
//
// node-canvas does all the rendering. The look matches the playground's
// "cartoon coloring book" aesthetic: solid fills + dark outlines + subtle
// shading.

import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS = resolve(__dirname, "../examples/wrecking-crane/assets");
mkdirSync(ASSETS, { recursive: true });

const OUTLINE = "#2c2418";
const STROKE = 3;

// ---- sky background ----------------------------------------------------

function sky() {
  const W = 1600, H = 900;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");

  // Gradient sky
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#7cc1ef");
  grad.addColorStop(0.7, "#bee2f5");
  grad.addColorStop(1, "#e6f1da");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Soft sun
  const sun = ctx.createRadialGradient(W * 0.78, H * 0.18, 0, W * 0.78, H * 0.18, 220);
  sun.addColorStop(0, "rgba(255,240,200,0.75)");
  sun.addColorStop(1, "rgba(255,240,200,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);

  // Distant hills
  ctx.fillStyle = "#9bc787";
  ctx.beginPath();
  ctx.moveTo(0, H * 0.78);
  ctx.bezierCurveTo(W * 0.2, H * 0.7, W * 0.35, H * 0.82, W * 0.55, H * 0.76);
  ctx.bezierCurveTo(W * 0.75, H * 0.7, W * 0.9, H * 0.82, W, H * 0.78);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  // Closer hill, slightly darker
  ctx.fillStyle = "#86b673";
  ctx.beginPath();
  ctx.moveTo(0, H * 0.84);
  ctx.bezierCurveTo(W * 0.25, H * 0.78, W * 0.5, H * 0.88, W * 0.75, H * 0.82);
  ctx.bezierCurveTo(W * 0.9, H * 0.79, W, H * 0.85, W, H * 0.86);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  // Fluffy clouds
  drawCloud(ctx, 220, 160, 70);
  drawCloud(ctx, 520, 110, 50);
  drawCloud(ctx, 1100, 200, 80);
  drawCloud(ctx, 1380, 130, 55);

  return cv;
}

function drawCloud(ctx, x, y, r) {
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.9, y + r * 0.1, r * 0.85, 0, Math.PI * 2);
  ctx.arc(x - r * 0.85, y + r * 0.15, r * 0.78, 0, Math.PI * 2);
  ctx.arc(x + r * 0.3, y - r * 0.5, r * 0.7, 0, Math.PI * 2);
  ctx.arc(x - r * 0.3, y - r * 0.4, r * 0.65, 0, Math.PI * 2);
  ctx.fill();
}

// ---- crane base (lattice tower) ----------------------------------------
//
// The base is 200 wide × 600 tall. Wider at the bottom, narrower at the top
// to look like a real construction crane tower. Yellow with dark lattice
// cross-bracing.

function craneBase() {
  const W = 200, H = 600;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");

  const YELLOW = "#f0c020";
  const YELLOW_DARK = "#c89510";

  // Trapezoid silhouette: wide bottom, narrow top
  const topW = 96, botW = 180;
  const cx = W / 2;
  const topL = cx - topW / 2;
  const topR = cx + topW / 2;
  const botL = cx - botW / 2;
  const botR = cx + botW / 2;
  const topY = 10;
  const botY = H - 4;

  // Shadow side (right column) — drawn first so left column overlaps
  ctx.fillStyle = YELLOW_DARK;
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(topR, topY);
  ctx.lineTo(botR, botY);
  ctx.lineTo(cx, botY);
  ctx.closePath();
  ctx.fill();

  // Light side (left column)
  ctx.fillStyle = YELLOW;
  ctx.beginPath();
  ctx.moveTo(topL, topY);
  ctx.lineTo(cx, topY);
  ctx.lineTo(cx, botY);
  ctx.lineTo(botL, botY);
  ctx.closePath();
  ctx.fill();

  // Lattice cross-bracing inside the tower. We draw X-patterns between
  // horizontal bands so it reads as steel framework.
  const bands = 8;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (let i = 0; i < bands; i++) {
    const t1 = i / bands;
    const t2 = (i + 1) / bands;
    const lerp = (a, b, t) => a + (b - a) * t;
    const lY = lerp(topY, botY, t1);
    const rY = lerp(topY, botY, t2);
    const lLx = lerp(topL, botL, t1);
    const lRx = lerp(topR, botR, t1);
    const rLx = lerp(topL, botL, t2);
    const rRx = lerp(topR, botR, t2);
    // X: top-left → bottom-right
    ctx.beginPath();
    ctx.moveTo(lLx + 6, lY);
    ctx.lineTo(rRx - 6, rY);
    ctx.stroke();
    // X: top-right → bottom-left
    ctx.beginPath();
    ctx.moveTo(lRx - 6, lY);
    ctx.lineTo(rLx + 6, rY);
    ctx.stroke();
    // Horizontal band
    ctx.beginPath();
    ctx.moveTo(rLx, rY);
    ctx.lineTo(rRx, rY);
    ctx.stroke();
  }

  // Outer outline
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(topL, topY);
  ctx.lineTo(topR, topY);
  ctx.lineTo(botR, botY);
  ctx.lineTo(botL, botY);
  ctx.closePath();
  ctx.stroke();

  // Cap on top — a square housing where the arm joins
  ctx.fillStyle = "#5a4a2a";
  ctx.fillRect(cx - 30, topY - 12, 60, 14);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.strokeRect(cx - 30, topY - 12, 60, 14);

  // Operator cabin nub on the side
  ctx.fillStyle = "#3a78c0";
  ctx.fillRect(cx + 32, topY - 6, 24, 22);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.strokeRect(cx + 32, topY - 6, 24, 22);
  // window
  ctx.fillStyle = "#c8e4ff";
  ctx.fillRect(cx + 36, topY - 2, 16, 10);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx + 36, topY - 2, 16, 10);

  return cv;
}

// ---- crane arm ---------------------------------------------------------
//
// 500 wide × 80 tall. The arm extends to the RIGHT from a pivot at the
// LEFT edge (so the scene can rotate it around the top of the tower).
// Hook fitting at the right end.

function craneArm() {
  const W = 500, H = 80;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");

  const YELLOW = "#f0c020";
  const YELLOW_DARK = "#c89510";

  // Main horizontal beam
  const beamTop = 22;
  const beamBot = 50;
  // Body fill
  ctx.fillStyle = YELLOW;
  ctx.fillRect(8, beamTop, W - 60, beamBot - beamTop);
  // Shadow on bottom half
  ctx.fillStyle = YELLOW_DARK;
  ctx.fillRect(8, (beamTop + beamBot) / 2, W - 60, (beamBot - beamTop) / 2);

  // Lattice cross-bracing along the length
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  const bays = 14;
  const bayW = (W - 60 - 8) / bays;
  for (let i = 0; i < bays; i++) {
    const x0 = 8 + i * bayW;
    const x1 = x0 + bayW;
    ctx.beginPath();
    ctx.moveTo(x0, beamTop);
    ctx.lineTo(x1, beamBot);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, beamTop);
    ctx.lineTo(x0, beamBot);
    ctx.stroke();
  }

  // Top + bottom chord lines
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(8, beamTop);
  ctx.lineTo(W - 52, beamTop);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(8, beamBot);
  ctx.lineTo(W - 52, beamBot);
  ctx.stroke();

  // Pivot disc on the LEFT — sits on top of the tower in-scene
  ctx.fillStyle = "#5a4a2a";
  ctx.beginPath();
  ctx.arc(20, 36, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.stroke();
  // Bolt center
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(20, 36, 5, 0, Math.PI * 2);
  ctx.fill();

  // Hook housing on the RIGHT — a rounded block where the cable attaches
  const hx = W - 38;
  ctx.fillStyle = "#7a6a4a";
  ctx.beginPath();
  ctx.moveTo(hx - 12, beamTop - 4);
  ctx.lineTo(hx + 18, beamTop - 4);
  ctx.lineTo(hx + 18, beamBot + 6);
  ctx.lineTo(hx - 12, beamBot + 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.stroke();
  // pulley wheel
  ctx.fillStyle = "#bbb";
  ctx.beginPath();
  ctx.arc(hx + 3, 50, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(hx + 3, 50, 2.5, 0, Math.PI * 2);
  ctx.fill();

  return cv;
}

// ---- wrecking ball -----------------------------------------------------

function wreckingBall() {
  const S = 120;
  const cv = createCanvas(S, S);
  const ctx = cv.getContext("2d");

  const cx = S / 2, cy = S / 2, r = S / 2 - 6;
  // Radial gradient for the metal sphere look
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  grad.addColorStop(0, "#9ea3a8");
  grad.addColorStop(0.5, "#52575c");
  grad.addColorStop(1, "#1f2226");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Outline
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Highlight
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.35, cy - r * 0.4, r * 0.22, r * 0.12, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Attachment loop on top
  ctx.fillStyle = "#3a3a3a";
  ctx.beginPath();
  ctx.arc(cx, 10, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#9a9a9a";
  ctx.beginPath();
  ctx.arc(cx, 10, 3.5, 0, Math.PI * 2);
  ctx.fill();

  return cv;
}

// ---- chain link --------------------------------------------------------

function chainLink() {
  const W = 16, H = 24;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#5a5f63";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2, W / 2 - 2, H / 2 - 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // inner ellipse to look like a link
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2, W / 2 - 5, H / 2 - 6, 0, 0, Math.PI * 2);
  ctx.stroke();
  // highlight
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 3, 4);
  ctx.lineTo(W / 2 - 3, H - 4);
  ctx.stroke();
  return cv;
}

// ---- house pieces ------------------------------------------------------
//
// Each piece is its own PNG, sized to its natural rectangle. The scene
// places them in pre-authored positions to assemble the house.

function houseWallBrick(w, h) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext("2d");
  // Base red wall
  ctx.fillStyle = "#b6533a";
  ctx.fillRect(0, 0, w, h);
  // Mortar lines (brick pattern)
  const brickH = 14;
  const brickW = 32;
  ctx.strokeStyle = "rgba(40,20,15,0.55)";
  ctx.lineWidth = 1.5;
  for (let y = brickH; y < h; y += brickH) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // Stagger vertical mortar by row
  for (let row = 0, y = 0; y < h; y += brickH, row++) {
    const offset = (row % 2 === 0) ? 0 : brickW / 2;
    for (let x = offset; x < w; x += brickW) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + brickH);
      ctx.stroke();
    }
  }
  // Subtle highlight on top + left
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, 0, w, 3);
  ctx.fillRect(0, 0, 3, h);
  // Outline
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  ctx.strokeRect(STROKE / 2, STROKE / 2, w - STROKE, h - STROKE);
  return cv;
}

function houseRoofTile(w, h) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext("2d");
  // Dark red roof color
  ctx.fillStyle = "#8a2f23";
  ctx.fillRect(0, 0, w, h);
  // Shingle rows
  ctx.fillStyle = "#a73c2a";
  const shingleH = 12;
  for (let y = 0; y < h; y += shingleH * 2) {
    ctx.fillRect(0, y, w, shingleH);
  }
  // Shingle vertical seams
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += shingleH) {
    const offset = ((y / shingleH) % 2 === 0) ? 0 : 12;
    for (let x = offset; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + shingleH);
      ctx.stroke();
    }
  }
  // Outline
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  ctx.strokeRect(STROKE / 2, STROKE / 2, w - STROKE, h - STROKE);
  return cv;
}

function houseRoofPeak(w, h) {
  // A triangular roof peak with transparent corners.
  const cv = createCanvas(w, h);
  const ctx = cv.getContext("2d");
  const triPath = () => {
    ctx.beginPath();
    ctx.moveTo(w * 0.5, 4);
    ctx.lineTo(w - 4, h - 4);
    ctx.lineTo(4, h - 4);
    ctx.closePath();
  };
  ctx.fillStyle = "#8a2f23";
  triPath();
  ctx.fill();

  // Shingle rows clipped to the triangle
  ctx.save();
  triPath();
  ctx.clip();
  ctx.fillStyle = "#a73c2a";
  for (let y = 4; y < h; y += 24) {
    ctx.fillRect(0, y, w, 12);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  for (let y = 4; y < h; y += 12) {
    const offset = ((y / 12) % 2 === 0) ? 0 : 12;
    for (let x = offset; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 12);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  triPath();
  ctx.stroke();
  return cv;
}

function houseDoor(w, h) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext("2d");
  // Door fill — wooden brown
  ctx.fillStyle = "#7a4a22";
  ctx.fillRect(0, 0, w, h);
  // Vertical plank lines
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 4; i++) {
    const x = (i / 4) * w;
    ctx.beginPath();
    ctx.moveTo(x, 4);
    ctx.lineTo(x, h - 4);
    ctx.stroke();
  }
  // Top arch detail
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.arc(w / 2, 0, w / 2 - 6, 0, Math.PI);
  ctx.fill();
  // Door knob
  ctx.fillStyle = "#f0c020";
  ctx.beginPath();
  ctx.arc(w - 14, h / 2 + 4, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Outline
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  ctx.strokeRect(STROKE / 2, STROKE / 2, w - STROKE, h - STROKE);
  return cv;
}

function houseWindow(w, h) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext("2d");
  // Frame
  ctx.fillStyle = "#e9e1c4";
  ctx.fillRect(0, 0, w, h);
  // Glass
  ctx.fillStyle = "#9ed6f0";
  ctx.fillRect(8, 8, w - 16, h - 16);
  // Cross mullions
  ctx.strokeStyle = "#e9e1c4";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w / 2, 8);
  ctx.lineTo(w / 2, h - 8);
  ctx.moveTo(8, h / 2);
  ctx.lineTo(w - 8, h / 2);
  ctx.stroke();
  // Glass highlight
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.moveTo(12, 12);
  ctx.lineTo(20, 12);
  ctx.lineTo(12, 20);
  ctx.closePath();
  ctx.fill();
  // Outline
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  ctx.strokeRect(STROKE / 2, STROKE / 2, w - STROKE, h - STROKE);
  // Inner outline
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  return cv;
}

function houseChimney(w, h) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext("2d");
  // Brick chimney — same brick pattern as walls but narrower
  ctx.fillStyle = "#a64a35";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(40,20,15,0.55)";
  ctx.lineWidth = 1.5;
  const brickH = 13;
  for (let y = brickH; y < h; y += brickH) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let row = 0, y = 0; y < h; y += brickH, row++) {
    const offset = (row % 2 === 0) ? 0 : w / 2;
    for (let x = offset; x < w; x += w) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + brickH);
      ctx.stroke();
    }
  }
  // Top cap
  ctx.fillStyle = "#4a2a18";
  ctx.fillRect(-2, 0, w + 4, 8);
  // Outline
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  ctx.strokeRect(STROKE / 2, STROKE / 2, w - STROKE, h - STROKE);
  return cv;
}

// ---- write everything --------------------------------------------------

function writePng(cv, name) {
  writeFileSync(resolve(ASSETS, name), cv.toBuffer("image/png"));
}

writePng(sky(), "sky.png");
writePng(craneBase(), "crane-base.png");
writePng(craneArm(), "crane-arm.png");
writePng(wreckingBall(), "wrecking-ball.png");
writePng(chainLink(), "chain-link.png");

// House pieces — sizes are tuned so the layout in src/house.ts assembles
// into a recognizable house.
writePng(houseWallBrick(110, 90), "house-wall-a.png");
writePng(houseWallBrick(110, 90), "house-wall-b.png");
writePng(houseWallBrick(110, 90), "house-wall-c.png");
writePng(houseWallBrick(110, 90), "house-wall-d.png");
writePng(houseRoofTile(120, 60), "house-roof-flat.png");
writePng(houseRoofPeak(220, 110), "house-roof-peak.png");
writePng(houseDoor(70, 110), "house-door.png");
writePng(houseWindow(80, 80), "house-window.png");
writePng(houseChimney(50, 110), "house-chimney.png");

console.log(`wrote crane assets to ${ASSETS}`);
