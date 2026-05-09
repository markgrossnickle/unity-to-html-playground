import Phaser from "phaser";

import { debugFill, debugRedraw, debugResize, debugTap } from "./debug";
import { events } from "./events";
import { FillRenderer } from "./FillRenderer";
import { LabelMap } from "./LabelMap";
import { findPicture, PICTURES, type Picture, getAllPictures } from "./pictures";
import { exportPng, saveOrShare } from "./save";
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
    this.scale.on("resize", () => {
      debugResize(this.cameras.main.width, this.cameras.main.height, "scale");
      this.layout();
    });

    // Phaser's Scale.RESIZE watches the parent element, but on Android Chrome
    // an orientation change overlaps the URL-bar transition and the parent
    // observer can miss the new size until the user interacts again. Listen
    // at window level too and force a refresh + relayout. rAF defers until
    // after the browser settles the new viewport metrics.
    const onWindowResize = (src: string) => () => {
      requestAnimationFrame(() => {
        this.scale.refresh();
        this.layout();
        debugResize(this.cameras.main.width, this.cameras.main.height, src);
      });
    };
    window.addEventListener("resize", onWindowResize("win"));
    window.addEventListener("orientationchange", onWindowResize("orient"));

    events.on("picture:select", (slug) => this.loadPicture(slug));
    events.on("picture:removed", (slug) => this.onPictureRemoved(slug));
    events.on("undo", () => this.undo());
    events.on("clear", () => this.clearPaint());
    events.on("save", () => {
      void this.save();
    });

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
    debugTap(x, y, regionId);
    if (regionId === 0) {
      debugFill(0, state.selectedColor, false);
      return;
    }

    const previous = state.fillMap.get(regionId);
    const next = state.selectedColor;
    if (previous === next) {
      // no-op tap on already-this-color region
      debugFill(regionId, next, false);
      return;
    }

    pushFill({ regionId, from: previous, to: next });
    state.fillMap.set(regionId, next);
    addRecentColor(next);
    this.redraw();
    debugFill(regionId, next, true);
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

  private redraw(): void {
    if (!this.labelMap || !this.fillRenderer) return;
    this.fillRenderer.render(this.labelMap, state.fillMap);
    const tex = this.textures.get(FILL_TEXTURE_KEY) as Phaser.Textures.CanvasTexture;
    tex.refresh();
    debugRedraw(state.fillMap.size);
  }
}
