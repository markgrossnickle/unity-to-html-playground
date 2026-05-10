// Authored layout of the house. Each piece is a rectangle (centerX, centerY,
// width, height) with an associated sprite key. Positions are in reference
// world coordinates (REF_W=1600 × REF_H=900). The scene plants each piece as
// a static Matter body at start; on first ball impact above SHATTER_VELOCITY
// the body flips to dynamic and the impulse propagates.

export interface HousePiece {
  readonly id: string;
  readonly tex: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const HX = 1320; // house center column
const GY = 820; // ground line (same as scene GROUND_Y)

// Vertically, walls are 90 tall; doors/chimneys 110; windows 80.
// Rows:
//   bottom: y center = GY - 45 (wall) or GY - 55 (door/chimney)
//   top:    y center = GY - 135 (wall) or GY - 130 (window)
//   roof:   sits atop top row
export const HOUSE_PIECES: ReadonlyArray<HousePiece> = [
  // Bottom row (foundation) — walls left/right + door middle
  { id: "wall-bl", tex: "wall-a", x: HX - 110, y: GY - 45, w: 110, h: 90 },
  { id: "door",   tex: "door",    x: HX,       y: GY - 55, w: 70,  h: 110 },
  { id: "wall-br", tex: "wall-b", x: HX + 110, y: GY - 45, w: 110, h: 90 },

  // Top row — walls left/right + window middle
  { id: "wall-tl", tex: "wall-c", x: HX - 110, y: GY - 135, w: 110, h: 90 },
  { id: "window",  tex: "window", x: HX,       y: GY - 130, w: 80,  h: 80 },
  { id: "wall-tr", tex: "wall-d", x: HX + 110, y: GY - 135, w: 110, h: 90 },

  // Roof — a single large triangle/rectangle spanning all three columns
  { id: "roof",    tex: "roof",   x: HX,       y: GY - 235, w: 360, h: 110 },

  // Chimney — sits on the right side of the roof
  { id: "chimney", tex: "chimney", x: HX + 80, y: GY - 345, w: 50, h: 110 },
];
