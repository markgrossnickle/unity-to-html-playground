import Phaser from "phaser";

import { PadScene } from "./src/PadScene";

const gameHost = document.getElementById("game") as HTMLElement;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameHost,
  backgroundColor: "#14131a",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: gameHost.clientWidth,
    height: gameHost.clientHeight,
  },
  render: { antialias: true },
  scene: [PadScene],
});
