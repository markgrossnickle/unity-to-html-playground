// Generates stegosaurus + drawer-object PNGs for examples/dino-drop.
//
// Output:
//   examples/dino-drop/assets/stegosaurus.png   600x400, transparent bg
//   examples/dino-drop/assets/<obj>.png         96x96 each, transparent bg
//
// We draw with node-canvas so the curves come out smooth. Every shape uses a
// dark outline + flat fill — the look is "cartoon coloring book," matching
// the playground's existing aesthetic.

import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS = resolve(__dirname, "../examples/dino-drop/assets");
mkdirSync(ASSETS, { recursive: true });

// ---- shared palette -----------------------------------------------------

const OUTLINE = "#2c2418";
const SHADOW = "rgba(0,0,0,0.18)";

// ---- stegosaurus --------------------------------------------------------
//
// The stegosaurus is rendered into TWO separate PNG layers so the scene can
// rotate the tail independently for the slap animation:
//   stegosaurus-body.png  — body + head + plates + legs + shadow (no tail)
//   stegosaurus-tail.png  — just the tail, sized to the same 600x400 canvas
//                           so its pivot point lines up 1:1 with the body.
//
// Both PNGs share art-space coordinates (origin top-left, x→right, y→down).
// The tail-pivot in art-space is (~200, 195) — exported via dinoBody.ts.

const DINO_W = 600;
const DINO_H = 400;

function drawStegosaurusBody() {
  const cv = createCanvas(DINO_W, DINO_H);
  const ctx = cv.getContext("2d");

  // Soft ground shadow under the belly.
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(310, 372, 220, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs first so the body fill covers the inside seams
  drawLeg(ctx, 280, 268, 32, 88, "#5d8a42"); // back-left (darker)
  drawLeg(ctx, 470, 266, 34, 92, "#5d8a42"); // back-right (darker)
  drawLeg(ctx, 220, 270, 36, 90, "#6ea14f"); // front-left
  drawLeg(ctx, 420, 268, 38, 96, "#6ea14f"); // front-right

  drawBody(ctx);
  drawPlates(ctx);
  drawHead(ctx);

  return cv;
}

function drawStegosaurusTail() {
  const cv = createCanvas(DINO_W, DINO_H);
  const ctx = cv.getContext("2d");
  drawTail(ctx);
  return cv;
}

function drawLeg(ctx, cx, topY, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  // chunky stubby leg, slightly tapered
  ctx.moveTo(cx - w / 2, topY);
  ctx.bezierCurveTo(
    cx - w / 2 - 4, topY + h * 0.5,
    cx - w / 2 - 2, topY + h,
    cx - w / 2 + 4, topY + h
  );
  ctx.lineTo(cx + w / 2 - 4, topY + h);
  ctx.bezierCurveTo(
    cx + w / 2 + 2, topY + h,
    cx + w / 2 + 4, topY + h * 0.5,
    cx + w / 2, topY
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // toes
  ctx.fillStyle = "#3b2a18";
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(cx + i * (w / 3), topY + h - 3, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTail(ctx) {
  // Thick tail curving up to the left. The tail base sits *inside* the body
  // (x≈230) so the body fill covers the seam; only the visible portion
  // (x<160 or so) reads as "tail."
  ctx.save();
  ctx.fillStyle = "#6ea14f";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 5;
  ctx.beginPath();
  // top edge: from inside body, up over the tail's curve, to the tip
  ctx.moveTo(240, 195);
  ctx.bezierCurveTo(180, 175, 110, 160, 70, 130);
  ctx.bezierCurveTo(50, 110, 36, 96, 30, 96);
  // tip pinch
  ctx.bezierCurveTo(22, 100, 26, 124, 44, 134);
  // bottom edge back into the body
  ctx.bezierCurveTo(78, 150, 130, 200, 200, 240);
  ctx.bezierCurveTo(220, 248, 240, 245, 240, 230);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // belly tone on the underside of the tail
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.beginPath();
  ctx.moveTo(60, 200);
  ctx.bezierCurveTo(110, 215, 170, 235, 220, 240);
  ctx.lineTo(220, 248);
  ctx.bezierCurveTo(170, 245, 110, 225, 60, 210);
  ctx.closePath();
  ctx.fill();

  // a couple of small tail spikes (thagomizer hint) near the tip
  ctx.fillStyle = "#e8d8a8";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  drawSpike(ctx, 44, 112, 8, 18, -0.3);
  drawSpike(ctx, 60, 118, 7, 16, 0.1);
  ctx.restore();
}

function drawSpike(ctx, x, y, halfW, h, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(-halfW, 0);
  ctx.lineTo(0, -h);
  ctx.lineTo(halfW, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawBody(ctx) {
  ctx.fillStyle = "#7fb95a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 5;
  ctx.beginPath();
  // chunky bean — bottom is the belly, top traces the back hump. Left edge
  // extends to ~x=180 so the tail's right end is hidden under the fill.
  ctx.moveTo(190, 220); // attaches to the tail's top edge on the left
  ctx.bezierCurveTo(195, 175, 240, 145, 300, 135); // back rising
  ctx.bezierCurveTo(360, 138, 410, 145, 450, 165); // back peak → shoulder
  ctx.bezierCurveTo(490, 180, 520, 195, 540, 200); // neck approach
  ctx.bezierCurveTo(548, 215, 540, 245, 510, 270); // shoulder down
  ctx.bezierCurveTo(470, 290, 380, 300, 300, 300); // belly
  ctx.bezierCurveTo(240, 300, 200, 285, 188, 265); // back-belly
  ctx.bezierCurveTo(180, 250, 180, 235, 190, 220);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // belly shading
  ctx.fillStyle = "#b8d68a";
  ctx.beginPath();
  ctx.moveTo(180, 280);
  ctx.bezierCurveTo(240, 300, 380, 305, 470, 280);
  ctx.bezierCurveTo(440, 305, 380, 312, 300, 312);
  ctx.bezierCurveTo(220, 312, 200, 295, 180, 280);
  ctx.closePath();
  ctx.fill();
}

function drawPlates(ctx) {
  // Five back plates following the back curve. Authored in body-space so
  // they line up with the back silhouette.
  const plates = [
    { x: 230, base: 152, w: 38, h: 46, lean: -0.18 },
    { x: 280, base: 140, w: 44, h: 56, lean: -0.05 },
    { x: 330, base: 138, w: 46, h: 60, lean: 0.0 },
    { x: 380, base: 142, w: 42, h: 54, lean: 0.08 },
    { x: 430, base: 152, w: 36, h: 44, lean: 0.18 },
  ];
  for (const p of plates) drawPlate(ctx, p);
}

function drawPlate(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.base);
  ctx.rotate(p.lean);
  ctx.fillStyle = "#f1d27a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-p.w / 2, 4);
  ctx.bezierCurveTo(-p.w / 2, -p.h * 0.4, -p.w * 0.15, -p.h, 0, -p.h);
  ctx.bezierCurveTo(p.w * 0.15, -p.h, p.w / 2, -p.h * 0.4, p.w / 2, 4);
  ctx.bezierCurveTo(p.w * 0.25, 12, -p.w * 0.25, 12, -p.w / 2, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // inner shading on plate
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.beginPath();
  ctx.moveTo(-p.w / 2 + 4, 0);
  ctx.bezierCurveTo(-p.w / 2 + 2, -p.h * 0.4, -p.w * 0.1, -p.h * 0.85, 0, -p.h * 0.9);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHead(ctx) {
  // Small head with a snout extending right.
  ctx.fillStyle = "#7fb95a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(500, 200);
  ctx.bezierCurveTo(525, 195, 555, 200, 568, 215); // top of snout
  ctx.bezierCurveTo(580, 230, 575, 250, 555, 252); // snout tip
  ctx.bezierCurveTo(540, 254, 525, 250, 515, 248); // chin underside
  ctx.bezierCurveTo(500, 248, 488, 240, 488, 225);
  ctx.bezierCurveTo(488, 215, 492, 205, 500, 200);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // eye
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(530, 218, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(531, 219, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(530, 217, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // smile
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(530, 240);
  ctx.bezierCurveTo(540, 246, 552, 246, 562, 240);
  ctx.stroke();

  // nostril
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(566, 232, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // little cheek blush
  ctx.fillStyle = "rgba(220, 100, 110, 0.35)";
  ctx.beginPath();
  ctx.arc(515, 235, 6, 0, Math.PI * 2);
  ctx.fill();
}

// ---- drawer objects -----------------------------------------------------

const OBJ_SIZE = 96;

function newObjCanvas() {
  const cv = createCanvas(OBJ_SIZE, OBJ_SIZE);
  const ctx = cv.getContext("2d");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { cv, ctx };
}

function ball() {
  const { cv, ctx } = newObjCanvas();
  // red ball with highlight + seam
  ctx.fillStyle = "#e74c3c";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(48, 48, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // seam
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(20, 56);
  ctx.bezierCurveTo(40, 50, 56, 50, 76, 56);
  ctx.stroke();
  // highlight
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(36, 32, 12, 6, -0.6, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

function block() {
  const { cv, ctx } = newObjCanvas();
  ctx.fillStyle = "#c98a3c";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.rect(14, 14, 68, 68);
  ctx.fill();
  ctx.stroke();
  // wood grain
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 1.6;
  for (let y = 24; y < 80; y += 8) {
    ctx.beginPath();
    ctx.moveTo(18, y);
    ctx.bezierCurveTo(36, y + 2, 56, y - 2, 78, y + 1);
    ctx.stroke();
  }
  // letter
  ctx.fillStyle = "#fff";
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("A", 48, 50);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.strokeText("A", 48, 50);
  return cv;
}

function triangle() {
  const { cv, ctx } = newObjCanvas();
  ctx.fillStyle = "#f4c430";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(48, 12);
  ctx.lineTo(86, 80);
  ctx.lineTo(10, 80);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.moveTo(48, 22);
  ctx.lineTo(60, 46);
  ctx.lineTo(36, 46);
  ctx.closePath();
  ctx.fill();
  return cv;
}

function banana() {
  const { cv, ctx } = newObjCanvas();
  ctx.fillStyle = "#ffd84a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  // curved banana — top arc from upper-left to lower-right, bottom arc back
  ctx.moveTo(14, 30);
  ctx.bezierCurveTo(30, 12, 70, 24, 84, 56);
  ctx.bezierCurveTo(86, 64, 80, 70, 76, 66);
  ctx.bezierCurveTo(66, 50, 44, 36, 22, 42);
  ctx.bezierCurveTo(16, 42, 10, 36, 14, 30);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // tip (stem)
  ctx.fillStyle = "#7d5a1f";
  ctx.beginPath();
  ctx.arc(14, 30, 4, 0, Math.PI * 2);
  ctx.fill();
  // shading on the underside
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath();
  ctx.moveTo(22, 42);
  ctx.bezierCurveTo(44, 38, 66, 50, 76, 64);
  ctx.bezierCurveTo(66, 58, 44, 46, 22, 50);
  ctx.closePath();
  ctx.fill();
  return cv;
}

function star() {
  const { cv, ctx } = newObjCanvas();
  ctx.fillStyle = "#ffd84a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  const cx = 48, cy = 50;
  const outer = 38, inner = 16;
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
  // inner gleam
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.arc(cx - 6, cy - 6, 6, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

function donut() {
  const { cv, ctx } = newObjCanvas();
  // donut body
  ctx.fillStyle = "#d6996b";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(48, 48, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // hole
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.beginPath();
  ctx.arc(48, 48, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // pink frosting (drippy edge)
  ctx.save();
  ctx.fillStyle = "#ff8fb1";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  // outer drippy outline
  const drips = [38, 36, 34, 38, 36, 34, 38, 36, 34, 38];
  for (let i = 0; i < drips.length; i++) {
    const a = (i / drips.length) * Math.PI * 2;
    const r = drips[i] - 0;
    const x = 48 + Math.cos(a) * r;
    const y = 48 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  // inner hole — counter-clockwise so it punches through
  ctx.moveTo(48 + 16, 48);
  for (let i = 0; i <= 32; i++) {
    const a = -(i / 32) * Math.PI * 2;
    ctx.lineTo(48 + Math.cos(a) * 16, 48 + Math.sin(a) * 16);
  }
  ctx.closePath();
  ctx.fill("evenodd");
  ctx.stroke();
  ctx.restore();

  // sprinkles
  const sprinkleColors = ["#5b8def", "#ffd84a", "#7ed957", "#ff5dca", "#ffffff"];
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (let i = 0; i < 14; i++) {
    const a = i * 0.85;
    const r = 22 + (i % 3) * 4;
    const x = 48 + Math.cos(a) * r;
    const y = 48 + Math.sin(a) * r;
    ctx.strokeStyle = sprinkleColors[i % sprinkleColors.length];
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a + 1) * 5, y + Math.sin(a + 1) * 5);
    ctx.stroke();
  }
  // outline the hole edge so it reads
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(48, 48, 14, 0, Math.PI * 2);
  ctx.stroke();
  return cv;
}

function apple() {
  const { cv, ctx } = newObjCanvas();
  ctx.fillStyle = "#e74c3c";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  // body — rounded heart-ish apple silhouette
  ctx.beginPath();
  ctx.moveTo(48, 24);
  ctx.bezierCurveTo(20, 22, 10, 50, 22, 72);
  ctx.bezierCurveTo(30, 86, 42, 88, 48, 80);
  ctx.bezierCurveTo(54, 88, 66, 86, 74, 72);
  ctx.bezierCurveTo(86, 50, 76, 22, 48, 24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // highlight
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.ellipse(34, 40, 7, 12, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // stem
  ctx.strokeStyle = "#5a3a1d";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(48, 24);
  ctx.lineTo(52, 12);
  ctx.stroke();
  // leaf
  ctx.fillStyle = "#7ed957";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(52, 14);
  ctx.bezierCurveTo(70, 6, 78, 18, 64, 26);
  ctx.bezierCurveTo(58, 26, 52, 22, 52, 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return cv;
}

function iceCream() {
  const { cv, ctx } = newObjCanvas();
  // cone — define the path once, fill it, then clip the waffle lines to it.
  const conePath = () => {
    ctx.beginPath();
    ctx.moveTo(20, 50);
    ctx.lineTo(48, 90);
    ctx.lineTo(76, 50);
    ctx.closePath();
  };
  ctx.fillStyle = "#d99a4a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  conePath();
  ctx.fill();
  // waffle pattern (clipped to the cone triangle)
  ctx.save();
  conePath();
  ctx.clip();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.5;
  for (let i = -2; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(20 + i * 6, 50);
    ctx.lineTo(48 - 16 + i * 8, 92);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(76 - i * 6, 50);
    ctx.lineTo(48 + 16 - i * 8, 92);
    ctx.stroke();
  }
  ctx.restore();
  // re-stroke the cone outline so it sits clean over the waffle lines
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  conePath();
  ctx.stroke();
  // scoop (pink)
  ctx.fillStyle = "#ff8fb1";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(48, 38, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // drip on cone rim
  ctx.beginPath();
  ctx.moveTo(28, 52);
  ctx.bezierCurveTo(34, 60, 40, 60, 44, 50);
  ctx.bezierCurveTo(48, 60, 54, 60, 58, 50);
  ctx.bezierCurveTo(62, 60, 68, 60, 72, 52);
  ctx.lineTo(72, 50);
  ctx.lineTo(28, 50);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // cherry
  ctx.fillStyle = "#e74c3c";
  ctx.beginPath();
  ctx.arc(48, 16, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // stem
  ctx.strokeStyle = "#3b6a2a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(48, 9);
  ctx.bezierCurveTo(50, 4, 56, 4, 58, 8);
  ctx.stroke();
  // highlight on scoop
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(40, 30, 6, 4, -0.4, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

// ---- write everything --------------------------------------------------

function writePng(cv, name) {
  writeFileSync(resolve(ASSETS, name), cv.toBuffer("image/png"));
}

writePng(drawStegosaurusBody(), "stegosaurus-body.png");
writePng(drawStegosaurusTail(), "stegosaurus-tail.png");

const objects = {
  ball,
  block,
  triangle,
  banana,
  star,
  donut,
  apple,
  "ice-cream": iceCream,
};

for (const [name, fn] of Object.entries(objects)) {
  writePng(fn(), `${name}.png`);
}

console.log(
  `wrote stegosaurus-body.png + stegosaurus-tail.png + ${Object.keys(objects).length} objects to ${ASSETS}`
);
