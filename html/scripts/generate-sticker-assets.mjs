// Generates sticker PNGs for examples/sticker-board.
//
// 12 chunky-cartoon stickers, ~128×128 each, transparent background. Every
// sticker is drawn with bold outlines and bright flat fills so it reads
// clearly against the playmat background at any rotation/scale.
//
// Output: examples/sticker-board/assets/<id>.png

import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS = resolve(__dirname, "../examples/sticker-board/assets");
mkdirSync(ASSETS, { recursive: true });

const SIZE = 128;
const OUTLINE = "#1f1c14";
const STROKE = 4;

function newCanvas() {
  const cv = createCanvas(SIZE, SIZE);
  const ctx = cv.getContext("2d");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { cv, ctx };
}

function dot(ctx, x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ---- 1. sun ------------------------------------------------------------

function sun() {
  const { cv, ctx } = newCanvas();
  // rays
  ctx.strokeStyle = "#f5b53a";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const inner = 42;
    const outer = 60;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(a) * inner, 64 + Math.sin(a) * inner);
    ctx.lineTo(64 + Math.cos(a) * outer, 64 + Math.sin(a) * outer);
    ctx.stroke();
  }
  // body
  ctx.fillStyle = "#ffd84a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  ctx.arc(64, 64, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // face
  dot(ctx, 52, 58, 4, OUTLINE);
  dot(ctx, 76, 58, 4, OUTLINE);
  // cheeks
  dot(ctx, 48, 70, 5, "rgba(232,108,120,0.55)");
  dot(ctx, 80, 70, 5, "rgba(232,108,120,0.55)");
  // smile
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(54, 76);
  ctx.bezierCurveTo(60, 84, 68, 84, 74, 76);
  ctx.stroke();
  return cv;
}

// ---- 2. rainbow --------------------------------------------------------

function rainbow() {
  const { cv, ctx } = newCanvas();
  const colors = ["#ff5252", "#ff9f43", "#ffd84a", "#7ed957", "#5b8def", "#a455c4"];
  ctx.lineCap = "butt";
  // arcs from biggest to smallest, stroked thick
  for (let i = 0; i < colors.length; i++) {
    const r = 56 - i * 8;
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(64, 78, r, Math.PI, 0);
    ctx.stroke();
  }
  // outline
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 78, 60, Math.PI, 0);
  ctx.arc(64, 78, 16, 0, Math.PI, true);
  ctx.closePath();
  ctx.stroke();
  // clouds at the ends
  cloud(ctx, 22, 86);
  cloud(ctx, 106, 86);
  return cv;
}

function cloud(ctx, cx, cy) {
  // Three lobes — drawn as separate paths so the connecting "moveTo" lines
  // that arcs add by default don't cross the cloud and pick up the stroke.
  const lobes = [
    [cx - 8, cy, 10],
    [cx + 4, cy - 4, 12],
    [cx + 12, cy + 2, 9],
  ];
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  for (const [x, y, r] of lobes) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

// ---- 3. heart ----------------------------------------------------------

function heart() {
  const { cv, ctx } = newCanvas();
  ctx.fillStyle = "#ff4f7d";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  ctx.moveTo(64, 36);
  ctx.bezierCurveTo(40, 12, 8, 36, 24, 64);
  ctx.bezierCurveTo(36, 84, 56, 96, 64, 108);
  ctx.bezierCurveTo(72, 96, 92, 84, 104, 64);
  ctx.bezierCurveTo(120, 36, 88, 12, 64, 36);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // shine
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.ellipse(46, 44, 8, 14, -0.5, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

// ---- 4. star -----------------------------------------------------------

function starSticker() {
  const { cv, ctx } = newCanvas();
  ctx.fillStyle = "#ffd84a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  const cx = 64, cy = 66;
  const outer = 50, inner = 22;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // face
  dot(ctx, 56, 62, 4, OUTLINE);
  dot(ctx, 72, 62, 4, OUTLINE);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(56, 76);
  ctx.bezierCurveTo(60, 80, 68, 80, 72, 76);
  ctx.stroke();
  // sparkle
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.ellipse(50, 52, 6, 4, -0.5, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

// ---- 5. cat face -------------------------------------------------------

function catFace() {
  const { cv, ctx } = newCanvas();
  // head
  ctx.fillStyle = "#ffb04a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  // ears + head silhouette
  ctx.moveTo(28, 36);
  ctx.lineTo(38, 14);
  ctx.lineTo(54, 36);
  ctx.bezierCurveTo(72, 32, 84, 32, 84, 36);
  ctx.lineTo(98, 14);
  ctx.lineTo(108, 36);
  ctx.bezierCurveTo(120, 56, 116, 88, 96, 104);
  ctx.bezierCurveTo(80, 116, 56, 116, 40, 104);
  ctx.bezierCurveTo(20, 88, 16, 56, 28, 36);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // inner ears
  ctx.fillStyle = "#ff8fb1";
  ctx.beginPath();
  ctx.moveTo(34, 34);
  ctx.lineTo(40, 24);
  ctx.lineTo(48, 34);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(88, 34);
  ctx.lineTo(96, 24);
  ctx.lineTo(102, 34);
  ctx.closePath();
  ctx.fill();
  // eyes
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(50, 64, 5, 8, 0, 0, Math.PI * 2);
  ctx.ellipse(86, 64, 5, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // nose
  ctx.fillStyle = "#ff4f7d";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, 76);
  ctx.lineTo(58, 80);
  ctx.lineTo(70, 80);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // mouth
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(64, 80);
  ctx.lineTo(64, 86);
  ctx.moveTo(64, 86);
  ctx.bezierCurveTo(58, 92, 50, 90, 50, 84);
  ctx.moveTo(64, 86);
  ctx.bezierCurveTo(70, 92, 78, 90, 78, 84);
  ctx.stroke();
  // whiskers
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 78); ctx.lineTo(44, 78);
  ctx.moveTo(20, 86); ctx.lineTo(44, 84);
  ctx.moveTo(108, 78); ctx.lineTo(84, 78);
  ctx.moveTo(108, 86); ctx.lineTo(84, 84);
  ctx.stroke();
  return cv;
}

// ---- 6. dog face -------------------------------------------------------

function dogFace() {
  const { cv, ctx } = newCanvas();
  // ears (drawn first, behind head)
  ctx.fillStyle = "#9b673a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  ctx.ellipse(28, 56, 16, 30, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(100, 56, 16, 30, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // head
  ctx.fillStyle = "#d4a86a";
  ctx.beginPath();
  ctx.arc(64, 70, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // muzzle
  ctx.fillStyle = "#f1d3a8";
  ctx.beginPath();
  ctx.ellipse(64, 86, 22, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // eyes
  ctx.fillStyle = OUTLINE;
  dot(ctx, 50, 64, 5, OUTLINE);
  dot(ctx, 78, 64, 5, OUTLINE);
  // shine
  dot(ctx, 52, 62, 1.6, "#ffffff");
  dot(ctx, 80, 62, 1.6, "#ffffff");
  // nose
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(64, 80, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // mouth
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(64, 86);
  ctx.lineTo(64, 92);
  ctx.bezierCurveTo(58, 98, 52, 96, 52, 90);
  ctx.moveTo(64, 92);
  ctx.bezierCurveTo(70, 98, 76, 96, 76, 90);
  ctx.stroke();
  // tongue
  ctx.fillStyle = "#ff7a9a";
  ctx.beginPath();
  ctx.moveTo(60, 96);
  ctx.bezierCurveTo(60, 104, 68, 104, 68, 96);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return cv;
}

// ---- 7. bow ------------------------------------------------------------

function bow() {
  const { cv, ctx } = newCanvas();
  ctx.fillStyle = "#ff5dca";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  // left loop
  ctx.beginPath();
  ctx.moveTo(64, 64);
  ctx.bezierCurveTo(40, 36, 8, 40, 14, 70);
  ctx.bezierCurveTo(8, 96, 40, 100, 64, 72);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // right loop
  ctx.beginPath();
  ctx.moveTo(64, 64);
  ctx.bezierCurveTo(88, 36, 120, 40, 114, 70);
  ctx.bezierCurveTo(120, 96, 88, 100, 64, 72);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // knot
  ctx.fillStyle = "#d33aa3";
  ctx.beginPath();
  ctx.ellipse(64, 68, 12, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // tails
  ctx.fillStyle = "#ff5dca";
  ctx.beginPath();
  ctx.moveTo(56, 80);
  ctx.lineTo(46, 116);
  ctx.lineTo(58, 110);
  ctx.lineTo(64, 84);
  ctx.closePath();
  ctx.moveTo(72, 80);
  ctx.lineTo(82, 116);
  ctx.lineTo(70, 110);
  ctx.lineTo(64, 84);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // shine
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(34, 60, 6, 4, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(94, 60, 6, 4, 0.4, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

// ---- 8. ice-cream cone -------------------------------------------------

function iceCreamSticker() {
  const { cv, ctx } = newCanvas();
  // cone
  const cone = () => {
    ctx.beginPath();
    ctx.moveTo(28, 70);
    ctx.lineTo(64, 120);
    ctx.lineTo(100, 70);
    ctx.closePath();
  };
  ctx.fillStyle = "#d99a4a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  cone();
  ctx.fill();
  // waffle, clipped
  ctx.save();
  cone();
  ctx.clip();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.5;
  for (let i = -3; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(28 + i * 7, 70);
    ctx.lineTo(28 - 16 + i * 9, 124);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(100 - i * 7, 70);
    ctx.lineTo(100 + 16 - i * 9, 124);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  cone();
  ctx.stroke();
  // scoops — three colored swirls
  const scoop = (cx, cy, r, fill) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = STROKE;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  scoop(64, 56, 28, "#ff8fb1");
  scoop(50, 38, 18, "#a3d9b8");
  scoop(78, 38, 18, "#ffd84a");
  // cherry
  ctx.fillStyle = "#e74c3c";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 22, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#3b6a2a";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(64, 14);
  ctx.bezierCurveTo(70, 6, 80, 6, 84, 12);
  ctx.stroke();
  return cv;
}

// ---- 9. balloon --------------------------------------------------------

function balloon() {
  const { cv, ctx } = newCanvas();
  // balloon body
  ctx.fillStyle = "#5b8def";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  ctx.ellipse(64, 58, 36, 42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // pinch at the bottom
  ctx.beginPath();
  ctx.moveTo(58, 96);
  ctx.lineTo(64, 104);
  ctx.lineTo(70, 96);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // shine
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(48, 44, 8, 14, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // string
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(64, 104);
  ctx.bezierCurveTo(72, 112, 56, 116, 64, 124);
  ctx.stroke();
  return cv;
}

// ---- 10. flower --------------------------------------------------------

function flower() {
  const { cv, ctx } = newCanvas();
  // 5 petals
  ctx.fillStyle = "#ff8fb1";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const x = 64 + Math.cos(a) * 30;
    const y = 64 + Math.sin(a) * 30;
    ctx.beginPath();
    ctx.ellipse(x, y, 22, 16, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // center
  ctx.fillStyle = "#ffd84a";
  ctx.beginPath();
  ctx.arc(64, 64, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // face
  dot(ctx, 58, 62, 2.5, OUTLINE);
  dot(ctx, 70, 62, 2.5, OUTLINE);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(58, 70);
  ctx.bezierCurveTo(62, 73, 66, 73, 70, 70);
  ctx.stroke();
  return cv;
}

// ---- 11. clover --------------------------------------------------------

function clover() {
  const { cv, ctx } = newCanvas();
  ctx.fillStyle = "#7ed957";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = STROKE;
  // 4 leaves
  const leaf = (cx, cy, rot) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    // heart-shaped leaf
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-26, -10, -28, -36, -8, -36);
    ctx.bezierCurveTo(0, -36, 0, -28, 0, -22);
    ctx.bezierCurveTo(0, -28, 0, -36, 8, -36);
    ctx.bezierCurveTo(28, -36, 26, -10, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  leaf(64, 58, 0);
  leaf(64, 58, Math.PI / 2);
  leaf(64, 58, Math.PI);
  leaf(64, 58, -Math.PI / 2);
  // stem
  ctx.strokeStyle = "#3b6a2a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(64, 60);
  ctx.bezierCurveTo(72, 80, 60, 100, 70, 122);
  ctx.stroke();
  // center vein
  ctx.fillStyle = "#3b6a2a";
  ctx.beginPath();
  ctx.arc(64, 58, 4, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

// ---- 12. butterfly -----------------------------------------------------

function butterfly() {
  const { cv, ctx } = newCanvas();
  // wings (drawn first)
  const wing = (cx, cy, rx, ry, fill) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = STROKE;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  // upper wings
  wing(34, 50, 28, 24, "#a455c4");
  wing(94, 50, 28, 24, "#a455c4");
  // lower wings
  wing(40, 84, 22, 22, "#ff5dca");
  wing(88, 84, 22, 22, "#ff5dca");
  // wing spots
  dot(ctx, 30, 50, 5, "#ffd84a");
  dot(ctx, 98, 50, 5, "#ffd84a");
  dot(ctx, 40, 84, 4, "#ffffff");
  dot(ctx, 88, 84, 4, "#ffffff");
  // body
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(64, 70, 6, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  // antennae
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, 42);
  ctx.bezierCurveTo(56, 30, 46, 26, 42, 18);
  ctx.moveTo(64, 42);
  ctx.bezierCurveTo(72, 30, 82, 26, 86, 18);
  ctx.stroke();
  dot(ctx, 42, 18, 3, OUTLINE);
  dot(ctx, 86, 18, 3, OUTLINE);
  // smile
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, 56);
  ctx.bezierCurveTo(62, 60, 66, 60, 68, 56);
  ctx.stroke();
  // eyes
  dot(ctx, 60, 50, 2, "#ffffff");
  dot(ctx, 68, 50, 2, "#ffffff");
  return cv;
}

// ---- write -------------------------------------------------------------

const stickers = {
  sun,
  rainbow,
  heart,
  star: starSticker,
  cat: catFace,
  dog: dogFace,
  bow,
  "ice-cream": iceCreamSticker,
  balloon,
  flower,
  clover,
  butterfly,
};

for (const [name, fn] of Object.entries(stickers)) {
  writeFileSync(resolve(ASSETS, `${name}.png`), fn().toBuffer("image/png"));
}

console.log(`wrote ${Object.keys(stickers).length} stickers to ${ASSETS}`);
