// Tiny diagnostic overlay, opt-in via `?debug=1`. Shipped because the live
// "after ~10 taps the canvas stops painting" report came from a user without
// DevTools open (Android Chrome). The overlay surfaces tap → sample → fill →
// redraw at each step so a future repro produces evidence we can act on,
// plus a window-level error/rejection sink so silent failures aren't silent.
//
// No dependencies, ~30 lines of styling, removed from the bundle path entirely
// when ?debug=1 isn't set (initDebug is a no-op).

interface DebugState {
  taps: number;
  lastTap?: { x: number; y: number; regionId: number };
  lastFill?: { regionId: number; color: string; painted: boolean };
  lastRedraw?: { t: number; fillSize: number };
  lastResize?: { w: number; h: number; src: string };
  lastError?: string;
}

let panel: HTMLDivElement | null = null;
const s: DebugState = { taps: 0 };

export function debugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

export function initDebug(): void {
  if (!debugEnabled()) return;

  panel = document.createElement("div");
  panel.id = "coloring-debug";
  panel.style.cssText = [
    "position:fixed",
    "top:60px",
    "right:8px",
    "z-index:100",
    "background:rgba(0,0,0,0.78)",
    "color:#b9f2c0",
    "font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace",
    "padding:8px 10px",
    "border-radius:6px",
    "pointer-events:none",
    "max-width:260px",
    "white-space:pre-wrap",
    "word-break:break-word",
  ].join(";");
  document.body.appendChild(panel);

  window.addEventListener("error", (e) => {
    s.lastError = `error: ${e.message}`;
    render();
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    s.lastError = `reject: ${reason}`;
    render();
  });

  render();
}

export function debugTap(x: number, y: number, regionId: number): void {
  if (!panel) return;
  s.taps++;
  s.lastTap = { x, y, regionId };
  render();
}

export function debugFill(regionId: number, color: string, painted: boolean): void {
  if (!panel) return;
  s.lastFill = { regionId, color, painted };
  render();
}

export function debugRedraw(fillSize: number): void {
  if (!panel) return;
  s.lastRedraw = { t: Math.round(performance.now()), fillSize };
  render();
}

export function debugResize(w: number, h: number, src: string): void {
  if (!panel) return;
  s.lastResize = { w, h, src };
  render();
}

function render(): void {
  if (!panel) return;
  const lines: string[] = [`taps: ${s.taps}`];
  if (s.lastTap) {
    lines.push(`tap: (${s.lastTap.x},${s.lastTap.y}) id=${s.lastTap.regionId}`);
  }
  if (s.lastFill) {
    lines.push(
      `fill: id=${s.lastFill.regionId} ${s.lastFill.color} painted=${s.lastFill.painted}`
    );
  }
  if (s.lastRedraw) {
    lines.push(`redraw: t=${s.lastRedraw.t} size=${s.lastRedraw.fillSize}`);
  }
  if (s.lastResize) {
    lines.push(`resize: ${s.lastResize.w}×${s.lastResize.h} (${s.lastResize.src})`);
  }
  if (s.lastError) lines.push(`! ${s.lastError}`);
  panel.textContent = lines.join("\n");
}
