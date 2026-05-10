// Hand-authored stroke paths for digits 0–9.
//
// Stroke counts and order follow Handwriting Without Tears (HWT) — the
// curriculum used in most U.S. early-elementary classrooms. HWT emphasizes
// simple "lift your pencil" multi-stroke forms over the single-stroke italic
// shapes used in D'Nealian. Where HWT and Zaner-Bloser disagree the form
// taught to the youngest writers (more pencil lifts, more deliberate
// segments) is preferred.
//
// Per-digit summary:
//   0 — 1 stroke.  Counter-clockwise oval from the top.
//   1 — 2 strokes. Diagonal flag at top-left, then long vertical stem.
//   2 — 2 strokes. Top hump curving down to the lower-left, then bottom bar.
//   3 — 1 stroke.  Top bump + bottom bump, meeting in the middle.
//   4 — 2 strokes. "Open four": left vertical + cross bar, then right vertical.
//   5 — 2 strokes. Left vertical + bottom curl, then top "hat" bar drawn last.
//   6 — 1 stroke.  Tail down-left into a closed bottom loop.
//   7 — 2 strokes. Top horizontal bar, then diagonal down to the baseline.
//   8 — 1 stroke.  Continuous lemniscate with an X-crossing at the center.
//   9 — 1 stroke.  Closed counter-clockwise top loop + straight tail down.
//
// All coordinates live in the ART_BOX (400 wide × 600 tall). The scene scales
// and centers them at runtime. Each digit is a list of strokes in the order
// a child writes them — the runtime requires each stroke to finish before
// the next unlocks. Within a stroke, points are dense (~30–60) and ordered
// in the natural drawing direction; the runtime lets the user start at
// either endpoint of the active stroke.

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

// 1 — two strokes (flag + stem).
// Stroke 1: short diagonal flag from the upper-left tip up to the top of the
//           stem.
// Stroke 2: long vertical stem from the top to the baseline.
const D1: Pt[][] = [
  line({ x: 145, y: 175 }, { x: 200, y: 120 }, 18),
  line({ x: 200, y: 120 }, { x: 200, y: 500 }, 44),
];

// 2 — two strokes.
// Stroke 1: top hump from upper-left, around to the right, then a long
//           diagonal down to the lower-left baseline corner.
// Stroke 2: horizontal bottom bar, left → right.
const D2: Pt[][] = [
  chain(
    cubic(
      { x: 120, y: 200 },
      { x: 120, y: 110 },
      { x: 300, y: 110 },
      { x: 300, y: 210 },
      22
    ),
    cubic(
      { x: 300, y: 210 },
      { x: 290, y: 290 },
      { x: 210, y: 350 },
      { x: 110, y: 470 },
      26
    )
  ),
  line({ x: 110, y: 470 }, { x: 300, y: 470 }, 28),
];

// 3 — one continuous stroke: top bump from upper-left around to the middle,
// then bottom bump from the middle around to the lower-left.
const D3: Pt[][] = [
  chain(
    cubic(
      { x: 120, y: 170 },
      { x: 200, y: 100 },
      { x: 300, y: 170 },
      { x: 200, y: 300 },
      30
    ),
    cubic(
      { x: 200, y: 300 },
      { x: 300, y: 320 },
      { x: 290, y: 500 },
      { x: 120, y: 460 },
      30
    )
  ),
];

// 4 — two strokes ("open four", HWT).
// Stroke 1: vertical down on the left, then horizontal right at the cross bar.
// Stroke 2: vertical down on the right, crossing through the bar to the
//           baseline.
const D4: Pt[][] = [
  chain(
    line({ x: 130, y: 120 }, { x: 130, y: 340 }, 22),
    line({ x: 130, y: 340 }, { x: 290, y: 340 }, 22)
  ),
  line({ x: 250, y: 120 }, { x: 250, y: 500 }, 40),
];

// 5 — two strokes (top bar drawn LAST, HWT).
// Stroke 1: vertical down from the upper-left to mid-height, then curve right
//           and around the bottom bowl, ending at the lower-left baseline.
// Stroke 2: horizontal "hat" across the top, left → right.
const D5: Pt[][] = [
  chain(
    line({ x: 110, y: 140 }, { x: 110, y: 290 }, 20),
    cubic(
      { x: 110, y: 290 },
      { x: 230, y: 260 },
      { x: 310, y: 320 },
      { x: 290, y: 420 },
      24
    ),
    cubic(
      { x: 290, y: 420 },
      { x: 270, y: 490 },
      { x: 200, y: 500 },
      { x: 110, y: 470 },
      24
    )
  ),
  line({ x: 110, y: 140 }, { x: 290, y: 140 }, 28),
];

// 6 — one continuous stroke: tail from the upper-right curving down-left,
// then a closed loop at the bottom that returns to where the tail meets it.
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

// 7 — two strokes (HWT).
// Stroke 1: top horizontal bar, left → right.
// Stroke 2: diagonal from the upper-right down to the lower-left baseline.
const D7: Pt[][] = [
  line({ x: 110, y: 140 }, { x: 300, y: 140 }, 28),
  line({ x: 300, y: 140 }, { x: 160, y: 500 }, 40),
];

// 8 — one stroke (lemniscate / figure-eight with an X-crossing at center).
// The top loop is traced in two halves (right side first, then left side),
// with the bottom loop drawn between them. The two halves of each loop join
// into a closed loop, and the path crosses itself at the center.
const D8: Pt[][] = [
  chain(
    // Top of top loop → upper-right → center  (right half of top loop)
    cubic(
      { x: 200, y: 120 },
      { x: 290, y: 130 },
      { x: 290, y: 270 },
      { x: 200, y: 300 },
      18
    ),
    // Center → lower-left → bottom            (left half of bottom loop)
    cubic(
      { x: 200, y: 300 },
      { x: 110, y: 330 },
      { x: 110, y: 470 },
      { x: 200, y: 490 },
      18
    ),
    // Bottom → lower-right → center           (right half of bottom loop)
    cubic(
      { x: 200, y: 490 },
      { x: 290, y: 470 },
      { x: 290, y: 330 },
      { x: 200, y: 300 },
      18
    ),
    // Center → upper-left → top of top loop   (left half of top loop)
    cubic(
      { x: 200, y: 300 },
      { x: 110, y: 270 },
      { x: 110, y: 130 },
      { x: 200, y: 120 },
      18
    )
  ),
];

// 9 — one continuous stroke. Closed counter-clockwise top loop, joined at the
// upper-right where the tail drops straight down to the baseline.
const D9_LOOP_START = Math.PI / 5; // ~36° above the +x axis on the loop
const D9_TAIL_TOP: Pt = {
  x: 200 + 95 * Math.cos(D9_LOOP_START),
  y: 215 - 100 * Math.sin(D9_LOOP_START),
};
const D9: Pt[][] = [
  chain(
    arc(200, 215, 95, 100, D9_LOOP_START, D9_LOOP_START + TAU, 50),
    line(D9_TAIL_TOP, { x: 255, y: 500 }, 34)
  ),
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
