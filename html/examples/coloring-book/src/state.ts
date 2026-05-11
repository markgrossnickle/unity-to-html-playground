import { events, type Tool } from "./events";

export interface State {
  selectedColor: string;
  selectedTool: Tool;
  selectedPicture: string;
  // Pre-action canvas snapshots. Each user action (bucket fill, pencil/brush/
  // eraser stroke, clear) pushes one snapshot of the fill canvas as it was
  // BEFORE the action. Undo pops + restores. A unified history lets all four
  // tools share the same undo path; the only cost is ~3 MB per snapshot at
  // 1200² which is why we cap small.
  history: ImageData[];
  recentColors: string[];
}

const HISTORY_CAP = 10;
const RECENT_CAP = 3;

export const state: State = {
  selectedColor: "#ff5757",
  selectedTool: "bucket",
  selectedPicture: "",
  history: [],
  recentColors: [],
};

export function setSelectedColor(hex: string): void {
  state.selectedColor = hex;
  events.emit("color:select", hex);
}

export function setSelectedTool(tool: Tool): void {
  state.selectedTool = tool;
  events.emit("tool:select", tool);
}

export function pushSnapshot(snapshot: ImageData): void {
  state.history.push(snapshot);
  if (state.history.length > HISTORY_CAP) state.history.shift();
}

export function popSnapshot(): ImageData | undefined {
  return state.history.pop();
}

export function resetForPicture(slug: string): void {
  state.selectedPicture = slug;
  state.history = [];
}

export function addRecentColor(hex: string): void {
  state.recentColors = [hex, ...state.recentColors.filter((c) => c !== hex)].slice(
    0,
    RECENT_CAP
  );
  events.emit("recent:update", undefined);
}
