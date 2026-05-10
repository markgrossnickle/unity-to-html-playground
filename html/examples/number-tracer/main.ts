import Phaser from "phaser";

import { TraceScene } from "./src/TraceScene";

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
});
