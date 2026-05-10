import Phaser from "phaser";

import { CraneScene, REF_W, REF_H } from "./src/CraneScene";

const gameHost = document.getElementById("game") as HTMLElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameHost,
  backgroundColor: "#bee2f5",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: REF_W,
    height: REF_H,
  },
  physics: {
    default: "matter",
    matter: {
      gravity: { x: 0, y: 1 },
      debug: false,
    },
  },
  scene: [CraneScene],
});

// DOM toolbar — the scene listens for the `crane:reset` event.
resetBtn.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("crane:reset"));
});
