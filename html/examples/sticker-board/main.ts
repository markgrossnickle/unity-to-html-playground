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

// Defer scene lookup until READY — getScene() returns null synchronously
// after `new Phaser.Game(...)`, and the later attachDrawer() throws on the
// null ref, which silently trashes the page (visible as a black screen).
game.events.once(Phaser.Core.Events.READY, () => {
  const scene = game.scene.getScene("StickerScene") as StickerScene | null;
  if (!scene) {
    console.error("StickerScene not registered after READY");
    return;
  }
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
