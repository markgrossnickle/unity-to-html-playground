import Phaser from "phaser";
import {
  PhaserAnimPlayer,
  type AnimationData,
} from "../../src/runtime/PhaserAnimPlayer";

// Vite picks these up at build time, hashes them, and rewrites the URLs.
// The `?url` suffix forces a URL import even for JSON, which Vite would
// otherwise inline as a parsed object.
import atlasPngUrl from "./assets/atlas.png?url";
import atlasJsonUrl from "./assets/atlas.json?url";
import animationJsonUrl from "./assets/animation.json?url";

const ATLAS_KEY = "rig";

class PlaybackScene extends Phaser.Scene {
  private player!: PhaserAnimPlayer;

  constructor() {
    super("PlaybackScene");
  }

  preload(): void {
    this.load.atlas(ATLAS_KEY, atlasPngUrl, atlasJsonUrl);
    this.load.json("animation", animationJsonUrl);
  }

  create(): void {
    const data = this.cache.json.get("animation") as AnimationData;
    this.player = new PhaserAnimPlayer(this, data, ATLAS_KEY);

    this.centerPlayer();
    this.scale.on("resize", this.centerPlayer, this);

    wireHud(this.player);
  }

  private centerPlayer(): void {
    const cam = this.cameras.main;
    this.player.root.setPosition(cam.width / 2, cam.height / 2 + 40);
  }
}

function wireHud(player: PhaserAnimPlayer): void {
  const playBtn = document.getElementById("btn-play") as HTMLButtonElement;
  const restartBtn = document.getElementById(
    "btn-restart"
  ) as HTMLButtonElement;
  const speed = document.getElementById("speed") as HTMLInputElement;
  const speedOut = document.getElementById("speed-out") as HTMLOutputElement;

  const refresh = () => {
    playBtn.textContent = player.isPlaying ? "Pause" : "Play";
  };
  refresh();

  playBtn.addEventListener("click", () => {
    if (player.isPlaying) player.pause();
    else player.play();
    refresh();
  });
  restartBtn.addEventListener("click", () => {
    player.setTime(0);
    player.play();
    refresh();
  });
  speed.addEventListener("input", () => {
    const s = parseFloat(speed.value);
    player.setSpeed(s);
    speedOut.textContent = `${s.toFixed(2)}×`;
  });
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#0e1116",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: {
    pixelArt: true,
    antialias: false,
  },
  scene: [PlaybackScene],
});
