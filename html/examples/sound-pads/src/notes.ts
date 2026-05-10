// 16 pads. C major pentatonic across two octaves so any combination harmonizes.
// Layout is left-to-right, top-to-bottom, ascending — finger swipes produce
// ascending runs.

export interface PadDef {
  slug: string;
  freq: number;
  /** Solid resting color (0xRRGGBB). */
  color: number;
  /** Brighter shade flashed on press. */
  bright: number;
  /** Glow halo color, drawn behind the pad on press. */
  glow: number;
  /** Single keyboard key bound to this pad (lowercased). */
  key: string;
}

const NOTES: ReadonlyArray<readonly [string, number]> = [
  ["C4", 261.63],
  ["D4", 293.66],
  ["E4", 329.63],
  ["G4", 392.0],
  ["A4", 440.0],
  ["C5", 523.25],
  ["D5", 587.33],
  ["E5", 659.25],
  ["G5", 783.99],
  ["A5", 880.0],
  ["C6", 1046.5],
  ["D6", 1174.66],
  ["E6", 1318.51],
  ["G6", 1567.98],
  ["A6", 1760.0],
  ["C7", 2093.0],
];

// Top row → bottom row, matching the on-screen 4×4 grid.
const KEYS = [
  "1", "2", "3", "4",
  "q", "w", "e", "r",
  "a", "s", "d", "f",
  "z", "x", "c", "v",
];

function hsvToInt(h: number, s: number, v: number): number {
  const c = v * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1)      { r = c; g = x; b = 0; }
  else if (hp < 2) { r = x; g = c; b = 0; }
  else if (hp < 3) { r = 0; g = c; b = x; }
  else if (hp < 4) { r = 0; g = x; b = c; }
  else if (hp < 5) { r = x; g = 0; b = c; }
  else             { r = c; g = 0; b = x; }
  const m = v - c;
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

export const PADS: ReadonlyArray<PadDef> = NOTES.map(([slug, freq], i) => {
  // Wraparound rainbow: hue rotates a full circle across 16 pads.
  const hue = (i / NOTES.length) * 360;
  return {
    slug,
    freq,
    color: hsvToInt(hue, 0.78, 0.95),
    bright: hsvToInt(hue, 0.55, 1.0),
    glow: hsvToInt(hue, 0.35, 1.0),
    key: KEYS[i] ?? "",
  };
});
