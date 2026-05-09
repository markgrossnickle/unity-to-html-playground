import { events } from "./events";
import { PICTURES } from "./pictures";
import { state } from "./state";

export function initPicker(): void {
  const modal = document.getElementById("picker-modal")!;
  const grid = document.getElementById("picker-grid")!;
  const openBtn = document.getElementById("btn-pictures")!;
  const closeBtn = document.getElementById("picker-close")!;

  for (const p of PICTURES) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "picker-cell";
    cell.dataset.slug = p.slug;

    const img = document.createElement("img");
    img.src = p.linesUrl;
    img.alt = p.title;
    img.draggable = false;

    const label = document.createElement("span");
    label.textContent = p.title;

    cell.append(img, label);
    cell.addEventListener("click", () => {
      events.emit("picture:select", p.slug);
      close();
    });
    grid.appendChild(cell);
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  function open(): void {
    refreshHighlight();
    modal.classList.add("open");
  }
  function close(): void {
    modal.classList.remove("open");
  }
  function refreshHighlight(): void {
    for (const el of grid.querySelectorAll<HTMLElement>(".picker-cell")) {
      el.classList.toggle("current", el.dataset.slug === state.selectedPicture);
    }
  }
}
