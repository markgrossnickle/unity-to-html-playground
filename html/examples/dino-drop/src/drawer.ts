// Bottom drawer of draggable thumbnails. Rendered as plain DOM (not in the
// Phaser canvas) — easier to scroll horizontally on mobile and the drag
// ghost can use ordinary CSS transforms.
//
// Each slot is a single-instance source: dragging vertically out of a slot
// creates a physics body in the scene; the slot then dims out and stays
// non-interactable until the live body returns (via tail slam or off-screen
// exit). Horizontal pointer motion is interpreted as a drawer scroll and
// does NOT spawn an object.

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
  /** Dim (or restore) a slot. Dimmed slots are non-interactable. */
  setSlotActive(id: string, active: boolean): void;
}

// Distance threshold (px) before we commit to either scrolling or dragging.
// Picked to match the typical browser drag-vs-tap slop on touch screens.
const INTENT_THRESHOLD = 8;

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
  const urlById = new Map<string, string>();

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
    urlById.set(obj.id, obj.url);

    attachPointer(slot, obj, obj.url);
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

      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      let dragging = false;
      let aborted = false;

      const cleanup = () => {
        slot.removeEventListener("pointermove", onMove);
        slot.removeEventListener("pointerup", onUp);
        slot.removeEventListener("pointercancel", onCancel);
      };

      const beginDrag = (clientX: number, clientY: number) => {
        dragging = true;
        try { slot.setPointerCapture(pointerId); } catch { /* ignore */ }
        ghost.style.backgroundImage = `url(${imgUrl})`;
        ghost.style.display = "block";
        moveGhost(clientX, clientY);
      };

      const onMove = (ev: PointerEvent) => {
        if (aborted) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);

        if (!dragging) {
          // Resolve intent at first motion exceeding the threshold.
          // Horizontal dominates → user is scrolling the drawer; bail.
          // Vertical dominates → start the drag.
          if (adx > INTENT_THRESHOLD && adx > ady) {
            aborted = true;
            cleanup();
            return;
          }
          if (ady > INTENT_THRESHOLD) {
            beginDrag(ev.clientX, ev.clientY);
          }
          return;
        }
        moveGhost(ev.clientX, ev.clientY);
      };

      const onUp = (ev: PointerEvent) => {
        cleanup();
        try { slot.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
        if (!dragging) return; // tap or sub-threshold motion → no spawn
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

      const onCancel = (ev: PointerEvent) => {
        cleanup();
        try { slot.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
        if (dragging) ghost.style.display = "none";
      };

      slot.addEventListener("pointermove", onMove);
      slot.addEventListener("pointerup", onUp);
      slot.addEventListener("pointercancel", onCancel);
    });
  }

  function moveGhost(x: number, y: number) {
    ghost.style.transform = `translate(${x - 32}px, ${y - 32}px)`;
  }

  function setSlotActive(id: string, active: boolean) {
    const slot = slotByid.get(id);
    if (!slot) return;
    slot.classList.toggle("drawer-slot-dimmed", active);
    if (!active) {
      slot.classList.remove("drawer-slot-shake");
    }
  }

  return {
    element: root,
    rect: () => root.getBoundingClientRect(),
    animateReturn: (id, fromClientX, fromClientY) =>
      animateReturn(slotByid, urlById, id, fromClientX, fromClientY),
    setSlotActive,
  };
}

function animateReturn(
  slotByid: Map<string, HTMLElement>,
  urlById: Map<string, string>,
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
    // One-shot flier so multiple returns can overlap without sharing a node.
    const flier = document.createElement("div");
    flier.className = "drawer-ghost drawer-ghost-flier";
    const url = urlById.get(id);
    if (url) flier.style.backgroundImage = `url(${url})`;
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
