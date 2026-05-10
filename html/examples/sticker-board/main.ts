import Phaser from "phaser";

import { StickerScene, STICKER_DEFS } from "./src/StickerScene";
import { initStickerDrawer } from "./src/drawer";

const drawerHost = document.getElementById("drawer-host") as HTMLElement;
const gameHost = document.getElementById("game") as HTMLElement;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameHost,
  backgroundColor: "#fff8e1",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: gameHost.clientWidth,
    height: gameHost.clientHeight,
  },
  render: { antialias: true },
  scene: [StickerScene],
});

const scene = game.scene.getScene("StickerScene") as StickerScene;

game.events.once(Phaser.Core.Events.READY, () => {
  const drawer = initStickerDrawer(drawerHost, STICKER_DEFS, ({ id, clientX, clientY }) => {
    scene.spawnAt(id, clientX, clientY);
  });
  scene.attachDrawer(drawer);

  // Toolbar buttons.
  const clearBtn = document.getElementById("btn-clear") as HTMLButtonElement;
  clearBtn?.addEventListener("click", () => {
    if (window.confirm("Clear all stickers?")) {
      scene.clearAll();
    }
  });
});
