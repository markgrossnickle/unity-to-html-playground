// Generates PNG assets for examples/space-dodge.
//
// Output (all transparent backgrounds):
//   examples/space-dodge/assets/ship.png         64x64
//   examples/space-dodge/assets/asteroid-1.png   96x96
//   examples/space-dodge/assets/asteroid-2.png   96x96
//   examples/space-dodge/assets/asteroid-3.png   96x96
//   examples/space-dodge/assets/heart.png        32x32

import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS = resolve(__dirname, "../examples/space-dodge/assets");
mkdirSync(ASSETS, { recursive: true });

// ---- helpers ------------------------------------------------------------

function save(canvas, name) {
  const out = resolve(ASSETS, name);
  writeFileSync(out, canvas.toBuffer("image/png"));
  console.log("wrote", out);
}

// Simple deterministic PRNG so the asteroid silhouettes are stable across
// regenerations (no flicker in git diffs for unchanged inputs).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- ship ---------------------------------------------------------------

const SHIP_BODY = "#37e6ff";       // bright cyan
const SHIP_BODY_DARK = "#1a8aa6";
const SHIP_COCKPIT = "#ffe871";
const SHIP_OUTLINE = "#0b1620";
const THRUSTER = "#ff8a3b";
const THRUSTER_HOT = "#ffe28a";

function drawShip() {
  const W = 64;
  const H = 64;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Twin thrusters at the bottom — drawn first so the hull covers their tops.
  drawFlame(ctx, 22, 50, 6, 12);
  drawFlame(ctx, 42, 50, 6, 12);

  // Main hull: a pointed-up triangle with rounded shoulders. Slight gradient
  // for depth (cyan top, darker bottom).
  const grad = ctx.createLinearGradient(0, 6, 0, 56);
  grad.addColorStop(0, SHIP_BODY);
  grad.addColorStop(1, SHIP_BODY_DARK);
  ctx.fillStyle = grad;
  ctx.strokeStyle = SHIP_OUTLINE;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(32, 6);                       // nose
  ctx.lineTo(54, 50);                      // right wing tip
  ctx.lineTo(46, 54);                      // right rear inset
  ctx.lineTo(38, 50);                      // right tail
  ctx.lineTo(26, 50);                      // left tail
  ctx.lineTo(18, 54);                      // left rear inset
  ctx.lineTo(10, 50);                      // left wing tip
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cockpit — yellow round-ish window high on the hull.
  ctx.fillStyle = SHIP_COCKPIT;
  ctx.strokeStyle = SHIP_OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(32, 24, 6, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Center fin line for hull detail.
  ctx.strokeStyle = SHIP_BODY_DARK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(32, 36);
  ctx.lineTo(32, 50);
  ctx.stroke();

  return cv;
}

function drawFlame(ctx, cx, topY, halfW, h) {
  // A tapered teardrop pointing down — outer orange, hot yellow core.
  ctx.fillStyle = THRUSTER;
  ctx.beginPath();
  ctx.moveTo(cx - halfW, topY);
  ctx.quadraticCurveTo(cx - halfW * 0.4, topY + h * 0.6, cx, topY + h);
  ctx.quadraticCurveTo(cx + halfW * 0.4, topY + h * 0.6, cx + halfW, topY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = THRUSTER_HOT;
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 0.5, topY + 1);
  ctx.quadraticCurveTo(cx - halfW * 0.2, topY + h * 0.55, cx, topY + h - 2);
  ctx.quadraticCurveTo(cx + halfW * 0.2, topY + h * 0.55, cx + halfW * 0.5, topY + 1);
  ctx.closePath();
  ctx.fill();
}

// ---- asteroids ----------------------------------------------------------

const ROCK_FILL = "#5a5a66";
const ROCK_FILL_DARK = "#3b3b46";
const ROCK_OUTLINE = "#1c1c22";
const CRATER = "#2a2a32";
const HIGHLIGHT = "rgba(255,255,255,0.10)";

function drawAsteroid(seed) {
  const SIZE = 96;
  const cv = createCanvas(SIZE, SIZE);
  const ctx = cv.getContext("2d");
  const rand = mulberry32(seed);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const baseR = 38;

  // Build a noisy circular outline by sampling angles at irregular intervals
  // and perturbing the radius. Higher-frequency wobble + low-frequency lumps
  // makes it read as rock, not as a smooth blob.
  const pts = [];
  const segs = 22;
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const lump = Math.sin(t * 3 + rand() * 0.8) * 4;
    const wobble = (rand() - 0.5) * 6;
    const r = baseR + lump + wobble;
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }

  // Body fill with a subtle radial shading.
  const grad = ctx.createRadialGradient(cx - 8, cy - 10, 6, cx, cy, baseR + 6);
  grad.addColorStop(0, ROCK_FILL);
  grad.addColorStop(1, ROCK_FILL_DARK);
  ctx.fillStyle = grad;
  ctx.strokeStyle = ROCK_OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i];
    const [pxN, pyN] = pts[(i + 1) % pts.length];
    // Quadratic between midpoints to smooth the polygon corners slightly.
    const mx = (px + pxN) / 2;
    const my = (py + pyN) / 2;
    ctx.quadraticCurveTo(px, py, mx, my);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // A few craters — darker filled circles with a thin highlight arc.
  const craterCount = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < craterCount; i++) {
    const a = rand() * Math.PI * 2;
    const d = rand() * (baseR - 14);
    const rx = cx + Math.cos(a) * d;
    const ry = cy + Math.sin(a) * d;
    const rr = 3 + rand() * 6;
    ctx.fillStyle = CRATER;
    ctx.beginPath();
    ctx.arc(rx, ry, rr, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = HIGHLIGHT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rx, ry, rr, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }

  // Top-left highlight crescent for extra dimensionality.
  ctx.strokeStyle = HIGHLIGHT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR - 4, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();

  return cv;
}

// ---- heart --------------------------------------------------------------

function drawHeart() {
  const SIZE = 32;
  const cv = createCanvas(SIZE, SIZE);
  const ctx = cv.getContext("2d");

  ctx.fillStyle = "#ff4a6b";
  ctx.strokeStyle = "#3a0a14";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";

  // Classic two-lobe heart drawn with two bezier curves.
  ctx.beginPath();
  ctx.moveTo(16, 28);
  ctx.bezierCurveTo(2, 18, 2, 6, 10, 6);
  ctx.bezierCurveTo(14, 6, 16, 10, 16, 12);
  ctx.bezierCurveTo(16, 10, 18, 6, 22, 6);
  ctx.bezierCurveTo(30, 6, 30, 18, 16, 28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Small specular highlight on the left lobe.
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(11, 11, 2.2, 1.4, -0.6, 0, Math.PI * 2);
  ctx.fill();

  return cv;
}

// ---- run ----------------------------------------------------------------

save(drawShip(), "ship.png");
save(drawAsteroid(101), "asteroid-1.png");
save(drawAsteroid(202), "asteroid-2.png");
save(drawAsteroid(303), "asteroid-3.png");
save(drawHeart(), "heart.png");
