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

    this.ctx.putImageData(this.imageData, 0, 0);
  }
}
