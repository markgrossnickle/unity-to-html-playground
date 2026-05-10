// Static collider for the brontosaurus's *back hump + tail-slide* silhouette.
//
// We don't care about the head / front legs / belly for physics — the head
// and neck are off-screen to the LEFT and dropped objects only ever land on
// the upper edge. So the collider is a chain of line segments tracing the
// top contour from the LEFT edge of the canvas (where the body extends
// off-screen) up over the back hump, down to the tail base, then along the
// tail's slide curve all the way to the tip on the ground.
//
// Coordinates are in the brontosaurus PNG art-space (origin top-left,
// x→right, y→down). The scene scales + positions the dino sprite, then
// mirrors that transform when instantiating the Matter bodies so the
// collider lines up 1:1 with the rendered silhouette.
//
// Shape:
//   * BACK: x=0 (left edge, off-screen continuation) up to peak around
//     x=170, then descending smoothly to the tail base around (460, 200).
//   * TAIL: from the tail base, a smooth arc curving right and down so the
//     tip lands near the bottom-right of the art canvas. This forms the
//     slide.
//   * Each consecutive pair of points becomes one thin static rectangle (a
//     "plank") in Matter — simple, robust, and lets us label tail vs. back
//     planks separately.

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

// Sampled by eye against the rendered art at 1200×500 native. Spacing is
// ~50–80 px apart along the top edge — small enough to feel curved, large
// enough that Matter doesn't choke on dozens of bodies.
export const DINO_SILHOUETTE: DinoSilhouette = {
  width: 1200,
  height: 500,
  tailPivot: { x: 460, y: 200 },
  tailStart: 9,
  points: [
    // ---- BACK (left edge → tail base) ----
    { x: 0, y: 130 },     // body exits canvas left, mid-back
    { x: 45, y: 100 },    // back rising
    { x: 100, y: 84 },
    { x: 170, y: 78 },    // hump peak
    { x: 240, y: 86 },
    { x: 310, y: 110 },   // descending toward tail
    { x: 370, y: 145 },
    { x: 420, y: 175 },
    { x: 460, y: 200 },   // tail base (matches tailPivot)
    // ---- TAIL slide (tail base → tip on the ground) ----
    { x: 520, y: 226 },
    { x: 590, y: 258 },
    { x: 660, y: 292 },
    { x: 740, y: 330 },
    { x: 820, y: 368 },
    { x: 900, y: 404 },
    { x: 980, y: 438 },
    { x: 1050, y: 466 },
    { x: 1110, y: 482 },
    { x: 1180, y: 494 },  // tail tip — lands on the ground in screen-space
  ],
  tapEllipse: {
    // Centered on the back hump (peak ~x=170, y=80). Sized so the tap target
    // covers the hump comfortably without bleeding into the tail slide
    // (which starts around x=460).
    cx: 190,
    cy: 140,
    rx: 200,
    ry: 100,
  },
};
