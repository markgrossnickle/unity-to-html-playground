// Bottom drawer for the sticker board. Same DOM-based pattern as dino-drop,
// but stickers don't ever return to slots so the API is smaller.
//
// Drag flow:
//   pointerdown on a slot  → start drag, show floating ghost at pointer
//   pointermove            → ghost follows
//   pointerup              → if outside the drawer rect, fire onSpawn(id, x, y)

export interface StickerDef {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

export interface StickerSpawn {
  readonly id: string;
  readonly clientX: number;
  readonly clientY: number;
}

export interface StickerDrawerHandle {
  readonly element: HTMLElement;
  rect(): DOMRect;
}

export function initStickerDrawer(
  parent: HTMLElement,
  defs: ReadonlyArray<StickerDef>,
  onSpawn: (s: StickerSpawn) => void
): StickerDrawerHandle {
  const root = document.createElement("div");
  root.className = "drawer";

  const scroller = document.createElement("div");
  scroller.className = "drawer-scroll";
  root.appendChild(scroller);

  const ghost = document.createElement("div");
  ghost.className = "drawer-ghost";
  ghost.style.display = "none";
  document.body.appendChild(ghost);

  for (const def of defs) {
    const slot = document.createElement("button");
    slot.className = "drawer-slot";
    slot.type = "button";
    slot.setAttribute("aria-label", def.label);
    slot.dataset["id"] = def.id;

    const img = document.createElement("img");
    img.src = def.url;
    img.alt = def.label;
    img.draggable = false;
    slot.appendChild(img);

    scroller.appendChild(slot);

    // Intent detection: don't commit to drag mode until the user moves the
    // pointer enough to show they want to drag (not horizontally scroll the
    // drawer). Horizontal movement → let the browser scroll (pointercancel
    // fires because of `touch-action: pan-x`). Vertical movement above a
    // small threshold → commit to drag, capture the pointer, show the ghost.
    const DRAG_INTENT_THRESHOLD = 8; // px

    slot.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      const startDrag = (ev: PointerEvent) => {
        dragging = true;
        try { slot.setPointerCapture(ev.pointerId); } catch {}
        ghost.style.backgroundImage = `url(${def.url})`;
        ghost.style.display = "block";
        moveGhost(ev.clientX, ev.clientY);
      };

      const onMove = (ev: PointerEvent) => {
        if (dragging) {
          moveGhost(ev.clientX, ev.clientY);
          return;
        }
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        // Vertical-dominant movement past the threshold → drag.
        if (Math.abs(dy) > DRAG_INTENT_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
          startDrag(ev);
        }
        // Horizontal-dominant: do nothing — the browser is already scrolling
        // (touch-action: pan-x) and we'll get pointercancel when it commits.
      };

      const cleanup = (ev: PointerEvent) => {
        slot.removeEventListener("pointermove", onMove);
        slot.removeEventListener("pointerup", onUp);
        slot.removeEventListener("pointercancel", onCancel);
        if (dragging) {
          try { slot.releasePointerCapture(ev.pointerId); } catch {}
          ghost.style.display = "none";
        }
      };

      const onUp = (ev: PointerEvent) => {
        const wasDragging = dragging;
        cleanup(ev);
        if (!wasDragging) return;
        const r = root.getBoundingClientRect();
        const insideDrawer =
          ev.clientX >= r.left && ev.clientX <= r.right &&
          ev.clientY >= r.top && ev.clientY <= r.bottom;
        if (!insideDrawer) {
          onSpawn({ id: def.id, clientX: ev.clientX, clientY: ev.clientY });
        }
      };

      const onCancel = (ev: PointerEvent) => {
        // Browser took over for horizontal panning. Abort silently.
        cleanup(ev);
      };

      slot.addEventListener("pointermove", onMove);
      slot.addEventListener("pointerup", onUp);
      slot.addEventListener("pointercancel", onCancel);
    });
  }

  function moveGhost(x: number, y: number) {
    ghost.style.transform = `translate(${x - 40}px, ${y - 40}px)`;
  }

  parent.appendChild(root);

  return {
    element: root,
    rect: () => root.getBoundingClientRect(),
  };
}
