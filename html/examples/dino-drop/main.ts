import Phaser from "phaser";

import { DinoScene, DRAWER_OBJECTS } from "./src/DinoScene";
import { initDrawer } from "./src/drawer";

const drawerHost = document.getElementById("drawer-host") as HTMLElement;
const gameHost = document.getElementById("game") as HTMLElement;

// Phaser is created first; the scene queues spawns until the drawer is
// attached. Then we wire the DOM drawer to push spawn events into the scene.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameHost,
  backgroundColor: "#dff0c2",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: gameHost.clientWidth,
    height: gameHost.clientHeight,
  },
  physics: {
    default: "matter",
    matter: {
      gravity: { x: 0, y: 1 },
      debug: false,
    },
  },
  scene: [DinoScene],
});

// Defer scene lookup until Phaser has wired the scene manager — calling
// getScene() synchronously after `new Phaser.Game(...)` returns null and the
// later attachDrawer() throws on the null ref, which silently trashes the
// page (visible as a black screen on mobile).
game.events.once(Phaser.Core.Events.READY, () => {
  const scene = game.scene.getScene("DinoScene") as DinoScene | null;
  if (!scene) {
    console.error("DinoScene not registered after READY");
    return;
  }
  const drawer = initDrawer(drawerHost, DRAWER_OBJECTS, ({ id, clientX, clientY }) => {
    scene.spawnAt(id, clientX, clientY);
  });
  scene.attachDrawer(drawer);
});
