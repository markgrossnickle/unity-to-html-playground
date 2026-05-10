// Hand-authored stroke paths for uppercase letters A–Z.
//
// Stroke order follows Handwriting Without Tears (HWT) capital-letter
// instruction for early elementary: most strokes start at the top, "big lines"
// before "little lines", verticals before horizontals, with a few HWT-specific
// exceptions (e.g. N has three strokes — left down, diagonal down, right UP).
//
// Coordinates share the ART_BOX (400×600) used by numberPaths.ts. Each glyph's
// strokes are listed in drawing order; each stroke is a dense Pt[] in the
// natural direction a child would form the stroke.
//
// Helpers (line/cubic/arc/chain) are mirrored from numberPaths.ts. They are
// not exported from numberPaths.ts and that file is being edited in parallel,
// so we re-declare them here rather than touching it. If those helpers ever
// get exported, this file can switch to importing them with no other changes.

import { ART_BOX, type Pt } from "./numberPaths";

export type Glyph = {
  label: string;
  strokes: Pt[][];
};

export { ART_BOX };
export type { Pt };

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

function chain(...segs: Pt[][]): Pt[] {
  const out: Pt[] = [];
  segs.forEach((seg, i) => {
    if (seg.length === 0) return;
    if (i === 0) out.push(...seg);
    else out.push(...seg.slice(1));
  });
  return out;
}

// ── letter definitions ────────────────────────────────────────────────────
//
// Letter art lives in the 400×600 box used by numbers. Standard frame:
//   top y=100, baseline y=500, midline y=300
//   left x=110, right x=290 (≈ 200px wide, centered on x=200)

const TAU = Math.PI * 2;

// A — 3 strokes: left diagonal (apex → lower-left), right diagonal
// (apex → lower-right), then horizontal crossbar.
const A: Pt[][] = [
  line({ x: 200, y: 100 }, { x: 110, y: 500 }, 45),
  line({ x: 200, y: 100 }, { x: 290, y: 500 }, 45),
  line({ x: 145, y: 360 }, { x: 255, y: 360 }, 30),
];

// B — 3 strokes per HWT: (1) vertical line down from upper-left to baseline,
// "frog jump" back to top, (2) top bump from upper-left around to middle-left,
// "frog jump" back to middle, (3) bottom bump from middle-left around to baseline.
const B: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  cubic(
    { x: 110, y: 100 },
    { x: 280, y: 100 },
    { x: 280, y: 290 },
    { x: 110, y: 300 },
    40
  ),
  cubic(
    { x: 110, y: 300 },
    { x: 290, y: 310 },
    { x: 290, y: 500 },
    { x: 110, y: 500 },
    40
  ),
];

// C — 1 stroke: open arc from upper-right around to lower-right.
const C: Pt[][] = [
  arc(200, 300, 95, 200, Math.PI * 0.35, Math.PI * 1.65, 60),
];

// D — 2 strokes: vertical, then big bump from top-of-stem around to base.
const D: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  cubic(
    { x: 110, y: 100 },
    { x: 340, y: 120 },
    { x: 340, y: 480 },
    { x: 110, y: 500 },
    60
  ),
];

// E — 4 strokes: vertical, then top, middle, bottom horizontals.
const E: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  line({ x: 110, y: 100 }, { x: 290, y: 100 }, 30),
  line({ x: 110, y: 300 }, { x: 260, y: 300 }, 26),
  line({ x: 110, y: 500 }, { x: 290, y: 500 }, 30),
];

// F — 3 strokes: vertical, top horizontal, middle horizontal.
const F: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  line({ x: 110, y: 100 }, { x: 290, y: 100 }, 30),
  line({ x: 110, y: 300 }, { x: 260, y: 300 }, 26),
];

// G — 2 strokes: C-shape, then short horizontal at the right end pointing in.
const G: Pt[][] = [
  arc(200, 300, 95, 200, Math.PI * 0.35, Math.PI * 1.7, 60),
  line({ x: 275, y: 410 }, { x: 200, y: 410 }, 18),
];

// H — 3 strokes: left vertical, right vertical, middle horizontal.
const H: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  line({ x: 290, y: 100 }, { x: 290, y: 500 }, 45),
  line({ x: 110, y: 300 }, { x: 290, y: 300 }, 30),
];

// I — 3 strokes: top horizontal, vertical, bottom horizontal.
const I: Pt[][] = [
  line({ x: 140, y: 100 }, { x: 260, y: 100 }, 22),
  line({ x: 200, y: 100 }, { x: 200, y: 500 }, 45),
  line({ x: 140, y: 500 }, { x: 260, y: 500 }, 22),
];

// J — 2 strokes: top horizontal, then vertical with hook left at bottom.
const J: Pt[][] = [
  line({ x: 140, y: 100 }, { x: 260, y: 100 }, 22),
  chain(
    line({ x: 200, y: 100 }, { x: 200, y: 410 }, 30),
    cubic(
      { x: 200, y: 410 },
      { x: 200, y: 500 },
      { x: 150, y: 500 },
      { x: 110, y: 460 },
      24
    )
  ),
];

// K — 3 strokes: vertical, upper diagonal (top-right → mid-stem),
// lower diagonal (mid-stem → bottom-right).
const K: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  line({ x: 290, y: 100 }, { x: 110, y: 300 }, 30),
  line({ x: 110, y: 300 }, { x: 290, y: 500 }, 30),
];

// L — 2 strokes: vertical, then bottom horizontal.
const L: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  line({ x: 110, y: 500 }, { x: 290, y: 500 }, 30),
];

// M — 4 strokes: left vertical, diagonal down to middle valley,
// diagonal up to top, right vertical down.
const M: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  line({ x: 110, y: 100 }, { x: 200, y: 320 }, 30),
  line({ x: 200, y: 320 }, { x: 290, y: 100 }, 30),
  line({ x: 290, y: 100 }, { x: 290, y: 500 }, 45),
];

// N — 3 strokes (HWT): left vertical DOWN, diagonal top-left → bottom-right,
// right vertical UP. Stroke 3 deliberately runs bottom-up to match HWT.
const N: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  line({ x: 110, y: 100 }, { x: 290, y: 500 }, 50),
  line({ x: 290, y: 500 }, { x: 290, y: 100 }, 45),
];

// O — 1 stroke: oval, counter-clockwise from top.
const O: Pt[][] = [
  arc(200, 300, 95, 200, Math.PI / 2, Math.PI / 2 + TAU, 60),
];

// P — 2 strokes: vertical, then top bump back to midline.
const P: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  cubic(
    { x: 110, y: 100 },
    { x: 290, y: 100 },
    { x: 290, y: 290 },
    { x: 110, y: 300 },
    36
  ),
];

// Q — 2 strokes: oval like O, then short diagonal tail at bottom-right.
const Q: Pt[][] = [
  arc(200, 300, 95, 200, Math.PI / 2, Math.PI / 2 + TAU, 60),
  line({ x: 240, y: 430 }, { x: 310, y: 510 }, 20),
];

// R — 3 strokes: vertical, top bump (like P), then diagonal leg.
const R: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 110, y: 500 }, 45),
  cubic(
    { x: 110, y: 100 },
    { x: 290, y: 100 },
    { x: 290, y: 290 },
    { x: 110, y: 300 },
    36
  ),
  line({ x: 110, y: 300 }, { x: 290, y: 500 }, 32),
];

// S — 1 stroke: top hump curving CCW, S-diagonal through middle, bottom hump
// curving CW. Sampled as three cubics chained so a single point array drags
// smoothly end-to-end.
const S: Pt[][] = [
  chain(
    cubic(
      { x: 280, y: 180 },
      { x: 240, y: 100 },
      { x: 140, y: 110 },
      { x: 120, y: 220 },
      22
    ),
    cubic(
      { x: 120, y: 220 },
      { x: 130, y: 300 },
      { x: 270, y: 310 },
      { x: 280, y: 400 },
      22
    ),
    cubic(
      { x: 280, y: 400 },
      { x: 290, y: 500 },
      { x: 180, y: 520 },
      { x: 120, y: 430 },
      22
    )
  ),
];

// T — 2 strokes: top horizontal, then vertical down through middle.
const T: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 290, y: 100 }, 30),
  line({ x: 200, y: 100 }, { x: 200, y: 500 }, 45),
];

// U — 1 stroke: down-left side, curve across the bottom, up-right side.
const U: Pt[][] = [
  chain(
    line({ x: 110, y: 100 }, { x: 110, y: 380 }, 28),
    cubic(
      { x: 110, y: 380 },
      { x: 110, y: 500 },
      { x: 290, y: 500 },
      { x: 290, y: 380 },
      24
    ),
    line({ x: 290, y: 380 }, { x: 290, y: 100 }, 28)
  ),
];

// V — 2 strokes: diagonal down to bottom point, diagonal up to top-right.
const V: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 200, y: 500 }, 45),
  line({ x: 200, y: 500 }, { x: 290, y: 100 }, 45),
];

// W — 4 strokes: down-right, up-right, down-right, up-right (zigzag).
const W: Pt[][] = [
  line({ x: 100, y: 100 }, { x: 165, y: 500 }, 45),
  line({ x: 165, y: 500 }, { x: 200, y: 260 }, 30),
  line({ x: 200, y: 260 }, { x: 235, y: 500 }, 30),
  line({ x: 235, y: 500 }, { x: 300, y: 100 }, 45),
];

// X — 2 strokes: diagonal \ then diagonal /. Both start at the top.
const X: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 290, y: 500 }, 50),
  line({ x: 290, y: 100 }, { x: 110, y: 500 }, 50),
];

// Y — 3 strokes: diagonal in from top-left, diagonal in from top-right,
// vertical down from junction to baseline.
const Y: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 200, y: 300 }, 28),
  line({ x: 290, y: 100 }, { x: 200, y: 300 }, 28),
  line({ x: 200, y: 300 }, { x: 200, y: 500 }, 28),
];

// Z — 3 strokes: top horizontal, diagonal down-left, bottom horizontal.
const Z: Pt[][] = [
  line({ x: 110, y: 100 }, { x: 290, y: 100 }, 30),
  line({ x: 290, y: 100 }, { x: 110, y: 500 }, 50),
  line({ x: 110, y: 500 }, { x: 290, y: 500 }, 30),
];

export const LETTER_DEFS: ReadonlyArray<Glyph> = [
  { label: "A", strokes: A },
  { label: "B", strokes: B },
  { label: "C", strokes: C },
  { label: "D", strokes: D },
  { label: "E", strokes: E },
  { label: "F", strokes: F },
  { label: "G", strokes: G },
  { label: "H", strokes: H },
  { label: "I", strokes: I },
  { label: "J", strokes: J },
  { label: "K", strokes: K },
  { label: "L", strokes: L },
  { label: "M", strokes: M },
  { label: "N", strokes: N },
  { label: "O", strokes: O },
  { label: "P", strokes: P },
  { label: "Q", strokes: Q },
  { label: "R", strokes: R },
  { label: "S", strokes: S },
  { label: "T", strokes: T },
  { label: "U", strokes: U },
  { label: "V", strokes: V },
  { label: "W", strokes: W },
  { label: "X", strokes: X },
  { label: "Y", strokes: Y },
  { label: "Z", strokes: Z },
];
