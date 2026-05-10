// Static collider for the brontosaurus's *back hump + tail-slide* silhouette.
//
// The top-edge polyline (MERGED_TOP_EDGE) is auto-extracted from the rendered
// PNGs by `scripts/generate-dino-assets.mjs` — it column-scans the alpha
// channel for the topmost opaque pixel per column across both the body and
// tail textures, takes the per-column min (whichever is actually visible in
// the composited scene), and simplifies with Ramer–Douglas–Peucker. That
// guarantees the physics collider traces the visible silhouette exactly —
// no more hand-sampled drift causing objects to clip in or float above
// the art.
//
// Coordinates are in the brontosaurus PNG art-space (origin top-left,
// x→right, y→down). The scene scales + positions the dino sprite, then
// mirrors that transform when instantiating the Matter bodies so the
// collider lines up 1:1 with the rendered silhouette.

import {
  BODY_SIZE,
  MERGED_TOP_EDGE,
  TAIL_TOP_EDGE,
} from "./dinoSilhouetteAuto";

export interface DinoSilhouette {
  // Native size of the source PNG.
  readonly width: number;
  readonly height: number;
  // Tail-base pivot in art-space — the slap rotates the tail planks around
  // this point. Sits where the tail visually emerges from the body.
  readonly tailPivot: { x: number; y: number };
  // Index into `points` where the tail portion begins. Points before this
  // index are the static back; points at or after are the tail slide.
  readonly tailStart: number;
  // Top-edge contour, off-screen-left first → tail-tip last.
  readonly points: ReadonlyArray<{ x: number; y: number }>;
  // Tap-target ellipse for the body (used to detect taps on the back hump
  // — NOT on the slide, so tapping the slide doesn't trigger a slap).
  readonly tapEllipse: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
  };
}

// Where the body ends visually and the tail-slide begins, in the merged
// polyline. We label any point whose x is at or past the tail PNG's leftmost
// opaque column as "tail" so DinoScene can distinguish back vs. slide planks.
const tailFirst = TAIL_TOP_EDGE[0];
const tailX = tailFirst ? tailFirst[0] : BODY_SIZE.width;

const points: Array<{ x: number; y: number }> = MERGED_TOP_EDGE.map(
  ([x, y]) => ({ x, y })
);
let tailStart = points.length;
for (let i = 0; i < points.length; i++) {
  const p = points[i];
  if (p && p.x >= tailX) {
    tailStart = i;
    break;
  }
}

// Hand-tuned gameplay knobs, expressed as fractions of a canonical 1200×500
// PNG so they scale automatically if the art is re-rendered at a different
// resolution.
const REF_W = 1200;
const REF_H = 500;
const sx = (px: number) => (px / REF_W) * BODY_SIZE.width;
const sy = (px: number) => (px / REF_H) * BODY_SIZE.height;

export const DINO_SILHOUETTE: DinoSilhouette = {
  width: BODY_SIZE.width,
  height: BODY_SIZE.height,
  // Where the tail attaches to the body — used as the tail sprite's rotation
  // pivot. Sits just inside the body's right edge so the slap looks anchored
  // to the body, not the tail tip.
  tailPivot: { x: sx(460), y: sy(200) },
  tailStart,
  points,
  tapEllipse: {
    // Centered on the back hump (peak near art-x≈170). Sized so the tap
    // target covers the hump comfortably without bleeding into the tail
    // slide (which starts around art-x≈430).
    cx: sx(190),
    cy: sy(140),
    rx: sx(200),
    ry: sy(100),
  },
};
