import { events } from "./events";
import {
  clearImportedPictures,
  getAllPictures,
  getImportedCount,
  getImportedSlugs,
  removeImportedPicture,
  StorageQuotaError,
  type Picture,
} from "./pictures";
import { state } from "./state";

export function initPicker(): void {
  const modal = document.getElementById("picker-modal")!;
  const grid = document.getElementById("picker-grid")!;
  const openBtn = document.getElementById("btn-pictures")!;
  const closeBtn = document.getElementById("picker-close")!;
  const header = modal.querySelector(".picker-card header") as HTMLElement | null;

  function rebuild(): void {
    grid.replaceChildren(...getAllPictures().map((p) => makeCell(p, close)));
    refreshHighlight();
    refreshClearAllButton();
  }

  function refreshClearAllButton(): void {
    if (!header) return;
    const existing = header.querySelector(".picker-clear-all");
    const count = getImportedCount();
    if (count === 0) {
      existing?.remove();
      return;
    }
    if (existing) {
      existing.textContent = `Clear all imports (${count})`;
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-clear-all";
    btn.textContent = `Clear all imports (${count})`;
    btn.addEventListener("click", () => {
      const n = getImportedCount();
      if (n === 0) return;
      if (!window.confirm(`Remove all ${n} imported picture${n === 1 ? "" : "s"}?`)) {
        return;
      }
      // Snapshot slugs before clearing so we can emit per-picture cleanup
      // events; the scene listens to picture:removed to drop Phaser textures
      // and fall back if the current picture is one of the removed ones.
      const slugs = getImportedSlugs();
      try {
        clearImportedPictures();
      } catch {
        window.alert("Could not clear imports.");
        return;
      }
      for (const slug of slugs) events.emit("picture:removed", slug);
    });
    // Insert before the close × so the layout stays balanced.
    const closeEl = header.querySelector(".picker-close");
    if (closeEl) header.insertBefore(btn, closeEl);
    else header.appendChild(btn);
  }

  function refreshHighlight(): void {
    for (const el of grid.querySelectorAll<HTMLElement>(".picker-cell")) {
      el.classList.toggle("current", el.dataset.slug === state.selectedPicture);
    }
  }

  function open(): void {
    refreshHighlight();
    modal.classList.add("open");
  }
  function close(): void {
    modal.classList.remove("open");
  }

  rebuild();

  events.on("pictures:update", rebuild);

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
}

function makeCell(p: Picture, closeModal: () => void): HTMLElement {
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

  if (p.imported) {
    const badge = document.createElement("span");
    badge.className = "picker-badge";
    badge.textContent = "Imported";
    cell.appendChild(badge);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "picker-delete";
    del.setAttribute("aria-label", `Remove ${p.title}`);
    del.textContent = "×";
    del.addEventListener("click", (e) => {
      // Stop the click from reaching the parent .picker-cell button — that
      // would also try to load the (about-to-be-deleted) picture.
      e.stopPropagation();
      if (!window.confirm("Remove this imported picture?")) return;
      try {
        removeImportedPicture(p.slug);
        events.emit("picture:removed", p.slug);
      } catch (err) {
        const msg =
          err instanceof StorageQuotaError ? err.message : "Could not remove picture.";
        window.alert(msg);
      }
    });
    cell.appendChild(del);
  }

  cell.addEventListener("click", () => {
    events.emit("picture:select", p.slug);
    closeModal();
  });
  return cell;
}
