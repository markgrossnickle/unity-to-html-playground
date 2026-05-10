import Phaser from "phaser";

import {
  loadStickers,
  saveStickers,
  clearStickers,
  newUid,
  type PlacedSticker,
} from "./persistence";
import type { StickerDef, StickerDrawerHandle } from "./drawer";

import sunUrl from "../assets/sun.png?url";
import rainbowUrl from "../assets/rainbow.png?url";
import heartUrl from "../assets/heart.png?url";
import starUrl from "../assets/star.png?url";
import catUrl from "../assets/cat.png?url";
import dogUrl from "../assets/dog.png?url";
import bowUrl from "../assets/bow.png?url";
import iceCreamUrl from "../assets/ice-cream.png?url";
import balloonUrl from "../assets/balloon.png?url";
import flowerUrl from "../assets/flower.png?url";
import cloverUrl from "../assets/clover.png?url";
import butterflyUrl from "../assets/butterfly.png?url";

export const STICKER_DEFS: ReadonlyArray<StickerDef> = [
  { id: "sun", label: "Sun", url: sunUrl },
  { id: "rainbow", label: "Rainbow", url: rainbowUrl },
  { id: "heart", label: "Heart", url: heartUrl },
  { id: "star", label: "Star", url: starUrl },
  { id: "cat", label: "Cat", url: catUrl },
  { id: "dog", label: "Dog", url: dogUrl },
  { id: "bow", label: "Bow", url: bowUrl },
  { id: "ice-cream", label: "Ice cream", url: iceCreamUrl },
  { id: "balloon", label: "Balloon", url: balloonUrl },
  { id: "flower", label: "Flower", url: flowerUrl },
  { id: "clover", label: "Clover", url: cloverUrl },
  { id: "butterfly", label: "Butterfly", url: butterflyUrl },
];

const TEX_PREFIX = "sticker-";
const NATIVE_SCALE = 0.9; // 128px native → 115px placed
const MIN_SCALE = 0.4;
const MAX_SCALE = 3.5;
const LONG_PRESS_MS = 500;

type StickerImage = Phaser.GameObjects.Image & {
  __data?: PlacedSticker;
};

export class StickerScene extends Phaser.Scene {
  private drawer!: StickerDrawerHandle;
  private stickers: PlacedSticker[] = [];
  private images = new Map<string, StickerImage>();
  private nextZ = 1;

  // Active gesture state. We manage drag/rotate/scale ourselves so that we
  // can support multi-touch (rotate + pinch) without fighting Phaser's
  // single-pointer drag plugin.
  private activeDrag: {
    image: StickerImage;
    pointerId: number;
    grabDx: number;
    grabDy: number;
    moved: boolean;
    longPressTimer: number | null;
  } | null = null;

  // Two-finger gesture tracker (rotation + pinch). Independent of activeDrag
  // so a one-finger drag upgrades into a two-finger gesture cleanly when a
  // second touch arrives.
  private activeMulti: {
    image: StickerImage;
    p1Id: number;
    p2Id: number;
    startAngle: number;
    startDist: number;
    startRotation: number;
    startScale: number;
  } | null = null;

  // Pending spawns from the DOM drawer.
  private pendingSpawn: { id: string; clientX: number; clientY: number } | null = null;

  constructor() {
    super("StickerScene");
  }

  preload(): void {
    for (const def of STICKER_DEFS) {
      this.load.image(`${TEX_PREFIX}${def.id}`, def.url);
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#fff8e1");
    this.drawDots();

    this.stickers = loadStickers();
    for (const s of this.stickers) this.spawnImage(s);
    this.nextZ =
      this.stickers.reduce((m, s) => Math.max(m, s.z), 0) + 1;

    this.scale.on("resize", this.onResize, this);

    // Pointer plumbing.
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => this.onPointerUp(p));

    // Right-click → delete via context menu prompt.
    this.input.mouse?.disableContextMenu();

    // Wheel → scale the sticker under the pointer (desktop ergonomic).
    this.input.on(
      "wheel",
      (
        _p: Phaser.Input.Pointer,
        objects: Phaser.GameObjects.GameObject[],
        _dx: number,
        dy: number
      ) => {
        const top = objects[0] as StickerImage | undefined;
        if (!top || !top.__data) return;
        const factor = Math.exp(-dy * 0.0015);
        this.applyScale(top, top.__data.scale * factor);
      }
    );

    this.events.on("update", this.flushPendingSpawn, this);
  }

  attachDrawer(drawer: StickerDrawerHandle): void {
    this.drawer = drawer;
  }

  spawnAt(id: string, clientX: number, clientY: number): void {
    this.pendingSpawn = { id, clientX, clientY };
  }

  clearAll(): void {
    for (const img of this.images.values()) img.destroy();
    this.images.clear();
    this.stickers = [];
    clearStickers();
  }

  // ---- background dots --------------------------------------------------

  private dotsLayer?: Phaser.GameObjects.Graphics;

  private drawDots(): void {
    const cam = this.cameras.main;
    if (!this.dotsLayer) {
      this.dotsLayer = this.add.graphics().setDepth(-1000);
    }
    const g = this.dotsLayer;
    g.clear();
    g.fillStyle(0xe8d8a0, 1);
    const step = 32;
    for (let y = 16; y < cam.height; y += step) {
      for (let x = 16; x < cam.width; x += step) {
        g.fillCircle(x, y, 1.6);
      }
    }
  }

  private onResize(): void {
    this.drawDots();
  }

  // ---- spawn ------------------------------------------------------------

  private flushPendingSpawn(): void {
    if (!this.pendingSpawn) return;
    const { id, clientX, clientY } = this.pendingSpawn;
    this.pendingSpawn = null;

    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;

    const placed: PlacedSticker = {
      uid: newUid(),
      id,
      x,
      y,
      rotation: 0,
      scale: NATIVE_SCALE,
      z: this.nextZ++,
    };
    this.stickers.push(placed);
    this.spawnImage(placed);
    this.persist();
  }

  private spawnImage(s: PlacedSticker): void {
    const img = this.add.image(s.x, s.y, `${TEX_PREFIX}${s.id}`) as StickerImage;
    img.setScale(s.scale);
    img.setRotation(s.rotation);
    img.setDepth(s.z);
    img.setInteractive({ useHandCursor: true, draggable: false });
    img.__data = s;

    img.on("pointerdown", (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.handleStickerPointerDown(img, p);
    });

    this.images.set(s.uid, img);
  }

  // ---- pointer / gesture handling ---------------------------------------

  private handleStickerPointerDown(image: StickerImage, p: Phaser.Input.Pointer): void {
    if (!image.__data) return;
    // Right-click → confirm delete.
    if (p.rightButtonDown()) {
      this.confirmDelete(image);
      return;
    }
    // Bring to top of stack.
    image.__data.z = this.nextZ++;
    image.setDepth(image.__data.z);

    // If a drag is already happening on a different image, cancel it
    // (could happen if a second pointer hits a different sticker).
    if (this.activeDrag && this.activeDrag.image !== image) {
      this.cancelDrag();
    }

    if (this.activeDrag && this.activeDrag.image === image) {
      // Second finger → upgrade to multi-touch rotate/scale.
      this.startMultiGesture(image, this.activeDrag.pointerId, p.id);
      return;
    }

    const grabDx = p.worldX - image.__data.x;
    const grabDy = p.worldY - image.__data.y;

    const longPressTimer = window.setTimeout(() => {
      // Long-press → confirm delete (mobile path).
      if (this.activeDrag && this.activeDrag.image === image && !this.activeDrag.moved) {
        this.cancelDrag();
        this.confirmDelete(image);
      }
    }, LONG_PRESS_MS);

    this.activeDrag = {
      image,
      pointerId: p.id,
      grabDx,
      grabDy,
      moved: false,
      longPressTimer,
    };
  }

  private startMultiGesture(image: StickerImage, p1Id: number, p2Id: number): void {
    if (!image.__data) return;
    // Cancel the single-touch drag in favor of the multi gesture.
    if (this.activeDrag) {
      if (this.activeDrag.longPressTimer) {
        window.clearTimeout(this.activeDrag.longPressTimer);
      }
      this.activeDrag = null;
    }
    const p1 = this.input.manager.pointers.find((q) => q.id === p1Id);
    const p2 = this.input.manager.pointers.find((q) => q.id === p2Id);
    if (!p1 || !p2) return;
    const dx = p2.worldX - p1.worldX;
    const dy = p2.worldY - p1.worldY;
    this.activeMulti = {
      image,
      p1Id,
      p2Id,
      startAngle: Math.atan2(dy, dx),
      startDist: Math.hypot(dx, dy),
      startRotation: image.__data.rotation,
      startScale: image.__data.scale,
    };
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.activeMulti) {
      const m = this.activeMulti;
      const p1 = this.input.manager.pointers.find((q) => q.id === m.p1Id);
      const p2 = this.input.manager.pointers.find((q) => q.id === m.p2Id);
      if (!p1 || !p2) return;
      const dx = p2.worldX - p1.worldX;
      const dy = p2.worldY - p1.worldY;
      const angle = Math.atan2(dy, dx);
      const dist = Math.hypot(dx, dy);
      const rotation = m.startRotation + (angle - m.startAngle);
      const scale = Phaser.Math.Clamp(
        m.startScale * (dist / Math.max(20, m.startDist)),
        MIN_SCALE,
        MAX_SCALE
      );
      this.applyTransform(m.image, undefined, undefined, rotation, scale);
      return;
    }

    if (!this.activeDrag) return;
    if (p.id !== this.activeDrag.pointerId) return;
    const d = this.activeDrag;
    const img = d.image;
    if (!img.__data) return;
    const newX = p.worldX - d.grabDx;
    const newY = p.worldY - d.grabDy;

    if (!d.moved) {
      const dx = p.worldX - (img.__data.x + d.grabDx);
      const dy = p.worldY - (img.__data.y + d.grabDy);
      if (Math.hypot(dx, dy) > 4) {
        d.moved = true;
        if (d.longPressTimer) {
          window.clearTimeout(d.longPressTimer);
          d.longPressTimer = null;
        }
      }
    }

    let rotation: number | undefined;
    if (p.event && (p.event as MouseEvent).shiftKey && this.input.activePointer === p) {
      // Shift + drag rotates instead of moving (desktop path).
      const cx = img.__data.x;
      const cy = img.__data.y;
      const baseAngle = Math.atan2(d.grabDy, d.grabDx);
      const curAngle = Math.atan2(p.worldY - cy, p.worldX - cx);
      rotation = curAngle - baseAngle;
      this.applyTransform(img, cx, cy, rotation, undefined);
      return;
    }

    this.applyTransform(img, newX, newY, undefined, undefined);
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (this.activeMulti) {
      if (p.id === this.activeMulti.p1Id || p.id === this.activeMulti.p2Id) {
        this.activeMulti = null;
      }
      return;
    }
    if (!this.activeDrag) return;
    if (p.id !== this.activeDrag.pointerId) return;
    const drag = this.activeDrag;

    if (drag.longPressTimer) {
      window.clearTimeout(drag.longPressTimer);
      drag.longPressTimer = null;
    }

    // If released over the drawer rect, delete. Use Phaser's screen-space
    // pointer position (already in CSS pixels relative to the canvas) so we
    // don't have to disambiguate MouseEvent vs TouchEvent off `p.event`.
    if (drag.moved && this.drawer) {
      const rect = this.drawer.rect();
      const canvas = this.game.canvas;
      const cRect = canvas.getBoundingClientRect();
      const clientX = cRect.left + p.x;
      const clientY = cRect.top + p.y;
      if (
        clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom
      ) {
        this.deleteSticker(drag.image);
        this.activeDrag = null;
        return;
      }
    }

    this.activeDrag = null;
    this.persist();
  }

  private cancelDrag(): void {
    if (this.activeDrag?.longPressTimer) {
      window.clearTimeout(this.activeDrag.longPressTimer);
    }
    this.activeDrag = null;
  }

  // ---- transform helpers -----------------------------------------------

  private applyTransform(
    img: StickerImage,
    x: number | undefined,
    y: number | undefined,
    rotation: number | undefined,
    scale: number | undefined
  ): void {
    if (!img.__data) return;
    if (x !== undefined) {
      img.__data.x = x;
      img.x = x;
    }
    if (y !== undefined) {
      img.__data.y = y;
      img.y = y;
    }
    if (rotation !== undefined) {
      img.__data.rotation = rotation;
      img.setRotation(rotation);
    }
    if (scale !== undefined) {
      const clamped = Phaser.Math.Clamp(scale, MIN_SCALE, MAX_SCALE);
      img.__data.scale = clamped;
      img.setScale(clamped);
    }
  }

  private applyScale(img: StickerImage, scale: number): void {
    this.applyTransform(img, undefined, undefined, undefined, scale);
    this.persist();
  }

  // ---- delete -----------------------------------------------------------

  private confirmDelete(img: StickerImage): void {
    if (!img.__data) return;
    if (window.confirm("Delete this sticker?")) {
      this.deleteSticker(img);
    }
  }

  private deleteSticker(img: StickerImage): void {
    if (!img.__data) return;
    const uid = img.__data.uid;
    img.destroy();
    this.images.delete(uid);
    this.stickers = this.stickers.filter((s) => s.uid !== uid);
    this.persist();
  }

  // ---- persist ----------------------------------------------------------

  private persist(): void {
    saveStickers(this.stickers);
  }
}
