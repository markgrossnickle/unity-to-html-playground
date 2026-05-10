import Phaser from "phaser";

import { SpaceScene } from "./src/SpaceScene";

const gameHost = document.getElementById("game") as HTMLElement;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameHost,
  backgroundColor: "#06081a",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: gameHost.clientWidth,
    height: gameHost.clientHeight,
  },
  render: { antialias: true },
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [SpaceScene],
});

// Defer scene lookup until READY — getScene() returns null synchronously
// after `new Phaser.Game(...)`, which silently trashes the page on mobile.
game.events.once(Phaser.Core.Events.READY, () => {
  const scene = game.scene.getScene("SpaceScene") as SpaceScene | null;
  if (!scene) {
    console.error("SpaceScene not registered after READY");
  }
});
