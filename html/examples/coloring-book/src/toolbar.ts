import { events } from "./events";

export function initToolbar(): void {
  document
    .getElementById("btn-undo")!
    .addEventListener("click", () => events.emit("undo", undefined));
  document
    .getElementById("btn-clear")!
    .addEventListener("click", () => events.emit("clear", undefined));
  document
    .getElementById("btn-save")!
    .addEventListener("click", () => events.emit("save", undefined));
}
