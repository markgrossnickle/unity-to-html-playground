// Hand-authored stroke paths for digits 0–9.
//
// All coordinates live in the ART_BOX (400 wide × 600 tall). The scene scales
// and centers them at runtime. Each digit is a list of strokes; each stroke is
// a dense list of points in *drawing order* — the natural order a child is
// taught to draw the digit (top-down for vertical strokes, left-to-right for
// horizontal). Closed shapes (0, top/bottom of 8) start and end at the same
// point.

export type Pt = { x: number; y: number };

export type NumberDef = {
  digit: number;
  strokes: Pt[][];
};

export const ART_BOX = { width: 400, height: 600 };

// ── path-building helpers ─────────────────────────────────────────────────

function line(a: Pt, b: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x;
    const y =
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y;
    out.push({ x, y });
  }
  return out;
}

// Math-style ellipse with Y flipped for canvas. Increasing angle traces
// visually counter-clockwise. a0/a1 in radians; angle π/2 = top of ellipse.
function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  n: number
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = a0 + (a1 - a0) * t;
    out.push({ x: cx + rx * Math.cos(a), y: cy - ry * Math.sin(a) });
  }
  return out;
}

// Concatenate sub-segments, dropping duplicate join points.
function chain(...segs: Pt[][]): Pt[] {
  const out: Pt[] = [];
  segs.forEach((seg, i) => {
    if (seg.length === 0) return;
    if (i === 0) out.push(...seg);
    else out.push(...seg.slice(1));
  });
  return out;
}

// ── digit definitions ─────────────────────────────────────────────────────

const TAU = Math.PI * 2;

// 0 — one stroke, oval starting at top, counter-clockwise.
const D0: Pt[][] = [
  arc(200, 300, 95, 200, Math.PI / 2, Math.PI / 2 + TAU, 60),
];

// 1 — one stroke, vertical line top → bottom.
const D1: Pt[][] = [line({ x: 200, y: 100 }, { x: 200, y: 500 }, 45)];

// 2 — one continuous stroke: top hump from upper-left, around to right side,
// down-diagonal to lower-left, then horizontal across the bottom.
const D2: Pt[][] = [
  chain(
    cubic(
      { x: 120, y: 200 },
      { x: 120, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 210 },
      22
    ),
    cubic(
      { x: 300, y: 210 },
      { x: 300, y: 290 },
      { x: 230, y: 330 },
      { x: 110, y: 470 },
      22
    ),
    line({ x: 110, y: 470 }, { x: 300, y: 470 }, 22)
  ),
];

// 3 — one continuous stroke: upper bowl from upper-left around to middle,
// then lower bowl from middle around to lower-left.
const D3: Pt[][] = [
  chain(
    cubic(
      { x: 120, y: 150 },
      { x: 250, y: 80 },
      { x: 320, y: 220 },
      { x: 200, y: 300 },
      30
    ),
    cubic(
      { x: 200, y: 300 },
      { x: 330, y: 320 },
      { x: 290, y: 510 },
      { x: 110, y: 460 },
      30
    )
  ),
];

// 4 — two strokes.
// Stroke 1: diagonal down from upper-mid to mid-left, then horizontal right.
// Stroke 2: vertical down on the right, top → bottom.
const D4: Pt[][] = [
  chain(
    line({ x: 180, y: 100 }, { x: 100, y: 350 }, 24),
    line({ x: 100, y: 350 }, { x: 300, y: 350 }, 24)
  ),
  line({ x: 250, y: 100 }, { x: 250, y: 500 }, 45),
];

// 5 — two strokes.
// Stroke 1: vertical down on the left, then curve right and around to lower-left.
// Stroke 2: horizontal cap across the top, left → right (drawn last, like a hat).
const D5: Pt[][] = [
  chain(
    line({ x: 110, y: 130 }, { x: 110, y: 290 }, 22),
    cubic(
      { x: 110, y: 290 },
      { x: 230, y: 260 },
      { x: 310, y: 320 },
      { x: 290, y: 410 },
      24
    ),
    cubic(
      { x: 290, y: 410 },
      { x: 270, y: 490 },
      { x: 200, y: 500 },
      { x: 110, y: 470 },
      24
    )
  ),
  line({ x: 110, y: 130 }, { x: 290, y: 130 }, 30),
];

// 6 — one continuous stroke: top tail from upper-right curving down-left,
// then a closed loop at the bottom that ends where it started.
const D6: Pt[][] = [
  chain(
    cubic(
      { x: 280, y: 130 },
      { x: 200, y: 130 },
      { x: 130, y: 220 },
      { x: 110, y: 340 },
      24
    ),
    cubic(
      { x: 110, y: 340 },
      { x: 100, y: 490 },
      { x: 240, y: 520 },
      { x: 295, y: 430 },
      24
    ),
    cubic(
      { x: 295, y: 430 },
      { x: 320, y: 360 },
      { x: 230, y: 320 },
      { x: 110, y: 340 },
      24
    )
  ),
];

// 7 — one continuous stroke: horizontal across the top, then diagonal down
// to the lower-left.
const D7: Pt[][] = [
  chain(
    line({ x: 110, y: 130 }, { x: 300, y: 130 }, 22),
    line({ x: 300, y: 130 }, { x: 160, y: 500 }, 40)
  ),
];

// 8 — two strokes (top loop then bottom loop), each closed.
// Both loops start at top and proceed counter-clockwise.
const D8: Pt[][] = [
  arc(200, 200, 80, 100, Math.PI / 2, Math.PI / 2 + TAU, 50),
  arc(200, 410, 92, 105, Math.PI / 2, Math.PI / 2 + TAU, 50),
];

// 9 — two strokes.
// Stroke 1: closed loop at the top, counter-clockwise from the top.
// Stroke 2: tail dropping from the right of the loop down to the lower-mid.
const D9: Pt[][] = [
  arc(200, 220, 95, 110, Math.PI / 2, Math.PI / 2 + TAU, 50),
  line({ x: 295, y: 220 }, { x: 250, y: 500 }, 36),
];

export const NUMBER_DEFS: ReadonlyArray<NumberDef> = [
  { digit: 0, strokes: D0 },
  { digit: 1, strokes: D1 },
  { digit: 2, strokes: D2 },
  { digit: 3, strokes: D3 },
  { digit: 4, strokes: D4 },
  { digit: 5, strokes: D5 },
  { digit: 6, strokes: D6 },
  { digit: 7, strokes: D7 },
  { digit: 8, strokes: D8 },
  { digit: 9, strokes: D9 },
];
