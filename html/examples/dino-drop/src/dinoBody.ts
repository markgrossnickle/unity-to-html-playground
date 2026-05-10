// Static collider for the stegosaurus's *back + tail* silhouette.
//
// We don't care about the head/legs/belly for physics — dropped objects only
// ever fall onto the upper edge. So the collider is a chain of line segments
// that traces the top contour from the head's brow, over the back hump, down
// the curve of the tail, to the tail tip.
//
// Coordinates are in the stegosaurus.png art-space (origin top-left, x→right,
// y→down). The scene scales + positions the dino sprite, then mirrors that
// transform when instantiating the Matter bodies so the collider lines up
// 1:1 with the rendered silhouette.
//
// Tracing approach:
//   * Walk the visible top edge of the dino at ~12px sample intervals,
//     averaging out the bumps under the back plates so dropped objects slide
//     along a continuous curve rather than catching on a notch between plates.
//   * The TAIL portion (`tailStart` index onward) lives on a logical "tail"
//     body so the slap animation can pivot it as a unit. The BACK portion
//     stays static.
//   * Each consecutive pair of points becomes one thin static rectangle (a
//     "plank") in Matter — it's simpler than a polygon body for an open chain
//     and avoids Matter's fragile concave decomposer.

export interface DinoSilhouette {
  // Native size of the source PNG.
  readonly width: number;
  readonly height: number;
  // Tail-base pivot in art-space — the slap rotates the tail planks around
  // this point. Sits where the tail visually emerges from the body.
  readonly tailPivot: { x: number; y: number };
  // Index into `points` where the tail portion begins. Points before this
  // index are the static back; points at or after are the rotating tail.
  readonly tailStart: number;
  // Top-edge contour, head-end first → tail-tip last.
  readonly points: ReadonlyArray<{ x: number; y: number }>;
  // Tap-target ellipse for the body (used to detect taps on the dino).
  readonly tapEllipse: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
  };
}

// The actual sample list. Each point is an (x,y) on the visible top edge of
// stegosaurus.png. Sampled by eye against the rendered art at 600×400 native.
// Spacing is ~16–24px apart — small enough to feel curved, large enough that
// Matter doesn't choke on hundreds of bodies.
export const DINO_SILHOUETTE: DinoSilhouette = {
  width: 600,
  height: 400,
  tailPivot: { x: 200, y: 195 },
  tailStart: 6,
  points: [
    // ---- BACK (head end → tail base) ----
    { x: 540, y: 200 }, // brow above the eye
    { x: 500, y: 175 }, // neck rising
    { x: 450, y: 158 }, // shoulder hump
    { x: 400, y: 145 }, // back hump high
    { x: 340, y: 138 }, // peak of back
    { x: 280, y: 142 }, // descending toward tail
    // ---- TAIL (tail base → tip), pivots around tailPivot ----
    { x: 230, y: 158 }, // tail base, just emerging from body
    { x: 180, y: 174 },
    { x: 140, y: 178 },
    { x: 105, y: 168 },
    { x: 78, y: 148 },
    { x: 58, y: 124 },
    { x: 42, y: 108 },
    { x: 32, y: 100 }, // tail tip
  ],
  tapEllipse: {
    cx: 360,
    cy: 220,
    rx: 200,
    ry: 95,
  },
};
