import {
  state,
  setSelectedColor,
} from "./state";
import { events } from "./events";

// 12 swatches. Hand-picked for warm/cool balance plus neutrals so any region
// can read on either side of the color wheel without a custom picker.
const PALETTE: readonly string[] = [
  "#ff5757",
  "#ff8c42",
  "#ffd23f",
  "#a4de65",
  "#3fb27f",
  "#36c5d3",
  "#3a8dde",
  "#7d5fff",
  "#c66bf3",
  "#f06292",
  "#8b6914",
  "#1c1c1c",
];

export function initPalette(): void {
  const grid = document.getElementById("palette-grid")!;
  const recentRow = document.getElementById("palette-recent")!;
  const recentEmpty = document.getElementById("palette-recent-empty")!;

  for (const hex of PALETTE) {
    grid.appendChild(makeSwatch(hex));
  }

  const initial = PALETTE[0]!;
  setSelectedColor(initial);
  applySelection(initial);

  events.on("color:select", applySelection);
  events.on("recent:update", () => {
    recentRow.replaceChildren(
      ...state.recentColors.map((hex) => makeSwatch(hex))
    );
    recentEmpty.style.display = state.recentColors.length === 0 ? "" : "none";
  });
}

function makeSwatch(hex: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "swatch";
  btn.style.backgroundColor = hex;
  btn.dataset.hex = hex;
  btn.setAttribute("aria-label", `color ${hex}`);
  if (hex === state.selectedColor) btn.classList.add("selected");
  btn.addEventListener("click", () => setSelectedColor(hex));
  return btn;
}

function applySelection(hex: string): void {
  for (const el of document.querySelectorAll<HTMLElement>(".swatch")) {
    el.classList.toggle("selected", el.dataset.hex === hex);
  }
}
