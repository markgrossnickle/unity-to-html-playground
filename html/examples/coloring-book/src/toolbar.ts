import { events } from "./events";
import { parseImage } from "./importParser";
import { addImportedPicture, StorageQuotaError } from "./pictures";

export function initToolbar(): void {
  document
    .getElementById("btn-undo")!
    .addEventListener("click", () => events.emit("undo", undefined));
  document
    .getElementById("btn-clear")!
    .addEventListener("click", () => events.emit("clear", undefined));
  document
    .getElementById("btn-save")!
    .addEventListener("click", () => events.emit("save", undefined));

  initImportButton();
}

function initImportButton(): void {
  const btn = document.getElementById("btn-import") as HTMLButtonElement;
  const input = document.getElementById("import-file") as HTMLInputElement;
  btn.addEventListener("click", () => {
    // Reset value so re-selecting the same file fires `change` again.
    input.value = "";
    input.click();
  });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void runImport(file);
  });
}

async function runImport(file: File): Promise<void> {
  showOverlay("Parsing image…");
  // Yield to the browser so the overlay paints before the (CPU-heavy) parse.
  await new Promise((r) => requestAnimationFrame(r));
  try {
    const parsed = await parseImage(file, {
      onProgress: (stage) => {
        if (stage === "cartoonize") setOverlayText("Detecting outlines…");
        else if (stage === "label") setOverlayText("Parsing regions…");
      },
    });
    const entry = addImportedPicture({
      name: parsed.name,
      linesPng: parsed.linesPng,
      labelsPng: parsed.labelsPng,
    });
    events.emit("picture:select", entry.id);
  } catch (err) {
    const message =
      err instanceof StorageQuotaError
        ? err.message
        : err instanceof Error
          ? `Import failed: ${err.message}`
          : "Import failed.";
    window.alert(message);
  } finally {
    hideOverlay();
  }
}

function showOverlay(text: string): void {
  const overlay = document.getElementById("import-overlay");
  if (!overlay) return;
  setOverlayText(text);
  overlay.hidden = false;
}

function setOverlayText(text: string): void {
  const label = document.getElementById("import-overlay-text");
  if (label) label.textContent = text;
}

function hideOverlay(): void {
  const overlay = document.getElementById("import-overlay");
  if (overlay) overlay.hidden = true;
}
