import { events } from "./events";

export interface FillCommand {
  regionId: number;
  from: string | undefined; // previous color, or undefined if region was empty
  to: string;
}

export interface State {
  selectedColor: string;
  selectedPicture: string;
  // regionId → hex color. Source of truth for the fill canvas; the canvas is a
  // pure function of (labelMap, fillMap) so we never need to snapshot pixels.
  fillMap: Map<number, string>;
  history: FillCommand[];
  recentColors: string[];
}

const HISTORY_CAP = 50;
const RECENT_CAP = 3;

export const state: State = {
  selectedColor: "#ff5757",
  selectedPicture: "",
  fillMap: new Map(),
  history: [],
  recentColors: [],
};

export function setSelectedColor(hex: string): void {
  state.selectedColor = hex;
  events.emit("color:select", hex);
}

export function pushFill(cmd: FillCommand): void {
  state.history.push(cmd);
  if (state.history.length > HISTORY_CAP) state.history.shift();
}

export function popFill(): FillCommand | undefined {
  return state.history.pop();
}

export function resetForPicture(slug: string): void {
  state.selectedPicture = slug;
  state.fillMap = new Map();
  state.history = [];
}

export function addRecentColor(hex: string): void {
  state.recentColors = [hex, ...state.recentColors.filter((c) => c !== hex)].slice(
    0,
    RECENT_CAP
  );
  events.emit("recent:update", undefined);
}
