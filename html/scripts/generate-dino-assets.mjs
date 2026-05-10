// Generates brontosaurus + drawer-object PNGs for examples/dino-drop.
//
// The brontosaurus is rendered as a back-hump-and-tail view: the dino is so
// large that its head, neck, and front legs are off-screen to the LEFT. What
// we see is the rear half — a smooth back hump rising near the left edge of
// the canvas, then descending into a long sauropod tail that curves down and
// to the RIGHT, forming a slide that ends at ground level.
//
// Output:
//   examples/dino-drop/assets/brontosaurus-body.png   1200x500, transparent bg
//   examples/dino-drop/assets/brontosaurus-tail.png   1200x500, transparent bg
//   examples/dino-drop/assets/<obj>.png               96x96 each, transparent bg
//
// Both dino PNGs share art-space coordinates (origin top-left, x→right,
// y→down). The tail-pivot in art-space is exported via dinoBody.ts and lines
// up 1:1 between the two PNGs so the tail can rotate independently.

import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS = resolve(__dirname, "../examples/dino-drop/assets");
mkdirSync(ASSETS, { recursive: true });

// ---- shared palette -----------------------------------------------------

const OUTLINE = "#2a2618";
const SHADOW = "rgba(0,0,0,0.22)";

// Brontosaurus coloring: warm green-gray sauropod, lighter belly, darker
// shaded leg for depth.
const BRONTO_FILL = "#7a9268";
const BRONTO_BELLY = "#a8bd92";
const BRONTO_LEG_DARK = "#5e7152";

// ---- brontosaurus -------------------------------------------------------

const DINO_W = 1200;
const DINO_H = 500;

function drawBrontoBody() {
  const cv = createCanvas(DINO_W, DINO_H);
  const ctx = cv.getContext("2d");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Soft ground shadow under the belly. Long horizontal stretch since the
  // body is huge.
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(220, 478, 260, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  // Back legs first (so the body fill covers the inside seams). The far leg
  // is the dark shaded one; the near leg is body-colored.
  drawLeg(ctx, 120, 310, 56, 180, BRONTO_LEG_DARK);
  drawLeg(ctx, 320, 320, 60, 170, BRONTO_FILL);

  drawBody(ctx);
  drawBackDetail(ctx);

  return cv;
}

function drawBrontoTail() {
  const cv = createCanvas(DINO_W, DINO_H);
  const ctx = cv.getContext("2d");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  drawTail(ctx);
  return cv;
}

function drawLeg(ctx, cx, topY, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 6;
  ctx.beginPath();
  // Tree-trunk leg — slightly wider at the foot, tapered at the top.
  ctx.moveTo(cx - w / 2, topY);
  ctx.bezierCurveTo(
    cx - w / 2 - 6, topY + h * 0.5,
    cx - w / 2 - 8, topY + h * 0.92,
    cx - w / 2 + 6, topY + h
  );
  ctx.lineTo(cx + w / 2 - 6, topY + h);
  ctx.bezierCurveTo(
    cx + w / 2 + 8, topY + h * 0.92,
    cx + w / 2 + 6, topY + h * 0.5,
    cx + w / 2, topY
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Toes — three little dark nubs along the foot.
  ctx.fillStyle = "#2c2010";
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(cx + i * (w / 3.2), topY + h - 4, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function bodyPath(ctx) {
  // Single source of truth for the body silhouette so the fill, stroke, and
  // belly-shading clip all line up.
  ctx.beginPath();
  // Top edge — body extends off the left into a tall slope (head/neck off),
  // rises smoothly to the hump peak, then descends to the tail base.
  ctx.moveTo(-30, 150);
  ctx.bezierCurveTo(15, 110, 70, 86, 170, 78);    // up to hump peak
  ctx.bezierCurveTo(260, 80, 360, 130, 460, 200);  // descend toward tail base
  // Right side: smooth round-off into where the tail emerges (the tail PNG
  // overlaps this seam so it stays hidden).
  ctx.bezierCurveTo(480, 250, 460, 310, 410, 360);
  ctx.bezierCurveTo(360, 400, 240, 425, 100, 420);
  // Belly bottom: curves back to off-canvas-left.
  ctx.bezierCurveTo(35, 418, -15, 400, -30, 360);
  ctx.lineTo(-30, 150);
  ctx.closePath();
}

function drawBody(ctx) {
  // Solid body fill + outline.
  ctx.fillStyle = BRONTO_FILL;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 6;
  bodyPath(ctx);
  ctx.fill();
  ctx.stroke();

  // Lighter belly tone — clipped to the body so the shading never escapes
  // the silhouette. Drawn as a wide flat ellipse along the lower body.
  ctx.save();
  bodyPath(ctx);
  ctx.clip();
  ctx.fillStyle = BRONTO_BELLY;
  ctx.beginPath();
  ctx.ellipse(180, 425, 320, 80, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBackDetail(ctx) {
  // A subtle highlight along the top of the back — gives the hump a touch of
  // shape so it doesn't read as a flat green blob.
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.moveTo(15, 130);
  ctx.bezierCurveTo(70, 96, 170, 80, 270, 84);
  ctx.bezierCurveTo(360, 92, 410, 130, 445, 175);
  ctx.bezierCurveTo(410, 150, 320, 110, 230, 100);
  ctx.bezierCurveTo(150, 100, 70, 116, 15, 145);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // A handful of small dark spots scattered along the back — sauropod skin
  // texture hint.
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  const spots = [
    [90, 108, 7],
    [150, 92, 6],
    [220, 88, 8],
    [290, 98, 6],
    [350, 124, 7],
    [400, 158, 6],
    [180, 180, 5],
    [270, 210, 6],
    [340, 230, 5],
  ];
  for (const [x, y, r] of spots) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTail(ctx) {
  // The tail is a long taper curving down-right from the body. The base
  // (left end) tucks INTO the body fill (x≈460) so the seam is hidden when
  // un-rotated. The tip lands near the bottom-right of the art canvas — in
  // screen-space that point sits on the ground.
  ctx.save();
  ctx.fillStyle = BRONTO_FILL;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 6;
  ctx.beginPath();
  // Top edge (slide surface) — must read as a smooth, slidable curve.
  ctx.moveTo(440, 180);
  ctx.bezierCurveTo(540, 215, 660, 258, 780, 308);
  ctx.bezierCurveTo(900, 358, 1020, 415, 1110, 455);
  ctx.bezierCurveTo(1150, 472, 1175, 484, 1185, 492);
  // Tail tip — small rounded curl.
  ctx.bezierCurveTo(1196, 496, 1198, 506, 1184, 504);
  // Bottom edge (back along the underside of the tail).
  ctx.bezierCurveTo(1150, 502, 1100, 492, 1050, 480);
  ctx.bezierCurveTo(940, 458, 800, 410, 660, 350);
  ctx.bezierCurveTo(560, 308, 500, 280, 460, 252);
  // Close back to the start, tucked into the body fill.
  ctx.bezierCurveTo(440, 238, 425, 215, 440, 180);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Underbelly shading on the tail's lower edge.
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.beginPath();
  ctx.moveTo(460, 252);
  ctx.bezierCurveTo(600, 308, 780, 380, 970, 445);
  ctx.bezierCurveTo(1080, 475, 1140, 490, 1180, 502);
  ctx.bezierCurveTo(1090, 488, 940, 456, 780, 396);
  ctx.bezierCurveTo(640, 340, 530, 295, 460, 252);
  ctx.closePath();
  ctx.fill();

  // Highlight along the top of the tail — gives the slide a polished look.
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(450, 195);
  ctx.bezierCurveTo(560, 230, 720, 285, 880, 350);
  ctx.bezierCurveTo(1020, 408, 1130, 458, 1180, 488);
  ctx.bezierCurveTo(1090, 452, 940, 388, 800, 322);
  ctx.bezierCurveTo(660, 270, 540, 230, 450, 210);
  ctx.closePath();
  ctx.fill();

  // A few dark spots along the tail for skin texture continuity with the
  // body.
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  const tailSpots = [
    [540, 240, 6],
    [660, 290, 5],
    [780, 340, 5],
    [900, 388, 4],
    [1010, 428, 4],
    [1100, 458, 3],
  ];
  for (const [x, y, r] of tailSpots) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
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

writePng(drawBrontoBody(), "brontosaurus-body.png");
writePng(drawBrontoTail(), "brontosaurus-tail.png");

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
  `wrote brontosaurus-body.png + brontosaurus-tail.png + ${Object.keys(objects).length} objects to ${ASSETS}`
);
