// Composites the current fill canvas + lines overlay into a single PNG and
// either invokes the Web Share sheet (mobile, share-files capable) or triggers
// an anchor-download. Source-resolution output: we don't downscale to the
// viewport — the saved PNG is at the picture's natural pixel size.
//
// Background: we paint white into the export. Uncolored regions become white
// rather than transparent so the saved image renders well in environments
// that don't honor PNG alpha (Messages previews, Twitter, TikTok upload).

export interface ExportInputs {
  slug: string;
  width: number;
  height: number;
  fillCanvas: HTMLCanvasElement;
  linesImage: HTMLImageElement | HTMLCanvasElement;
}

export async function exportPng(inputs: ExportInputs): Promise<Blob> {
  const { width, height, fillCanvas, linesImage } = inputs;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable for export canvas");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(fillCanvas, 0, 0, width, height);
  ctx.drawImage(linesImage, 0, 0, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("toBlob returned null"));
    }, "image/png");
  });
}

export async function saveOrShare(slug: string, blob: Blob): Promise<void> {
  const ts = timestamp();
  const filename = `${slug}-${ts}.png`;
  const file = new File([blob], filename, { type: "image/png" });

  // Web Share Level 2 with files. Android Chrome and iOS Safari 16+ both
  // support this; everywhere else (desktop Safari/Firefox, older browsers)
  // we feature-detect false and fall through to download.
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "Coloring Book" });
      return;
    } catch (err) {
      // AbortError = user dismissed the share sheet — don't fall through to
      // a download in that case (annoying double-prompt). Other errors fall
      // back so a genuine share failure still gets the user their file.
      if (err instanceof Error && err.name === "AbortError") return;
    }
  }

  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Slight delay so the download has time to kick off before we revoke.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
