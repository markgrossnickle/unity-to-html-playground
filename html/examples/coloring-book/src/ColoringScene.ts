import Phaser from "phaser";

import { events } from "./events";
import { FillRenderer } from "./FillRenderer";
import { LabelMap } from "./LabelMap";
import { findPicture, PICTURES, type Picture } from "./pictures";
import {
  addRecentColor,
  popFill,
  pushFill,
  resetForPicture,
  state,
} from "./state";

const FILL_TEXTURE_KEY = "coloring-book:fill";

// Single Phaser scene that owns:
//   - the underlying fill canvas (CanvasTexture)
//   - the lines image drawn on top
//   - tap-to-fill input
//   - layout (centered + letterboxed inside the available game area)
export class ColoringScene extends Phaser.Scene {
  private container!: Phaser.GameObjects.Container;
  private fillImage: Phaser.GameObjects.Image | null = null;
  private linesImage: Phaser.GameObjects.Image | null = null;
  private labelMap: LabelMap | null = null;
  private fillRenderer: FillRenderer | null = null;
  private currentPicture: Picture | null = null;

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

    events.on("picture:select", (slug) => this.loadPicture(slug));
    events.on("undo", () => this.undo());
    events.on("clear", () => this.clearPaint());

    // pointerdown — not pointerup or drag — so a real "tap" registers and a
    // panning gesture (when we add zoom in M3) won't accidentally fill.
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) =>
      this.onTap(pointer)
    );

    this.loadPicture(PICTURES[0]!.slug);
  }

  private loadPicture(slug: string): void {
    const picture = findPicture(slug);
    if (!picture) return;
    this.currentPicture = picture;
    resetForPicture(slug);

    // Clean up the previous picture's display objects + cached fill texture.
    this.container.removeAll(true);
    if (this.textures.exists(FILL_TEXTURE_KEY)) {
      this.textures.remove(FILL_TEXTURE_KEY);
    }

    const labelsSrc = this.textures
      .get(`${slug}-labels`)
      .getSourceImage() as HTMLImageElement;
    this.labelMap = LabelMap.fromImage(labelsSrc);

    this.fillRenderer = new FillRenderer(this.labelMap.width, this.labelMap.height);
    this.textures.addCanvas(FILL_TEXTURE_KEY, this.fillRenderer.canvas);

    this.fillImage = this.add
      .image(0, 0, FILL_TEXTURE_KEY)
      .setOrigin(0, 0);
    this.linesImage = this.add
      .image(0, 0, `${slug}-lines`)
      .setOrigin(0, 0);

    this.container.add([this.fillImage, this.linesImage]);

    this.layout();
    this.redraw();
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

  private onTap(pointer: Phaser.Input.Pointer): void {
    if (!this.labelMap || !this.fillRenderer) return;

    // Container space → image-local pixel coordinates.
    const local = this.container.getLocalTransformMatrix().applyInverse(pointer.x, pointer.y);
    const x = Math.floor(local.x);
    const y = Math.floor(local.y);

    const regionId = this.labelMap.sample(x, y);
    if (regionId === 0) return;

    const previous = state.fillMap.get(regionId);
    const next = state.selectedColor;
    if (previous === next) return; // no-op tap on already-this-color region

    pushFill({ regionId, from: previous, to: next });
    state.fillMap.set(regionId, next);
    addRecentColor(next);
    this.redraw();
  }

  private undo(): void {
    const cmd = popFill();
    if (!cmd) return;
    if (cmd.from === undefined) state.fillMap.delete(cmd.regionId);
    else state.fillMap.set(cmd.regionId, cmd.from);
    this.redraw();
  }

  private clearPaint(): void {
    if (state.fillMap.size === 0) return;
    state.fillMap = new Map();
    state.history = [];
    this.redraw();
  }

  private redraw(): void {
    if (!this.labelMap || !this.fillRenderer) return;
    this.fillRenderer.render(this.labelMap, state.fillMap);
    const tex = this.textures.get(FILL_TEXTURE_KEY) as Phaser.Textures.CanvasTexture;
    tex.refresh();
  }
}
