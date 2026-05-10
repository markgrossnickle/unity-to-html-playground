import Phaser from "phaser";

import * as Audio from "./audio";

import shipUrl from "../assets/ship.png?url";
import asteroid1Url from "../assets/asteroid-1.png?url";
import asteroid2Url from "../assets/asteroid-2.png?url";
import asteroid3Url from "../assets/asteroid-3.png?url";
import heartUrl from "../assets/heart.png?url";

const SHIP_KEY = "ship";
const ASTEROID_KEYS = ["asteroid-1", "asteroid-2", "asteroid-3"] as const;
const HEART_KEY = "heart";

const SHIP_RADIUS = 24;
const SHIP_FOLLOW_LERP = 0.12;
const SHIP_BOTTOM_OFFSET = 110;       // ship's y is canvas height − this
const INVINCIBILITY_MS = 1500;
const STARTING_LIVES = 3;

const BASE_SCROLL = 200;              // px/s
const MAX_SCROLL = 400;
const SCROLL_RAMP_PER_POINT = 4;      // scroll += this * score, clamped to MAX

const BASE_SPAWN_MS = 600;
const MIN_SPAWN_MS = 200;
const SPAWN_RAMP_PER_POINT = 6;

const ASTEROID_MIN = 32;
const ASTEROID_MAX = 64;

const STAR_COUNT_NEAR = 35;
const STAR_COUNT_FAR = 70;

type Asteroid = {
  sprite: Phaser.GameObjects.Image;
  radius: number;
  passed: boolean;
};

type Star = {
  x: number;
  y: number;
  size: number;
  speedFactor: number;            // 1.0 = near, 0.3 = far (parallax)
  alpha: number;
};

export class SpaceScene extends Phaser.Scene {
  private ship!: Phaser.GameObjects.Image;
  private shipTargetX = 0;
  private asteroids: Asteroid[] = [];
  private stars: Star[] = [];
  private starGfx!: Phaser.GameObjects.Graphics;

  private lives = STARTING_LIVES;
  private score = 0;
  private invincibleUntil = 0;
  private spawnTimerMs = 0;
  private isGameOver = false;
  private engineStarted = false;

  // HUD
  private hearts: Phaser.GameObjects.Image[] = [];
  private scoreText!: Phaser.GameObjects.Text;

  // Game-over overlay
  private overlay: Phaser.GameObjects.Container | null = null;

  constructor() {
    super("SpaceScene");
  }

  preload(): void {
    this.load.image(SHIP_KEY, shipUrl);
    this.load.image(ASTEROID_KEYS[0], asteroid1Url);
    this.load.image(ASTEROID_KEYS[1], asteroid2Url);
    this.load.image(ASTEROID_KEYS[2], asteroid3Url);
    this.load.image(HEART_KEY, heartUrl);
  }

  create(): void {
    const { width, height } = this.scale.gameSize;

    this.starGfx = this.add.graphics();
    this.starGfx.setDepth(0);
    this.initStars(width, height);

    this.ship = this.add.image(width / 2, height - SHIP_BOTTOM_OFFSET, SHIP_KEY);
    this.ship.setDepth(10);
    this.shipTargetX = this.ship.x;

    this.buildHud();

    // Resize handler — reposition ship's y and HUD; keep targetX clamped.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);

    // Input — drag/touch anywhere to steer.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointer, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointer, this);

    // Tear down listeners when the scene shuts down (so a manual restart
    // doesn't double-register handlers).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      Audio.stopEngine();
    });
  }

  private onPointer(pointer: Phaser.Input.Pointer): void {
    if (!this.engineStarted) {
      Audio.init();
      Audio.startEngine();
      this.engineStarted = true;
    }
    if (this.isGameOver) return;
    this.shipTargetX = pointer.x;
  }

  private onResize(gameSize: Phaser.Structs.Size): void {
    const { width, height } = gameSize;
    this.ship.y = height - SHIP_BOTTOM_OFFSET;
    this.shipTargetX = Phaser.Math.Clamp(this.shipTargetX, 16, width - 16);
    this.layoutHud(width);
    if (this.overlay) {
      this.overlay.setPosition(width / 2, height / 2);
    }
  }

  // ---- HUD --------------------------------------------------------------

  private buildHud(): void {
    const { width } = this.scale.gameSize;

    for (let i = 0; i < STARTING_LIVES; i++) {
      const h = this.add.image(0, 0, HEART_KEY);
      h.setDepth(20);
      this.hearts.push(h);
    }

    this.scoreText = this.add.text(0, 0, "0", {
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: "22px",
      color: "#e7eaf3",
      fontStyle: "bold",
    });
    this.scoreText.setDepth(20);
    this.scoreText.setShadow(0, 1, "#000000", 3, true, true);

    this.layoutHud(width);
  }

  private layoutHud(width: number): void {
    const startX = 16;
    const y = 16;
    this.hearts.forEach((h, i) => {
      h.setPosition(startX + i * 32 + 16, y + 16);
    });
    this.scoreText.setPosition(width - 16, y);
    this.scoreText.setOrigin(1, 0);
  }

  // ---- starfield --------------------------------------------------------

  private initStars(width: number, height: number): void {
    this.stars = [];
    for (let i = 0; i < STAR_COUNT_FAR; i++) {
      this.stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 1,
        speedFactor: 0.3 + Math.random() * 0.2,
        alpha: 0.3 + Math.random() * 0.3,
      });
    }
    for (let i = 0; i < STAR_COUNT_NEAR; i++) {
      this.stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 1.5 + Math.random(),
        speedFactor: 0.7 + Math.random() * 0.4,
        alpha: 0.6 + Math.random() * 0.4,
      });
    }
  }

  private drawStars(): void {
    const g = this.starGfx;
    g.clear();
    for (const s of this.stars) {
      g.fillStyle(0xffffff, s.alpha);
      g.fillCircle(s.x, s.y, s.size);
    }
  }

  private updateStars(dt: number, scroll: number, height: number, width: number): void {
    for (const s of this.stars) {
      s.y += scroll * s.speedFactor * dt;
      if (s.y > height) {
        s.y -= height + Math.random() * 20;
        s.x = Math.random() * width;
      }
    }
  }

  // ---- main loop --------------------------------------------------------

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;
    const { width, height } = this.scale.gameSize;

    // Smooth-follow horizontal position.
    if (!this.isGameOver) {
      this.ship.x = Phaser.Math.Linear(this.ship.x, this.shipTargetX, SHIP_FOLLOW_LERP);
      this.ship.x = Phaser.Math.Clamp(this.ship.x, 16, width - 16);
    }

    const scroll = Math.min(MAX_SCROLL, BASE_SCROLL + this.score * SCROLL_RAMP_PER_POINT);

    this.updateStars(dt, scroll, height, width);
    this.drawStars();

    if (!this.isGameOver) {
      this.spawnTimerMs -= delta;
      if (this.spawnTimerMs <= 0) {
        this.spawnAsteroid(width);
        const interval = Math.max(
          MIN_SPAWN_MS,
          BASE_SPAWN_MS - this.score * SPAWN_RAMP_PER_POINT
        );
        this.spawnTimerMs = interval;
      }
    }

    this.updateAsteroids(dt, scroll, height);

    // Collision check — circle vs ship (skip during invincibility).
    if (!this.isGameOver && this.time.now > this.invincibleUntil) {
      this.checkCollisions();
    }

    // Invincibility flash — blink the ship at ~10 Hz.
    if (this.time.now < this.invincibleUntil) {
      this.ship.alpha = (Math.floor(this.time.now / 80) % 2) === 0 ? 0.35 : 1;
    } else if (!this.isGameOver) {
      this.ship.alpha = 1;
    }
  }

  // ---- asteroids --------------------------------------------------------

  private spawnAsteroid(width: number): void {
    const idx = Math.floor(Math.random() * ASTEROID_KEYS.length);
    const key = ASTEROID_KEYS[idx] ?? ASTEROID_KEYS[0];
    const size = ASTEROID_MIN + Math.random() * (ASTEROID_MAX - ASTEROID_MIN);
    const sprite = this.add.image(
      Math.random() * (width - size) + size / 2,
      -size,
      key
    );
    // Source images are 96×96; scale to the desired display size.
    const scale = size / 96;
    sprite.setScale(scale);
    sprite.setDepth(5);
    sprite.setRotation(Math.random() * Math.PI * 2);

    this.asteroids.push({
      sprite,
      radius: size * 0.45,            // a bit tighter than the visual circle
      passed: false,
    });
  }

  private updateAsteroids(dt: number, scroll: number, height: number): void {
    const survivors: Asteroid[] = [];
    for (const a of this.asteroids) {
      a.sprite.y += scroll * dt;
      a.sprite.rotation += dt * 0.4;

      // Award a point the moment it clears below the ship's y.
      if (!a.passed && a.sprite.y > this.ship.y + 30) {
        a.passed = true;
        if (!this.isGameOver) {
          this.score += 1;
          this.scoreText.setText(String(this.score));
        }
      }

      if (a.sprite.y - a.radius > height + 40) {
        a.sprite.destroy();
      } else {
        survivors.push(a);
      }
    }
    this.asteroids = survivors;
  }

  private checkCollisions(): void {
    const sx = this.ship.x;
    const sy = this.ship.y;
    for (const a of this.asteroids) {
      const dx = a.sprite.x - sx;
      const dy = a.sprite.y - sy;
      const r = a.radius + SHIP_RADIUS;
      if (dx * dx + dy * dy < r * r) {
        this.onHit();
        return;
      }
    }
  }

  // ---- hit / game over --------------------------------------------------

  private onHit(): void {
    this.lives -= 1;
    Audio.playCrash();
    this.cameras.main.shake(180, 0.012);

    // Drop the rightmost heart from the HUD.
    const h = this.hearts.pop();
    if (h) h.destroy();

    // Clear asteroids near the ship — give the player breathing room.
    const breathing = 220;
    const survivors: Asteroid[] = [];
    for (const a of this.asteroids) {
      const dx = a.sprite.x - this.ship.x;
      const dy = a.sprite.y - this.ship.y;
      if (dx * dx + dy * dy < breathing * breathing) {
        a.sprite.destroy();
      } else {
        survivors.push(a);
      }
    }
    this.asteroids = survivors;

    if (this.lives <= 0) {
      this.triggerGameOver();
    } else {
      this.invincibleUntil = this.time.now + INVINCIBILITY_MS;
    }
  }

  private triggerGameOver(): void {
    this.isGameOver = true;
    this.ship.alpha = 0.25;
    Audio.stopEngine();
    Audio.playGameOver();
    this.showGameOverOverlay();
  }

  private showGameOverOverlay(): void {
    const { width, height } = this.scale.gameSize;
    const c = this.add.container(width / 2, height / 2);
    c.setDepth(100);

    const panelW = 280;
    const panelH = 180;
    const panel = this.add.graphics();
    panel.fillStyle(0x0b1024, 0.92);
    panel.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
    panel.lineStyle(2, 0x37e6ff, 0.6);
    panel.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);

    const title = this.add.text(0, -55, "Game Over", {
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: "28px",
      color: "#e7eaf3",
      fontStyle: "bold",
    }).setOrigin(0.5);

    const scoreLine = this.add.text(0, -16, `Score: ${this.score}`, {
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: "18px",
      color: "#8b93a8",
    }).setOrigin(0.5);

    const btnW = 160;
    const btnH = 44;
    const btn = this.add.graphics();
    btn.fillStyle(0x37e6ff, 1);
    btn.fillRoundedRect(-btnW / 2, 26, btnW, btnH, 10);
    const btnText = this.add.text(0, 26 + btnH / 2, "Restart", {
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: "18px",
      color: "#06081a",
      fontStyle: "bold",
    }).setOrigin(0.5);

    // Hit zone covering the button rectangle.
    const hit = this.add.zone(0, 26 + btnH / 2, btnW, btnH).setInteractive({
      useHandCursor: true,
    });
    hit.on(Phaser.Input.Events.POINTER_DOWN, () => this.restart());

    c.add([panel, title, scoreLine, btn, btnText, hit]);
    this.overlay = c;
  }

  private restart(): void {
    // Tear down overlay + asteroids, then reset state and rebuild HUD hearts.
    if (this.overlay) {
      this.overlay.destroy(true);
      this.overlay = null;
    }
    for (const a of this.asteroids) a.sprite.destroy();
    this.asteroids = [];

    this.lives = STARTING_LIVES;
    this.score = 0;
    this.invincibleUntil = 0;
    this.spawnTimerMs = 0;
    this.isGameOver = false;
    this.scoreText.setText("0");
    this.ship.alpha = 1;

    for (const h of this.hearts) h.destroy();
    this.hearts = [];
    for (let i = 0; i < STARTING_LIVES; i++) {
      const h = this.add.image(0, 0, HEART_KEY);
      h.setDepth(20);
      this.hearts.push(h);
    }
    this.layoutHud(this.scale.gameSize.width);

    if (this.engineStarted) Audio.startEngine();
  }
}
