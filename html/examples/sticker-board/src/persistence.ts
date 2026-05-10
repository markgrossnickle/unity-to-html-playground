// localStorage persistence for the sticker board.
//
// State is one flat array of placed stickers. We store the full position +
// transform so a refresh restores the board exactly. The `id` references a
// sticker definition (the texture key + thumbnail URL); definitions live in
// the scene module and don't need to be persisted.

const STORAGE_KEY = "unity-html-playground:sticker-board:v1";

export interface PlacedSticker {
  /** Unique per-instance id; generated when the sticker is dropped onto the board. */
  readonly uid: string;
  /** Sticker-type id (matches a definition in the scene). */
  readonly id: string;
  /** Canvas-local x, y. */
  x: number;
  y: number;
  /** Rotation in radians. */
  rotation: number;
  /** Uniform scale (1 = native sticker size). */
  scale: number;
  /** Stack order — higher numbers paint on top. */
  z: number;
}

export function loadStickers(): PlacedSticker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSticker);
  } catch {
    // Corrupted state — start fresh rather than throwing.
    return [];
  }
}

export function saveStickers(stickers: ReadonlyArray<PlacedSticker>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stickers));
  } catch {
    // Quota exceeded / private mode / storage disabled — silently no-op.
  }
}

export function clearStickers(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isValidSticker(v: unknown): v is PlacedSticker {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["uid"] === "string" &&
    typeof o["id"] === "string" &&
    typeof o["x"] === "number" &&
    typeof o["y"] === "number" &&
    typeof o["rotation"] === "number" &&
    typeof o["scale"] === "number" &&
    typeof o["z"] === "number"
  );
}

export function newUid(): string {
  // Cheap unique id — collision-free for any practical sticker count.
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
