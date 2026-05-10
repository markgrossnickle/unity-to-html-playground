import Phaser from "phaser";

import { PADS, type PadDef } from "./notes";
import * as audio from "./audio";

const COLS = 4;
const ROWS = 4;
const GAP = 12;
const FLASH_IN = 60;
const FLASH_OUT = 220;

interface Pad {
  def: PadDef;
  /** Container is positioned at the pad's center; children are drawn around (0,0). */
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  bright: Phaser.GameObjects.Graphics;
  glow: Phaser.GameObjects.Graphics;
  zone: Phaser.GameObjects.Zone;
  w: number;
  h: number;
}

export class PadScene extends Phaser.Scene {
  private pads: Pad[] = [];
  private padsByKey = new Map<string, Pad>();

  constructor() {
    super("PadScene");
  }

  create(): void {
    this.input.addPointer(3); // up to 4 simultaneous touches

    for (const def of PADS) {
      const glow = this.add.graphics();
      const bg = this.add.graphics();
      const bright = this.add.graphics();
      bright.alpha = 0;
      glow.alpha = 0;

      const zone = this.add.zone(0, 0, 1, 1);
      zone.setInteractive({ useHandCursor: true });

      const container = this.add.container(0, 0, [glow, bg, bright, zone]);

      const pad: Pad = { def, container, bg, bright, glow, zone, w: 0, h: 0 };
      this.pads.push(pad);
      if (def.key) this.padsByKey.set(def.key, pad);

      zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        // Audio context resume must happen inside a user-gesture handler.
        audio.init();
        audio.playNote(def.freq);
        // pointer.x/y are scene coords; container.x/y are scene coords.
        this.flash(pad, pointer.x - container.x, pointer.y - container.y);
      });
    }

    this.layout(this.scale.width, this.scale.height);
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      this.layout(size.width, size.height);
    });

    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      const pad = this.padsByKey.get(key);
      if (!pad) return;
      audio.init();
      audio.playNote(pad.def.freq);
      this.flash(pad, 0, 0);
    });
  }

  private layout(width: number, height: number): void {
    const padW = (width - GAP * (COLS + 1)) / COLS;
    const padH = (height - GAP * (ROWS + 1)) / ROWS;
    if (padW <= 0 || padH <= 0) return;

    this.pads.forEach((pad, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = GAP + col * (padW + GAP) + padW / 2;
      const cy = GAP + row * (padH + GAP) + padH / 2;
      pad.container.setPosition(cx, cy);
      pad.w = padW;
      pad.h = padH;

      // Hit zone covers the full pad, centered on (0,0) in container space.
      pad.zone.setSize(padW, padH);
      pad.zone.setPosition(0, 0);
      pad.zone.input!.hitArea = new Phaser.Geom.Rectangle(
        -padW / 2,
        -padH / 2,
        padW,
        padH,
      );

      drawPad(pad.bg, padW, padH, pad.def.color, false);
      drawPad(pad.bright, padW, padH, pad.def.bright, true);
      drawGlow(pad.glow, padW, padH, pad.def.glow);
    });
  }

  private flash(pad: Pad, px: number, py: number): void {
    this.tweens.killTweensOf([pad.container, pad.bright, pad.glow]);
    pad.container.setScale(1);
    pad.bright.alpha = 0;
    pad.glow.alpha = 0;

    this.tweens.add({
      targets: pad.container,
      scale: 1.08,
      duration: FLASH_IN,
      yoyo: true,
      hold: 20,
      ease: "Quad.easeOut",
    });
    this.tweens.add({
      targets: pad.bright,
      alpha: 1,
      duration: FLASH_IN,
      yoyo: true,
      hold: 20,
      ease: "Quad.easeOut",
    });
    this.tweens.add({
      targets: pad.glow,
      alpha: 0.85,
      duration: FLASH_IN,
      yoyo: true,
      hold: 20,
      ease: "Quad.easeOut",
    });

    // Ripple expanding from the tap point in container-local coords.
    const ripple = this.add.graphics();
    ripple.lineStyle(3, pad.def.glow, 1);
    ripple.strokeCircle(0, 0, Math.max(8, Math.min(pad.w, pad.h) * 0.18));
    ripple.x = pad.container.x + px;
    ripple.y = pad.container.y + py;
    this.tweens.add({
      targets: ripple,
      scale: 2.4,
      alpha: 0,
      duration: FLASH_OUT,
      ease: "Quad.easeOut",
      onComplete: () => ripple.destroy(),
    });
  }
}

function drawPad(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  color: number,
  pressed: boolean,
): void {
  g.clear();
  const r = Math.min(24, Math.min(w, h) * 0.16);
  const x = -w / 2;
  const y = -h / 2;
  // Inset shadow band only on the resting pad — gives a sense of depth.
  if (!pressed) {
    g.fillStyle(0x000000, 0.22);
    g.fillRoundedRect(x, y + 4, w, h - 4, r);
  }
  g.fillStyle(color, 1);
  g.fillRoundedRect(x, y, w, h - 4, r);
  // Top-edge highlight.
  g.fillStyle(0xffffff, 0.18);
  g.fillRoundedRect(x + 6, y + 4, w - 12, Math.min(10, h * 0.12), r * 0.5);
}

function drawGlow(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  color: number,
): void {
  g.clear();
  const r = Math.min(28, Math.min(w, h) * 0.2);
  // Three concentric rounded fills fake a soft halo without shaders.
  for (let i = 0; i < 3; i++) {
    const inset = -8 - i * 6;
    g.fillStyle(color, 0.2 - i * 0.05);
    g.fillRoundedRect(
      -w / 2 + inset,
      -h / 2 + inset,
      w - inset * 2,
      h - inset * 2,
      r + i * 6,
    );
  }
}
