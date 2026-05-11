import { events, type Tool } from "./events";
import { setSelectedTool, state } from "./state";

const TOOLS: ReadonlyArray<{ id: Tool; icon: string; label: string }> = [
  { id: "bucket", icon: "🪣", label: "Fill" },
  { id: "pencil", icon: "✏️", label: "Pencil" },
  { id: "brush", icon: "🖌️", label: "Brush" },
  { id: "eraser", icon: "🧹", label: "Eraser" },
];

export function initTools(): void {
  const row = document.getElementById("tool-row");
  if (!row) return;

  for (const t of TOOLS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tool";
    btn.dataset.tool = t.id;
    btn.setAttribute("aria-label", t.label);
    btn.title = t.label;
    btn.textContent = t.icon;
    if (t.id === state.selectedTool) btn.classList.add("selected");
    btn.addEventListener("click", () => setSelectedTool(t.id));
    row.appendChild(btn);
  }

  events.on("tool:select", (tool) => {
    for (const el of row.querySelectorAll<HTMLElement>(".tool")) {
      el.classList.toggle("selected", el.dataset.tool === tool);
    }
  });
}
