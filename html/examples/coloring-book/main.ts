import Phaser from "phaser";

import { ColoringScene } from "./src/ColoringScene";
import { initPalette } from "./src/palette";
import { initPicker } from "./src/picker";
import { initToolbar } from "./src/toolbar";
import { initTools } from "./src/tools";

initPalette();
initPicker();
initToolbar();
initTools();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#ffffff",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: {
    antialias: true,
  },
  scene: [ColoringScene],
});
