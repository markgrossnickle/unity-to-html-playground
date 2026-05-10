// Bottom drawer of draggable thumbnails. Rendered as plain DOM (not in the
// Phaser canvas) — easier to scroll horizontally on mobile and the drag
// ghost can use ordinary CSS transforms.
//
// The drawer is a "source" of objects: each thumbnail is a permanent slot;
// dragging out of a slot creates a *new* physics body in the scene; the
// thumbnail itself stays put. After a slap, returning thumbnails are
// tween-animated back into their original slot positions.

export interface DrawerObject {
  /** Stable id used as the texture key in the scene + mapping back to slots. */
  readonly id: string;
  /** Display name (shown as alt text). */
  readonly label: string;
  /** Public URL for the thumbnail PNG (Vite-imported). */
  readonly url: string;
}

export interface DrawerSpawn {
  /** Which object was dropped. */
  readonly id: string;
  /** Page-coordinate drop point. The scene converts to canvas-local. */
  readonly clientX: number;
  readonly clientY: number;
}

export interface DrawerHandle {
  /** Element that hosts the drawer (caller appends it where they want). */
  readonly element: HTMLElement;
  /** Geometry of the drawer's bounding box, used to detect "released over drawer." */
  rect(): DOMRect;
  /** Tween a thumbnail "ghost" from a screen point back to its drawer slot. */
  animateReturn(id: string, fromClientX: number, fromClientY: number): Promise<void>;
  /** Dim (or restore) a slot. Dimmed slots are non-interactable until restored. */
  setSlotActive(id: string, active: boolean): void;
}

export function initDrawer(
  parent: HTMLElement,
  objects: ReadonlyArray<DrawerObject>,
  onSpawn: (spawn: DrawerSpawn) => void
): DrawerHandle {
  const root = document.createElement("div");
  root.className = "drawer";

  const scroller = document.createElement("div");
  scroller.className = "drawer-scroll";
  root.appendChild(scroller);

  // Floating ghost element (one shared instance, reused per drag).
  const ghost = document.createElement("div");
  ghost.className = "drawer-ghost";
  ghost.style.display = "none";
  document.body.appendChild(ghost);

  const slotByid = new Map<string, HTMLElement>();

  for (const obj of objects) {
    const slot = document.createElement("button");
    slot.className = "drawer-slot";
    slot.type = "button";
    slot.setAttribute("aria-label", obj.label);
    slot.dataset["id"] = obj.id;

    const img = document.createElement("img");
    img.src = obj.url;
    img.alt = obj.label;
    img.draggable = false;
    slot.appendChild(img);

    scroller.appendChild(slot);
    slotByid.set(obj.id, slot);

    attachPointer(slot, obj, img.src);
  }

  parent.appendChild(root);

  function attachPointer(slot: HTMLElement, obj: DrawerObject, imgUrl: string) {
    slot.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;

      // If this slot's live instance is still in play, refuse to drag —
      // a brief shake hints to the user that the slot is "spent."
      if (slot.classList.contains("drawer-slot-dimmed")) {
        slot.classList.remove("drawer-slot-shake");
        // Force reflow so the same animation can restart immediately.
        void slot.offsetWidth;
        slot.classList.add("drawer-slot-shake");
        return;
      }

      e.preventDefault();
      slot.setPointerCapture(e.pointerId);

      ghost.style.backgroundImage = `url(${imgUrl})`;
      ghost.style.display = "block";
      moveGhost(e.clientX, e.clientY);

      const onMove = (ev: PointerEvent) => moveGhost(ev.clientX, ev.clientY);
      const onUp = (ev: PointerEvent) => {
        slot.removeEventListener("pointermove", onMove);
        slot.removeEventListener("pointerup", onUp);
        slot.removeEventListener("pointercancel", onUp);
        try { slot.releasePointerCapture(ev.pointerId); } catch {}
        ghost.style.display = "none";

        // If released over the drawer rect → no spawn.
        const r = root.getBoundingClientRect();
        const insideDrawer =
          ev.clientX >= r.left && ev.clientX <= r.right &&
          ev.clientY >= r.top && ev.clientY <= r.bottom;
        if (!insideDrawer) {
          onSpawn({ id: obj.id, clientX: ev.clientX, clientY: ev.clientY });
        }
      };
      slot.addEventListener("pointermove", onMove);
      slot.addEventListener("pointerup", onUp);
      slot.addEventListener("pointercancel", onUp);
    });
  }

  function moveGhost(x: number, y: number) {
    ghost.style.transform = `translate(${x - 32}px, ${y - 32}px)`;
  }

  function setSlotActive(id: string, active: boolean) {
    const slot = slotByid.get(id);
    if (!slot) return;
    slot.classList.toggle("drawer-slot-dimmed", active);
    if (!active) slot.classList.remove("drawer-slot-shake");
  }

  return {
    element: root,
    rect: () => root.getBoundingClientRect(),
    animateReturn: (id, fromClientX, fromClientY) =>
      animateReturn(slotByid, ghost, id, fromClientX, fromClientY),
    setSlotActive,
  };
}

function animateReturn(
  slotByid: Map<string, HTMLElement>,
  ghost: HTMLElement,
  id: string,
  fromClientX: number,
  fromClientY: number
): Promise<void> {
  return new Promise((resolve) => {
    const slot = slotByid.get(id);
    if (!slot) {
      resolve();
      return;
    }
    // Use a one-shot returning ghost so multiple returns can overlap.
    const flier = document.createElement("div");
    flier.className = "drawer-ghost drawer-ghost-flier";
    flier.style.backgroundImage = ghost.style.backgroundImage;
    const startX = fromClientX - 32;
    const startY = fromClientY - 32;
    flier.style.transform = `translate(${startX}px, ${startY}px)`;
    document.body.appendChild(flier);

    const slotRect = slot.getBoundingClientRect();
    const endX = slotRect.left + slotRect.width / 2 - 32;
    const endY = slotRect.top + slotRect.height / 2 - 32;

    // Force a layout flush so the starting transform is committed before
    // we apply the transition + end transform.
    void flier.offsetHeight;
    flier.style.transition = "transform 350ms cubic-bezier(.4,.8,.4,1)";
    flier.style.transform = `translate(${endX}px, ${endY}px)`;
    flier.addEventListener(
      "transitionend",
      () => {
        slot.classList.add("drawer-slot-pulse");
        setTimeout(() => slot.classList.remove("drawer-slot-pulse"), 240);
        flier.remove();
        resolve();
      },
      { once: true }
    );
  });
}

/** Resolve the thumbnail image for a given object id (for the flier). */
export function thumbUrl(
  objects: ReadonlyArray<DrawerObject>,
  id: string
): string {
  return objects.find((o) => o.id === id)?.url ?? "";
}
