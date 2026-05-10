import Phaser from "phaser";

import { TraceScene, type TraceMode } from "./src/TraceScene";

const gameHost = document.getElementById("game") as HTMLElement;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameHost,
  backgroundColor: "#fffbea",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: gameHost.clientWidth,
    height: gameHost.clientHeight,
  },
  render: { antialias: true },
  scene: [TraceScene],
});

// Defer scene lookup until READY — getScene() returns null synchronously
// after `new Phaser.Game(...)` and downstream wiring throws on the null ref,
// which silently trashes the page (black screen).
game.events.once(Phaser.Core.Events.READY, () => {
  const scene = game.scene.getScene("TraceScene") as TraceScene | null;
  if (!scene) {
    console.error("TraceScene not registered after READY");
    return;
  }

  const prev = document.getElementById("btn-prev") as HTMLButtonElement | null;
  const next = document.getElementById("btn-next") as HTMLButtonElement | null;
  const restart = document.getElementById(
    "btn-restart"
  ) as HTMLButtonElement | null;

  prev?.addEventListener("click", () => scene.gotoPrev());
  next?.addEventListener("click", () => scene.gotoNext());
  restart?.addEventListener("click", () => scene.restart());

  const modeBtns: Record<TraceMode, HTMLButtonElement | null> = {
    numbers: document.getElementById(
      "btn-mode-numbers"
    ) as HTMLButtonElement | null,
    letters: document.getElementById(
      "btn-mode-letters"
    ) as HTMLButtonElement | null,
  };

  const applyMode = (mode: TraceMode): void => {
    scene.setMode(mode);
    for (const m of ["numbers", "letters"] as const) {
      const btn = modeBtns[m];
      if (!btn) continue;
      const active = m === mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
  };

  modeBtns.numbers?.addEventListener("click", () => applyMode("numbers"));
  modeBtns.letters?.addEventListener("click", () => applyMode("letters"));
});
