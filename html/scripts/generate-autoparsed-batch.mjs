// Batch driver for the auto-parsed coloring-book subjects.
//
// 1. Generate 5 black-on-white line-art PNGs into examples/coloring-book/
//    source-art/ using node-canvas (subjects: butterfly, rocket, cake,
//    dragon, whale).
// 2. Run scripts/parse-line-art.mjs over each to produce the matching
//    <slug>_lines.png + <slug>_labels.png pair in examples/coloring-book/
//    assets/.
//
// The source-art PNGs are committed alongside the generated assets so that
// re-running this script produces a clean no-op git diff. If you want to
// adjust a subject, edit the corresponding draw* function and re-run
// `npm run gen-autoparsed-assets`.

import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLineArt } from "./parse-line-art.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC_DIR = resolve(__dirname, "../examples/coloring-book/source-art");
const ASSETS_DIR = resolve(__dirname, "../examples/coloring-book/assets");

// 800² is a good balance: large enough that thresholding doesn't lose detail,
// small enough that the resulting PNGs stay under ~10 KB each.
const SIZE = 800;
const STROKE = 6;

mkdirSync(SRC_DIR, { recursive: true });
mkdirSync(ASSETS_DIR, { recursive: true });

// ---------- canvas helpers ----------

function newLineArtCanvas() {
  const cv = createCanvas(SIZE, SIZE);
  const ctx = cv.getContext("2d");
  // White background — the parser thresholds against gray, so a clean white
  // base means every non-stroke pixel reads as "fillable".
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#000"; // (unused but safe default)
  ctx.lineWidth = STROKE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { cv, ctx };
}

function strokePath(ctx, draw) {
  ctx.beginPath();
  draw(ctx);
  ctx.stroke();
}

function savePng(cv, outPath) {
  const buf = cv.toBuffer("image/png");
  writeFileSync(outPath, buf);
}

// Mirror a path horizontally around x=cx so we only have to draw one half.
function mirroredX(cx, fn) {
  return (ctx) => {
    fn(ctx, false, cx);
    fn(ctx, true, cx);
  };
}

// ---------- subjects ----------
//
// Each function draws one black-on-white line-art image. Regions are formed
// implicitly by the strokes closing on each other; the parser figures out
// the rest. Keep stroke widths uniform so erosion behaves consistently.

function drawButterfly(ctx) {
  // Body: vertical capsule down the centerline.
  strokePath(ctx, (c) => {
    c.moveTo(400, 220);
    c.bezierCurveTo(420, 220, 420, 580, 400, 580);
    c.bezierCurveTo(380, 580, 380, 220, 400, 220);
  });

  // Antennae.
  strokePath(ctx, (c) => {
    c.moveTo(396, 220);
    c.bezierCurveTo(370, 180, 350, 150, 320, 130);
    c.moveTo(404, 220);
    c.bezierCurveTo(430, 180, 450, 150, 480, 130);
  });

  // Upper wings: each side has a big lobe split into an inner cell + outer cell.
  // Drawing one half then mirroring keeps left/right symmetry exact.
  const upperWingHalf = (c, mirror, cx) => {
    const m = mirror ? -1 : 1;
    const x = (dx) => cx + m * dx;
    c.moveTo(x(0), 240);
    c.bezierCurveTo(x(80), 200, x(260), 180, x(340), 240);
    c.bezierCurveTo(x(360), 290, x(340), 350, x(260), 380);
    c.bezierCurveTo(x(180), 390, x(80), 380, x(0), 360);
    // Inner divider — splits the upper wing into 2 cells.
    c.moveTo(x(40), 250);
    c.bezierCurveTo(x(140), 240, x(220), 250, x(280), 290);
  };
  strokePath(ctx, mirroredX(400, upperWingHalf));

  // Lower wings: smaller, also split.
  const lowerWingHalf = (c, mirror, cx) => {
    const m = mirror ? -1 : 1;
    const x = (dx) => cx + m * dx;
    c.moveTo(x(0), 400);
    c.bezierCurveTo(x(80), 410, x(220), 420, x(280), 470);
    c.bezierCurveTo(x(290), 540, x(180), 580, x(60), 560);
    c.bezierCurveTo(x(20), 540, x(0), 510, x(0), 480);
    c.moveTo(x(30), 470);
    c.bezierCurveTo(x(120), 470, x(190), 490, x(240), 520);
  };
  strokePath(ctx, mirroredX(400, lowerWingHalf));

  // Spots on each upper wing.
  const spot = (cx, cy, r) => (c) => {
    c.moveTo(cx + r, cy);
    c.arc(cx, cy, r, 0, Math.PI * 2);
  };
  strokePath(ctx, spot(220, 280, 22));
  strokePath(ctx, spot(580, 280, 22));
  strokePath(ctx, spot(280, 340, 14));
  strokePath(ctx, spot(520, 340, 14));
}

function drawRocket(ctx) {
  // Nose cone.
  strokePath(ctx, (c) => {
    c.moveTo(400, 80);
    c.lineTo(310, 240);
    c.lineTo(490, 240);
    c.closePath();
  });

  // Body: rectangular fuselage from below the cone to above the engine bell.
  strokePath(ctx, (c) => {
    c.moveTo(310, 240);
    c.lineTo(310, 560);
    c.lineTo(490, 560);
    c.lineTo(490, 240);
  });

  // Window: a round porthole inside the body.
  strokePath(ctx, (c) => {
    c.moveTo(450, 340);
    c.arc(400, 340, 50, 0, Math.PI * 2);
  });

  // Decorative belt across the body — splits body into top/bottom cells.
  strokePath(ctx, (c) => {
    c.moveTo(310, 470);
    c.lineTo(490, 470);
  });

  // Side fins.
  strokePath(ctx, (c) => {
    c.moveTo(310, 480);
    c.lineTo(220, 600);
    c.lineTo(310, 600);
    c.closePath();
    c.moveTo(490, 480);
    c.lineTo(580, 600);
    c.lineTo(490, 600);
    c.closePath();
  });

  // Engine bell.
  strokePath(ctx, (c) => {
    c.moveTo(310, 560);
    c.lineTo(330, 620);
    c.lineTo(470, 620);
    c.lineTo(490, 560);
  });

  // Flames: outer + inner teardrop, inner gets its own colorable cell.
  strokePath(ctx, (c) => {
    c.moveTo(330, 620);
    c.bezierCurveTo(340, 700, 380, 740, 400, 760);
    c.bezierCurveTo(420, 740, 460, 700, 470, 620);
  });
  strokePath(ctx, (c) => {
    c.moveTo(360, 620);
    c.bezierCurveTo(370, 680, 390, 700, 400, 720);
    c.bezierCurveTo(410, 700, 430, 680, 440, 620);
  });
}

function drawCake(ctx) {
  // 3 stacked tiers, bottom widest. Each tier is drawn as a rounded
  // rectangle; the dripping frosting line on top splits each tier into a
  // "frosting" cell and a "cake" cell.
  const tier = (cx, cy, w, h) => (c) => {
    const left = cx - w / 2;
    const right = cx + w / 2;
    c.moveTo(left, cy);
    c.lineTo(left, cy + h);
    c.lineTo(right, cy + h);
    c.lineTo(right, cy);
  };

  // Bottom tier
  strokePath(ctx, tier(400, 460, 480, 200));
  // Frosting drip on bottom tier — wavy line splitting it.
  strokePath(ctx, (c) => {
    c.moveTo(160, 460);
    c.bezierCurveTo(200, 510, 240, 510, 280, 470);
    c.bezierCurveTo(320, 510, 360, 510, 400, 470);
    c.bezierCurveTo(440, 510, 480, 510, 520, 470);
    c.bezierCurveTo(560, 510, 600, 510, 640, 460);
  });

  // Middle tier
  strokePath(ctx, tier(400, 320, 360, 140));
  strokePath(ctx, (c) => {
    c.moveTo(220, 320);
    c.bezierCurveTo(260, 365, 300, 365, 340, 330);
    c.bezierCurveTo(380, 365, 420, 365, 460, 330);
    c.bezierCurveTo(500, 365, 540, 365, 580, 320);
  });

  // Top tier
  strokePath(ctx, tier(400, 220, 240, 100));
  strokePath(ctx, (c) => {
    c.moveTo(280, 220);
    c.bezierCurveTo(310, 255, 350, 255, 380, 230);
    c.bezierCurveTo(420, 255, 460, 255, 490, 230);
    c.bezierCurveTo(510, 245, 520, 240, 520, 220);
  });

  // Plate at the bottom.
  strokePath(ctx, (c) => {
    c.moveTo(80, 660);
    c.lineTo(720, 660);
    c.moveTo(120, 700);
    c.lineTo(680, 700);
    c.moveTo(80, 660);
    c.bezierCurveTo(80, 700, 120, 700, 120, 700);
    c.moveTo(720, 660);
    c.bezierCurveTo(720, 700, 680, 700, 680, 700);
  });

  // 3 candles + flames.
  const candle = (cx, top) => {
    strokePath(ctx, (c) => {
      c.moveTo(cx - 12, top);
      c.lineTo(cx - 12, 220);
      c.lineTo(cx + 12, 220);
      c.lineTo(cx + 12, top);
      c.closePath();
    });
    // Flame.
    strokePath(ctx, (c) => {
      c.moveTo(cx, top - 4);
      c.bezierCurveTo(cx + 18, top - 24, cx + 16, top - 50, cx, top - 70);
      c.bezierCurveTo(cx - 16, top - 50, cx - 18, top - 24, cx, top - 4);
    });
  };
  candle(330, 160);
  candle(400, 140);
  candle(470, 160);
}

function drawDragon(ctx) {
  // Side profile facing right. Body is a long S-curve from tail tip → back
  // hump → neck arch → head.
  // Body silhouette.
  strokePath(ctx, (c) => {
    // Start at tail tip (left side), trace under-belly along bottom, up the
    // chest, around the head, back over the spine to the tail tip.
    c.moveTo(80, 520);
    c.bezierCurveTo(140, 540, 220, 580, 320, 580); // belly toward chest
    c.bezierCurveTo(380, 580, 420, 560, 460, 540); // forelegs / chest base
    c.bezierCurveTo(500, 540, 540, 540, 580, 520); // continue
    c.bezierCurveTo(620, 500, 660, 460, 680, 420); // up the neck
    c.bezierCurveTo(720, 380, 740, 340, 720, 300); // top of head curve
    c.bezierCurveTo(700, 270, 660, 260, 620, 270); // brow / muzzle
    c.bezierCurveTo(600, 280, 590, 320, 580, 340); // muzzle line
    c.bezierCurveTo(560, 360, 540, 360, 520, 360); // jaw line back into neck
    c.bezierCurveTo(500, 380, 480, 420, 460, 460); // back of neck → spine
    c.bezierCurveTo(420, 480, 360, 480, 300, 480); // along spine
    c.bezierCurveTo(220, 480, 140, 500, 80, 520); // back to tail
    c.closePath();
  });

  // Eye.
  strokePath(ctx, (c) => {
    c.moveTo(680, 305);
    c.arc(670, 300, 10, 0, Math.PI * 2);
  });

  // Nostril (small notch on the muzzle).
  strokePath(ctx, (c) => {
    c.moveTo(620, 295);
    c.bezierCurveTo(615, 285, 632, 285, 632, 295);
    c.bezierCurveTo(630, 305, 615, 305, 620, 295);
  });

  // Mouth — separates upper/lower jaw region.
  strokePath(ctx, (c) => {
    c.moveTo(580, 340);
    c.bezierCurveTo(560, 340, 540, 340, 520, 340);
  });

  // Horn on the back of the head.
  strokePath(ctx, (c) => {
    c.moveTo(680, 280);
    c.lineTo(700, 220);
    c.lineTo(720, 280);
    c.closePath();
  });

  // Wing — large folded wing rising off the spine.
  strokePath(ctx, (c) => {
    c.moveTo(300, 480); // anchor on spine
    c.bezierCurveTo(280, 360, 360, 240, 460, 220); // up and right
    c.bezierCurveTo(500, 240, 480, 320, 460, 380); // first finger
    c.bezierCurveTo(500, 360, 540, 380, 520, 440); // second finger
    c.bezierCurveTo(440, 460, 380, 470, 300, 480); // back to spine
    c.closePath();
  });

  // Wing internal vein dividers — split the wing into 3 cells.
  strokePath(ctx, (c) => {
    c.moveTo(360, 470);
    c.bezierCurveTo(380, 380, 410, 300, 440, 240);
    c.moveTo(420, 460);
    c.bezierCurveTo(440, 380, 460, 320, 480, 270);
  });

  // Spikes along the spine — each a small triangle, each its own region.
  const spike = (x) => {
    strokePath(ctx, (c) => {
      c.moveTo(x - 18, 480);
      c.lineTo(x, 440);
      c.lineTo(x + 18, 480);
      c.closePath();
    });
  };
  spike(140);
  spike(200);
  spike(260);

  // Tail tip flare.
  strokePath(ctx, (c) => {
    c.moveTo(80, 520);
    c.lineTo(40, 480);
    c.lineTo(60, 540);
    c.lineTo(80, 520);
    c.closePath();
  });

  // Ground line under feet — gives a "scene" region between feet too.
  strokePath(ctx, (c) => {
    c.moveTo(60, 660);
    c.lineTo(740, 660);
  });

  // Foreleg + hind leg as small bumps under the belly.
  strokePath(ctx, (c) => {
    c.moveTo(500, 580);
    c.lineTo(490, 660);
    c.moveTo(560, 580);
    c.lineTo(570, 660);
    c.moveTo(220, 580);
    c.lineTo(210, 660);
    c.moveTo(280, 590);
    c.lineTo(290, 660);
  });
}

function drawWhale(ctx) {
  // Body: sweeping teardrop from left (head) to right (tail base).
  strokePath(ctx, (c) => {
    c.moveTo(120, 400);
    c.bezierCurveTo(140, 320, 260, 260, 420, 270);
    c.bezierCurveTo(560, 280, 640, 340, 660, 400);
    c.bezierCurveTo(640, 460, 560, 520, 420, 530);
    c.bezierCurveTo(260, 540, 140, 480, 120, 400);
    c.closePath();
  });

  // Tail fluke on the right.
  strokePath(ctx, (c) => {
    c.moveTo(660, 400);
    c.bezierCurveTo(700, 360, 760, 300, 760, 280);
    c.bezierCurveTo(720, 320, 680, 360, 660, 380);
    c.moveTo(660, 400);
    c.bezierCurveTo(700, 440, 760, 500, 760, 520);
    c.bezierCurveTo(720, 480, 680, 440, 660, 420);
  });
  // Fluke silhouette closing seam.
  strokePath(ctx, (c) => {
    c.moveTo(660, 380);
    c.lineTo(660, 420);
  });

  // Top fin.
  strokePath(ctx, (c) => {
    c.moveTo(420, 270);
    c.bezierCurveTo(420, 230, 460, 200, 480, 180);
    c.bezierCurveTo(490, 220, 480, 260, 470, 270);
  });

  // Side flipper.
  strokePath(ctx, (c) => {
    c.moveTo(280, 470);
    c.bezierCurveTo(260, 520, 240, 560, 220, 580);
    c.bezierCurveTo(260, 570, 300, 540, 310, 510);
  });

  // Belly seam — separates a "belly" region from the main body.
  strokePath(ctx, (c) => {
    c.moveTo(180, 430);
    c.bezierCurveTo(280, 480, 460, 490, 600, 450);
  });

  // Eye.
  strokePath(ctx, (c) => {
    c.moveTo(232, 360);
    c.arc(220, 360, 12, 0, Math.PI * 2);
  });

  // Mouth.
  strokePath(ctx, (c) => {
    c.moveTo(140, 410);
    c.bezierCurveTo(180, 430, 230, 430, 270, 410);
  });

  // Spout: water drops above the head.
  strokePath(ctx, (c) => {
    c.moveTo(330, 200);
    c.bezierCurveTo(290, 160, 290, 100, 320, 80);
    c.bezierCurveTo(360, 100, 360, 160, 330, 200);
  });
  strokePath(ctx, (c) => {
    c.moveTo(290, 220);
    c.bezierCurveTo(260, 200, 250, 170, 270, 150);
    c.bezierCurveTo(290, 170, 305, 200, 290, 220);
  });
  strokePath(ctx, (c) => {
    c.moveTo(370, 220);
    c.bezierCurveTo(400, 200, 420, 170, 405, 150);
    c.bezierCurveTo(385, 170, 365, 200, 370, 220);
  });
}

// ---------- batch ----------

const SUBJECTS = [
  { slug: "butterfly", title: "Butterfly", draw: drawButterfly },
  { slug: "rocket", title: "Rocket", draw: drawRocket },
  { slug: "cake", title: "Birthday Cake", draw: drawCake },
  { slug: "dragon", title: "Dragon", draw: drawDragon },
  { slug: "whale", title: "Whale", draw: drawWhale },
];

async function main() {
  for (const subject of SUBJECTS) {
    const { cv, ctx } = newLineArtCanvas();
    subject.draw(ctx);
    const srcPath = resolve(SRC_DIR, `${subject.slug}.png`);
    savePng(cv, srcPath);

    const result = await parseLineArt({
      in: srcPath,
      outDir: ASSETS_DIR,
      slug: subject.slug,
      threshold: 128,
      minRegion: 80, // generated lines are clean — bump default a bit so any
      // tiny corner artifacts get folded into the outline.
      erode: 1,
    });
    console.log(
      `[${subject.slug}] regions=${result.regionCount} dropped=${result.droppedTiny}` +
        (result.demoted ? ` demoted=${result.demoted}` : "") +
        ` bgSize=${result.backgroundSize}px`
    );
  }
  console.log(
    `\nDone. Wrote source-art to ${SRC_DIR} and assets to ${ASSETS_DIR}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
