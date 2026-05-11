import Phaser from "phaser";

import { events, type Tool } from "./events";
import { FillRenderer } from "./FillRenderer";
import { LabelMap } from "./LabelMap";
import { findPicture, PICTURES, type Picture, getAllPictures } from "./pictures";
import { exportPng, saveOrShare } from "./save";
import {
  addRecentColor,
  popSnapshot,
  pushSnapshot,
  resetForPicture,
  state,
} from "./state";

const FILL_TEXTURE_KEY = "coloring-book:fill";

type FreehandTool = Exclude<Tool, "bucket">;

interface FreehandConfig {
  width: number; // px in picture-local coordinates
  erase: boolean;
}

const FREEHAND: Record<FreehandTool, FreehandConfig> = {
  pencil: { width: 3, erase: false },
  brush: { width: 16, erase: false },
  eraser: { width: 20, erase: true },
};

// Single Phaser scene that owns:
//   - the underlying fill canvas (CanvasTexture) shared by all four tools
//   - the lines image drawn on top
//   - tap-to-fill + drag-to-draw input
//   - layout (centered + letterboxed inside the available game area)
export class ColoringScene extends Phaser.Scene {
  private container!: Phaser.GameObjects.Container;
  private fillImage: Phaser.GameObjects.Image | null = null;
  private linesImage: Phaser.GameObjects.Image | null = null;
  private labelMap: LabelMap | null = null;
  private fillRenderer: FillRenderer | null = null;
  private currentPicture: Picture | null = null;

  // Non-null between pointerdown and pointerup of a freehand stroke. Pointer
  // ID pins the stroke to the original finger so a second touch doesn't
  // hijack it mid-drag.
  private activeStroke: {
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null = null;

  constructor() {
    super("ColoringScene");
  }

  preload(): void {
    for (const p of PICTURES) {
      this.load.image(`${p.slug}-lines`, p.linesUrl);
      this.load.image(`${p.slug}-labels`, p.labelsUrl);
    }
  }

  create(): void {
    this.container = this.add.container(0, 0);
    this.scale.on("resize", () => this.layout());

    // Phaser's Scale.RESIZE watches the parent element, but on Android Chrome
    // an orientation change overlaps the URL-bar transition and the parent
    // observer can miss the new size until the user interacts again. Listen
    // at window level too and force a refresh + relayout. rAF defers until
    // after the browser settles the new viewport metrics.
    const onWindowResize = () => {
      requestAnimationFrame(() => {
        this.scale.refresh();
        this.layout();
      });
    };
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("orientationchange", onWindowResize);

    events.on("picture:select", (slug) => this.loadPicture(slug));
    events.on("picture:removed", (slug) => this.onPictureRemoved(slug));
    events.on("undo", () => this.undo());
    events.on("clear", () => this.clearPaint());
    events.on("save", () => {
      void this.save();
    });

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) =>
      this.onPointerDown(p)
    );
    this.input.on("pointermove", (p: Phaser.Input.Pointer) =>
      this.onPointerMove(p)
    );
    this.input.on("pointerup", (p: Phaser.Input.Pointer) =>
      this.onPointerUp(p)
    );

    this.loadPicture(PICTURES[0]!.slug);
  }

  private loadPicture(slug: string): void {
    const picture = findPicture(slug);
    if (!picture) return;

    const linesKey = `${slug}-lines`;
    const labelsKey = `${slug}-labels`;
    if (this.textures.exists(linesKey) && this.textures.exists(labelsKey)) {
      this.applyPicture(picture);
      return;
    }

    // Imported pictures aren't in the preload manifest — pull them in via the
    // loader on demand. Phaser accepts data: URLs as image sources directly.
    this.load.image(linesKey, picture.linesUrl);
    this.load.image(labelsKey, picture.labelsUrl);
    this.load.once("complete", () => this.applyPicture(picture));
    this.load.once("loaderror", () => {
      window.alert(`Could not load "${picture.title}"`);
    });
    this.load.start();
  }

  private applyPicture(picture: Picture): void {
    this.currentPicture = picture;
    resetForPicture(picture.slug);
    this.activeStroke = null;

    // Clean up the previous picture's display objects + cached fill texture.
    this.container.removeAll(true);
    if (this.textures.exists(FILL_TEXTURE_KEY)) {
      this.textures.remove(FILL_TEXTURE_KEY);
    }

    const labelsSrc = this.textures
      .get(`${picture.slug}-labels`)
      .getSourceImage() as HTMLImageElement;
    this.labelMap = LabelMap.fromImage(labelsSrc);

    this.fillRenderer = new FillRenderer(this.labelMap.width, this.labelMap.height);
    this.textures.addCanvas(FILL_TEXTURE_KEY, this.fillRenderer.canvas);

    this.fillImage = this.add.image(0, 0, FILL_TEXTURE_KEY).setOrigin(0, 0);
    this.linesImage = this.add
      .image(0, 0, `${picture.slug}-lines`)
      .setOrigin(0, 0);

    // Imported pictures are the user's source image, untouched — they have a
    // white interior, not a transparent one. Multiply blending lets the fill
    // color show through where the source is white while preserving the
    // outline antialiasing exactly. Built-in pictures already have transparent
    // interiors so they don't need (or want) the blend change.
    if (picture.imported) {
      this.linesImage.setBlendMode(Phaser.BlendModes.MULTIPLY);
    }

    this.container.add([this.fillImage, this.linesImage]);

    this.layout();
    this.refreshTexture();
  }

  // Letterbox: fit the picture inside the viewport with a margin, preserving
  // aspect ratio. Single Container holds both layers so they scale together.
  private layout(): void {
    if (!this.currentPicture || !this.labelMap) return;
    const cam = this.cameras.main;
    const margin = 24;
    const availW = Math.max(1, cam.width - margin * 2);
    const availH = Math.max(1, cam.height - margin * 2);
    const scale = Math.min(
      availW / this.labelMap.width,
      availH / this.labelMap.height
    );
    this.container.setScale(scale);
    this.container.setPosition(
      (cam.width - this.labelMap.width * scale) / 2,
      (cam.height - this.labelMap.height * scale) / 2
    );
  }

  private toLocal(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const local = this.container
      .getLocalTransformMatrix()
      .applyInverse(pointer.x, pointer.y);
    return { x: local.x, y: local.y };
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.labelMap || !this.fillRenderer) return;
    const tool = state.selectedTool;
    if (tool === "bucket") {
      this.doBucketFill(pointer);
      return;
    }
    this.beginStroke(pointer, tool);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const stroke = this.activeStroke;
    if (!stroke || !this.fillRenderer) return;
    if (pointer.pointerId !== stroke.pointerId) return;
    const { x, y } = this.toLocal(pointer);
    // Sub-pixel jitter doesn't add visible detail and hammers getImageData
    // for nothing — gate on a 0.5px move.
    const dx = x - stroke.lastX;
    const dy = y - stroke.lastY;
    if (dx * dx + dy * dy < 0.25) return;
    this.fillRenderer.strokeTo(x, y);
    stroke.lastX = x;
    stroke.lastY = y;
    this.refreshTexture();
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const stroke = this.activeStroke;
    if (!stroke || !this.fillRenderer) return;
    if (pointer.pointerId !== stroke.pointerId) return;
    this.fillRenderer.strokeEnd();
    this.activeStroke = null;
    this.refreshTexture();
  }

  private doBucketFill(pointer: Phaser.Input.Pointer): void {
    if (!this.labelMap || !this.fillRenderer) return;
    const { x, y } = this.toLocal(pointer);
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const regionId = this.labelMap.sample(xi, yi);
    if (regionId === 0) return;
    pushSnapshot(this.fillRenderer.snapshot());
    this.fillRenderer.paintRegion(this.labelMap, regionId, state.selectedColor);
    addRecentColor(state.selectedColor);
    this.refreshTexture();
  }

  private beginStroke(pointer: Phaser.Input.Pointer, tool: FreehandTool): void {
    if (!this.labelMap || !this.fillRenderer) return;
    if (this.activeStroke) return; // ignore additional touches mid-stroke
    const { x, y } = this.toLocal(pointer);
    if (
      x < 0 ||
      y < 0 ||
      x >= this.labelMap.width ||
      y >= this.labelMap.height
    ) {
      return;
    }
    const cfg = FREEHAND[tool];
    pushSnapshot(this.fillRenderer.snapshot());
    this.fillRenderer.strokeBegin({
      x,
      y,
      color: state.selectedColor,
      width: cfg.width,
      erase: cfg.erase,
    });
    if (!cfg.erase) addRecentColor(state.selectedColor);
    this.activeStroke = { pointerId: pointer.pointerId, lastX: x, lastY: y };
    this.refreshTexture();
  }

  private onPictureRemoved(slug: string): void {
    const linesKey = `${slug}-lines`;
    const labelsKey = `${slug}-labels`;
    if (this.textures.exists(linesKey)) this.textures.remove(linesKey);
    if (this.textures.exists(labelsKey)) this.textures.remove(labelsKey);
    if (this.currentPicture?.slug === slug) {
      // Fall back to the first available picture (always a built-in).
      const fallback = getAllPictures()[0];
      if (fallback) this.loadPicture(fallback.slug);
    }
  }

  private undo(): void {
    if (!this.fillRenderer) return;
    const snap = popSnapshot();
    if (!snap) return;
    // If undo lands while a stroke is in flight (shouldn't happen — undo is
    // a topbar click — but be safe), tear it down so the next move doesn't
    // resume on top of the restored canvas.
    if (this.activeStroke) {
      this.fillRenderer.strokeEnd();
      this.activeStroke = null;
    }
    this.fillRenderer.restore(snap);
    this.refreshTexture();
  }

  private clearPaint(): void {
    if (!this.fillRenderer) return;
    if (state.history.length === 0 && !this.activeStroke) return;
    if (this.activeStroke) {
      this.fillRenderer.strokeEnd();
      this.activeStroke = null;
    }
    pushSnapshot(this.fillRenderer.snapshot());
    this.fillRenderer.clear();
    this.refreshTexture();
  }

  private async save(): Promise<void> {
    if (!this.currentPicture || !this.fillRenderer || !this.labelMap) return;
    const linesSrc = this.textures
      .get(`${this.currentPicture.slug}-lines`)
      .getSourceImage() as HTMLImageElement;
    const blob = await exportPng({
      slug: this.currentPicture.slug,
      width: this.labelMap.width,
      height: this.labelMap.height,
      fillCanvas: this.fillRenderer.canvas,
      linesImage: linesSrc,
    });
    await saveOrShare(this.currentPicture.slug, blob);
  }

  private refreshTexture(): void {
    const tex = this.textures.get(FILL_TEXTURE_KEY) as
      | Phaser.Textures.CanvasTexture
      | undefined;
    if (tex) tex.refresh();
  }
}
