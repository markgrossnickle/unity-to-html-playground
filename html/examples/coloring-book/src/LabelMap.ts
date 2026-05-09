// Decodes a labels PNG into an off-screen ImageData and exposes:
//   - sample(x, y)   → regionId at pixel (x, y), or 0 for "no region"
//   - data, width, height for downstream renderers
//
// Why label-map and not flood-fill at runtime?
// We compared three approaches in PLAN.md:
//   A. Single-bitmap with runtime flood fill — leaks at antialiased outline
//      edges, fill latency on large regions, complex undo (canvas snapshots).
//   B. Pre-segmented vector regions (SVG) — beautiful but every region must
//      be hand-traced; bad fit for "drop a PNG and it works".
//   C. Hybrid label-map (this) — regions painted offline into a flat-color
//      ID buffer; runtime tap is O(1) and fill is O(W·H) of one redraw, no
//      flood-fill, no AA halo, dead-simple undo (Map<regionId, color>).
//
// We picked C for the playground because correctness and instant feel matter
// more than algorithm theatre — every tap MUST stay inside its region or the
// example reads as broken.

export class LabelMap {
  private constructor(
    private readonly imageData: ImageData,
    public readonly width: number,
    public readonly height: number
  ) {}

  static fromImage(img: HTMLImageElement | HTMLCanvasElement): LabelMap {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D context unavailable for label-map decode");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height);
    return new LabelMap(data, img.width, img.height);
  }

  // Region IDs are encoded into the R channel of the labels PNG; alpha=0
  // marks pixels that aren't part of any region (background outside the
  // artwork, or a stray seam). Authoring is flat-color, no AA, so a single
  // pixel always maps to exactly one region.
  sample(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const idx = (y * this.width + x) * 4;
    const data = this.imageData.data;
    const a = data[idx + 3]!;
    if (a === 0) return 0;
    return data[idx]!;
  }

  get data(): Uint8ClampedArray {
    return this.imageData.data;
  }
}
