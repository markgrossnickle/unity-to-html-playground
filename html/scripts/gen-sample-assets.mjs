// Generates the sample atlas + animation.json for examples/animation-playback.
//
// Output:
//   examples/animation-playback/assets/atlas.png
//   examples/animation-playback/assets/atlas.json   (Phaser-3 JSON-Hash)
//   examples/animation-playback/assets/animation.json
//
// The "rig" is a deliberately simple stick-figure: torso, head (two
// expressions), and a single arm that rotates. It exercises every track type
// the runtime supports — x/y/rotation/scaleX/scaleY transform tracks plus a
// spriteFrame swap.

import { PNG } from "pngjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS = resolve(__dirname, "../examples/animation-playback/assets");
mkdirSync(ASSETS, { recursive: true });

// ----- low-level pixel helpers -----

function makeImage(w, h) {
  const png = new PNG({ width: w, height: h });
  png.data.fill(0);
  return png;
}

function setPx(img, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const idx = (img.width * y + x) << 2;
  img.data[idx] = r;
  img.data[idx + 1] = g;
  img.data[idx + 2] = b;
  img.data[idx + 3] = a;
}

function fillRect(img, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++)
      setPx(img, x, y, color[0], color[1], color[2], color[3] ?? 255);
}

function fillCircle(img, cx, cy, r, color) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r)
        setPx(img, x, y, color[0], color[1], color[2], color[3] ?? 255);
    }
}

function strokeCircle(img, cx, cy, r, color, thick = 1) {
  for (let y = cy - r - 1; y <= cy + r + 1; y++)
    for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 >= (r - thick) * (r - thick))
        setPx(img, x, y, color[0], color[1], color[2], color[3] ?? 255);
    }
}

// ----- frame definitions -----
//
// Pivot is the center of each frame canvas. The runtime applies x/y as offsets
// to that pivot. Frame sizes are chosen so each "limb" reads cleanly.

const SKIN = [240, 200, 160, 255];
const SHIRT = [80, 130, 200, 255];
const PANTS = [60, 70, 90, 255];
const OUTLINE = [30, 30, 40, 255];
const EYE = [30, 30, 40, 255];
const MOUTH = [200, 80, 80, 255];

const frames = {
  // 96x128 torso: rectangular shirt over rectangular pants.
  torso: (() => {
    const w = 96,
      h = 128;
    const img = makeImage(w, h);
    fillRect(img, 16, 8, 64, 70, SHIRT);
    fillRect(img, 16, 78, 64, 50, PANTS);
    // outline
    fillRect(img, 16, 8, 64, 2, OUTLINE);
    fillRect(img, 16, 126, 64, 2, OUTLINE);
    fillRect(img, 16, 8, 2, 120, OUTLINE);
    fillRect(img, 78, 8, 2, 120, OUTLINE);
    return { img, w, h };
  })(),

  // 64x64 head (mouth closed)
  head_01: (() => {
    const w = 64,
      h = 64;
    const img = makeImage(w, h);
    fillCircle(img, 32, 32, 26, SKIN);
    strokeCircle(img, 32, 32, 26, OUTLINE, 2);
    // eyes
    fillCircle(img, 23, 28, 3, EYE);
    fillCircle(img, 41, 28, 3, EYE);
    // mouth (closed)
    fillRect(img, 26, 42, 12, 2, OUTLINE);
    return { img, w, h };
  })(),

  // 64x64 head (mouth open)
  head_02: (() => {
    const w = 64,
      h = 64;
    const img = makeImage(w, h);
    fillCircle(img, 32, 32, 26, SKIN);
    strokeCircle(img, 32, 32, 26, OUTLINE, 2);
    fillCircle(img, 23, 28, 3, EYE);
    fillCircle(img, 41, 28, 3, EYE);
    // mouth (open)
    fillRect(img, 26, 41, 12, 6, MOUTH);
    fillRect(img, 26, 41, 12, 1, OUTLINE);
    fillRect(img, 26, 46, 12, 1, OUTLINE);
    return { img, w, h };
  })(),

  // 24x80 arm: simple capsule in shirt color, hand at the bottom in skin tone.
  arm: (() => {
    const w = 24,
      h = 80;
    const img = makeImage(w, h);
    fillRect(img, 4, 4, 16, 60, SHIRT);
    fillCircle(img, 12, 4, 8, SHIRT);
    fillCircle(img, 12, 70, 10, SKIN);
    strokeCircle(img, 12, 70, 10, OUTLINE, 1);
    return { img, w, h };
  })(),
};

// ----- pack into atlas (vertical strip, simplest possible packer) -----

const PAD = 2;
let atlasW = 0;
let atlasH = 0;
const layout = {};
let cursorY = 0;
for (const [name, { img, w, h }] of Object.entries(frames)) {
  layout[name] = { x: 0, y: cursorY, w, h };
  atlasW = Math.max(atlasW, w);
  cursorY += h + PAD;
}
atlasH = cursorY;

const atlas = makeImage(atlasW, atlasH);
for (const [name, { img, w, h }] of Object.entries(frames)) {
  const { x: dx, y: dy } = layout[name];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sIdx = (img.width * y + x) << 2;
      setPx(
        atlas,
        dx + x,
        dy + y,
        img.data[sIdx],
        img.data[sIdx + 1],
        img.data[sIdx + 2],
        img.data[sIdx + 3]
      );
    }
  }
}

const atlasPngPath = resolve(ASSETS, "atlas.png");
writeFileSync(atlasPngPath, PNG.sync.write(atlas));

// Phaser 3 JSON-Hash format.
const atlasJson = {
  frames: Object.fromEntries(
    Object.entries(layout).map(([name, r]) => [
      name,
      {
        frame: { x: r.x, y: r.y, w: r.w, h: r.h },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: r.w, h: r.h },
        sourceSize: { w: r.w, h: r.h },
      },
    ])
  ),
  meta: {
    app: "scripts/gen-sample-assets.mjs",
    version: "1.0",
    image: "atlas.png",
    format: "RGBA8888",
    size: { w: atlasW, h: atlasH },
    scale: "1",
  },
};
writeFileSync(
  resolve(ASSETS, "atlas.json"),
  JSON.stringify(atlasJson, null, 2)
);

// ----- hand-authored animation.json -----
//
// Mimics what the Unity exporter would emit for a 2.4-second wave loop:
//   torso: small idle bob (y oscillation) + breathe scale
//   head:  bob + mouth-open at 1.0s, mouth-closed at 1.6s
//   arm:   raises and waves — y offset + rotation
//
// Pixel coordinates are relative to the player's container origin; the
// example main.ts centers the container in the canvas.

const animation = {
  name: "wave",
  duration: 2.4,
  frameRate: 30,
  atlas: "atlas.json",
  layers: [
    { name: "torso", defaultFrame: "torso", depth: 0 },
    { name: "arm", defaultFrame: "arm", depth: 1 },
    { name: "head", defaultFrame: "head_01", depth: 2 },
  ],
  tracks: {
    torso: {
      // small breathing bob (Y is Unity-up; runtime negates)
      y: [
        [0, 0],
        [0.6, 2],
        [1.2, 0],
        [1.8, 2],
        [2.4, 0],
      ],
      scaleY: [
        [0, 1],
        [0.6, 1.02],
        [1.2, 1],
        [1.8, 1.02],
        [2.4, 1],
      ],
    },
    head: {
      x: [
        [0, 0],
        [2.4, 0],
      ],
      y: [
        [0, 96],
        [0.6, 98],
        [1.2, 96],
        [1.8, 98],
        [2.4, 96],
      ],
      rotation: [
        [0, 0],
        [0.6, -3],
        [1.2, 0],
        [1.8, 3],
        [2.4, 0],
      ],
      spriteFrame: [
        [0, "head_01"],
        [1.0, "head_02"],
        [1.6, "head_01"],
      ],
    },
    arm: {
      // arm rendered at the right shoulder. Phaser pivots images at center,
      // so x/y here is the *center* of the arm sprite, not the shoulder.
      // The motion: hang at rest, raise + wave + lower. We don't hand-roll a
      // pivot offset since the runtime keeps Phaser's defaults.
      x: [
        [0, 28],
        [0.5, 36],
        [1.0, 56],
        [2.0, 56],
        [2.4, 28],
      ],
      y: [
        [0, 8],
        [0.5, 24],
        [1.0, 40],
        [2.0, 40],
        [2.4, 8],
      ],
      rotation: [
        [0, 0],
        [0.5, -45],
        [1.0, -90],
        [1.25, -75],
        [1.5, -90],
        [1.75, -75],
        [2.0, -90],
        [2.4, 0],
      ],
    },
  },
};
writeFileSync(
  resolve(ASSETS, "animation.json"),
  JSON.stringify(animation, null, 2)
);

console.log(
  `wrote atlas (${atlasW}x${atlasH}, ${Object.keys(frames).length} frames) + animation.json to ${ASSETS}`
);
