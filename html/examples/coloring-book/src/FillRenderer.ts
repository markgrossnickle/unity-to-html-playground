import { LabelMap } from "./LabelMap";
import { hexToRGB } from "./color";

// Owns the off-screen canvas that holds every painted pixel — bucket fills
// AND pencil/brush/eraser strokes. The Phaser scene wraps this canvas as a
// CanvasTexture and displays it under the lines PNG (multiply blend in the
// imported-picture case). After construction the canvas is the source of
// truth: the scene paints incrementally and uses ImageData snapshots to undo.

export class FillRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D context unavailable for fill canvas");
    this.ctx = ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  snapshot(): ImageData {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  restore(snap: ImageData): void {
    this.ctx.putImageData(snap, 0, 0);
  }

  // Paint a single label-map region in `hex`, on top of whatever is already
  // on the canvas. Existing pixels (other fills, strokes) are preserved
  // outside the painted region, and the parser's 1px erode ring is filled in
  // by a one-pass dilation seeded from JUST these pixels — so existing
  // strokes don't grow on each fill.
  paintRegion(labelMap: LabelMap, regionId: number, hex: string): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const img = this.ctx.getImageData(0, 0, w, h);
    const out = img.data;
    const labels = labelMap.data;
    const len = labels.length;
    const [r, g, b] = hexToRGB(hex);

    const justPainted = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < len; i += 4, p++) {
      if (labels[i + 3]! === 0) continue;
      if (labels[i]! !== regionId) continue;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      justPainted[p] = 1;
    }

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const p = row + x;
        if (justPainted[p]) continue;
        const o4 = p * 4;
        if (out[o4 + 3]! !== 0) continue;
        let donor = -1;
        if (x > 0 && justPainted[p - 1]) donor = p - 1;
        else if (x < w - 1 && justPainted[p + 1]) donor = p + 1;
        else if (y > 0 && justPainted[p - w]) donor = p - w;
        else if (y < h - 1 && justPainted[p + w]) donor = p + w;
        if (donor < 0) continue;
        const d4 = donor * 4;
        out[o4] = out[d4]!;
        out[o4 + 1] = out[d4 + 1]!;
        out[o4 + 2] = out[d4 + 2]!;
        out[o4 + 3] = 255;
      }
    }

    this.ctx.putImageData(img, 0, 0);
  }

  // Stroke API — pencil/brush/eraser. The scene calls strokeBegin on
  // pointerdown, strokeTo on each pointermove, strokeEnd on pointerup. We
  // re-anchor the path at every move so each segment costs O(1) to render
  // instead of O(strokes-so-far); the round line cap on consecutive
  // segments visually merges them into a continuous stroke.
  strokeBegin(opts: {
    x: number;
    y: number;
    color: string;
    width: number;
    erase: boolean;
  }): void {
    const c = this.ctx;
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = opts.width;
    if (opts.erase) {
      c.globalCompositeOperation = "destination-out";
      c.strokeStyle = "rgba(0,0,0,1)";
    } else {
      c.globalCompositeOperation = "source-over";
      c.strokeStyle = opts.color;
    }
    c.beginPath();
    c.moveTo(opts.x, opts.y);
    // Degenerate line so a tap-without-drag still renders a round dot the
    // size of the stroke.
    c.lineTo(opts.x, opts.y);
    c.stroke();
    c.beginPath();
    c.moveTo(opts.x, opts.y);
  }

  strokeTo(x: number, y: number): void {
    const c = this.ctx;
    c.lineTo(x, y);
    c.stroke();
    c.beginPath();
    c.moveTo(x, y);
  }

  strokeEnd(): void {
    this.ctx.restore();
  }
}
