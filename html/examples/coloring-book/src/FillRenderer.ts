import { LabelMap } from "./LabelMap";
import { hexToRGB } from "./color";

// Owns the off-screen canvas that holds the per-pixel fill colors. The Phaser
// scene wraps this canvas as a CanvasTexture and displays it under the lines
// PNG. Every redraw is a full pass over the label map; at 512² that's ~262K
// iterations and well under a frame.

export class FillRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;

  constructor(width: number, height: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D context unavailable for fill canvas");
    this.ctx = ctx;
    this.imageData = ctx.createImageData(width, height);
  }

  render(labelMap: LabelMap, fillMap: Map<number, string>): void {
    // Lookup table indexed by region id. Faster than Map.get inside the
    // hot loop and bounded (we use one byte for region id, so 256 slots).
    const colors: Array<readonly [number, number, number] | undefined> = new Array(
      256
    );
    for (const [id, hex] of fillMap) colors[id] = hexToRGB(hex);

    const labels = labelMap.data;
    const out = this.imageData.data;
    const len = labels.length;

    for (let i = 0; i < len; i += 4) {
      const a = labels[i + 3]!;
      if (a === 0) {
        out[i + 3] = 0;
        continue;
      }
      const id = labels[i]!;
      const c = colors[id];
      if (!c) {
        out[i + 3] = 0;
        continue;
      }
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 255;
    }

    // Dilate the painted pixels by 1px to fill the antialiased ring left by
    // the parser's erode pass. Without this, the 1px edge of each region
    // shows the source image's white interior unchanged, producing a white
    // halo around every fill. The outline overlay is multiplied on top, so
    // dilating into the outline pixels is harmless — black × any color = black.
    this.dilateOnce(labelMap.width, labelMap.height);

    this.ctx.putImageData(this.imageData, 0, 0);
  }

  private dilateOnce(width: number, height: number): void {
    const out = this.imageData.data;
    const total = width * height;

    // Snapshot which pixels were filled before dilation; we only spread from
    // those, never from a pixel we just dilated, so the ring stays exactly 1px.
    const filled = new Uint8Array(total);
    for (let p = 0; p < total; p++) {
      if (out[p * 4 + 3]! > 0) filled[p] = 1;
    }

    for (let y = 0; y < height; y++) {
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        const p = rowStart + x;
        if (filled[p]) continue;
        let donor = -1;
        if (x > 0 && filled[p - 1]) donor = p - 1;
        else if (x < width - 1 && filled[p + 1]) donor = p + 1;
        else if (y > 0 && filled[p - width]) donor = p - width;
        else if (y < height - 1 && filled[p + width]) donor = p + width;
        if (donor < 0) continue;
        const o = p * 4;
        const d = donor * 4;
        out[o] = out[d]!;
        out[o + 1] = out[d + 1]!;
        out[o + 2] = out[d + 2]!;
        out[o + 3] = 255;
      }
    }
  }
}
