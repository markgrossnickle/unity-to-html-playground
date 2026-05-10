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

const scene = game.scene.getScene("DinoScene") as DinoScene;

// Boot the drawer once the scene is created.
game.events.once(Phaser.Core.Events.READY, () => {
  const drawer = initDrawer(drawerHost, DRAWER_OBJECTS, ({ id, clientX, clientY }) => {
    scene.spawnAt(id, clientX, clientY);
  });
  scene.attachDrawer(drawer);
});
