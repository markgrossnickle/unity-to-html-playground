import Phaser from "phaser";
import { DINO_SILHOUETTE } from "./dinoBody";

import dinoBodyUrl from "../assets/stegosaurus-body.png?url";
import dinoTailUrl from "../assets/stegosaurus-tail.png?url";
import ballUrl from "../assets/ball.png?url";
import blockUrl from "../assets/block.png?url";
import triangleUrl from "../assets/triangle.png?url";
import bananaUrl from "../assets/banana.png?url";
import starUrl from "../assets/star.png?url";
import donutUrl from "../assets/donut.png?url";
import appleUrl from "../assets/apple.png?url";
import iceCreamUrl from "../assets/ice-cream.png?url";

import type { DrawerHandle, DrawerObject } from "./drawer";

export const DRAWER_OBJECTS: ReadonlyArray<DrawerObject> = [
  { id: "ball", label: "Ball", url: ballUrl },
  { id: "block", label: "Block", url: blockUrl },
  { id: "triangle", label: "Triangle", url: triangleUrl },
  { id: "banana", label: "Banana", url: bananaUrl },
  { id: "star", label: "Star", url: starUrl },
  { id: "donut", label: "Donut", url: donutUrl },
  { id: "apple", label: "Apple", url: appleUrl },
  { id: "ice-cream", label: "Ice cream", url: iceCreamUrl },
];

const TEX_DINO_BODY = "dinoBody";
const TEX_DINO_TAIL = "dinoTail";
const PLANK_THICKNESS = 6;

interface DroppedBody extends Phaser.Physics.Matter.Image {
  /** Original drawer-object id, so the return tween knows which slot to fly to. */
  __dropId?: string;
  /** True once the body has been launched by a slap and should clean up on its own. */
  __returning?: boolean;
}

export class DinoScene extends Phaser.Scene {
  private drawer!: DrawerHandle;
  private bodySprite!: Phaser.GameObjects.Image;
  private tailSprite!: Phaser.GameObjects.Image;

  // Layout — recomputed on resize.
  private dinoScale = 1;
  private dinoOriginX = 0;
  private dinoOriginY = 0;

  // Static physics shapes; rebuilt on resize.
  private staticBodies: MatterJS.BodyType[] = [];
  private dynamicBodies = new Set<DroppedBody>();
  private slapInProgress = false;

  // Pending spawns queued from the DOM drawer between create() resolutions.
  private pendingSpawn: { id: string; clientX: number; clientY: number } | null = null;

  constructor() {
    super("DinoScene");
  }

  preload(): void {
    this.load.image(TEX_DINO_BODY, dinoBodyUrl);
    this.load.image(TEX_DINO_TAIL, dinoTailUrl);
    for (const o of DRAWER_OBJECTS) this.load.image(`obj-${o.id}`, o.url);
  }

  create(): void {
    // Subtle gradient sky → grass.
    this.cameras.main.setBackgroundColor("#dff0c2");

    // Build sprites first; setOrigin so rotation pivots around the tail base.
    this.bodySprite = this.add.image(0, 0, TEX_DINO_BODY).setOrigin(0, 0);
    this.tailSprite = this.add
      .image(0, 0, TEX_DINO_TAIL)
      .setOrigin(
        DINO_SILHOUETTE.tailPivot.x / DINO_SILHOUETTE.width,
        DINO_SILHOUETTE.tailPivot.y / DINO_SILHOUETTE.height
      );

    // Tap detection on the body — uses the silhouette's tap-ellipse so the
    // legs/tail tip don't trigger slaps.
    this.bodySprite.setInteractive({
      useHandCursor: true,
      hitArea: new Phaser.Geom.Ellipse(
        DINO_SILHOUETTE.tapEllipse.cx,
        DINO_SILHOUETTE.tapEllipse.cy,
        DINO_SILHOUETTE.tapEllipse.rx * 2,
        DINO_SILHOUETTE.tapEllipse.ry * 2
      ),
      hitAreaCallback: Phaser.Geom.Ellipse.Contains,
    });
    this.bodySprite.on("pointerdown", () => this.slap());

    this.layout();
    this.scale.on("resize", this.layout, this);

    // Process spawns queued from the DOM drawer.
    this.events.on("update", this.flushPendingSpawn, this);
  }

  attachDrawer(drawer: DrawerHandle): void {
    this.drawer = drawer;
  }

  /** Called by main.ts when the user drops a thumbnail outside the drawer. */
  spawnAt(id: string, clientX: number, clientY: number): void {
    this.pendingSpawn = { id, clientX, clientY };
  }

  // ---- layout / static colliders ---------------------------------------

  private layout(): void {
    const cam = this.cameras.main;
    const w = cam.width;
    const h = cam.height;

    // Scale the dino so it occupies a comfortable chunk of the lower-left.
    // Cap so that on huge screens it doesn't dominate and on tiny screens
    // there's still room to drop objects above it.
    const targetH = Phaser.Math.Clamp(h * 0.55, 180, 360);
    this.dinoScale = targetH / DINO_SILHOUETTE.height;
    this.dinoOriginX = 0;
    this.dinoOriginY = h - DINO_SILHOUETTE.height * this.dinoScale;

    this.bodySprite.setPosition(this.dinoOriginX, this.dinoOriginY);
    this.bodySprite.setScale(this.dinoScale);

    // Tail sits at the same origin in art-space — its setOrigin already
    // accounts for the pivot offset.
    const tailWorldPivotX =
      this.dinoOriginX + DINO_SILHOUETTE.tailPivot.x * this.dinoScale;
    const tailWorldPivotY =
      this.dinoOriginY + DINO_SILHOUETTE.tailPivot.y * this.dinoScale;
    this.tailSprite.setPosition(tailWorldPivotX, tailWorldPivotY);
    this.tailSprite.setScale(this.dinoScale);
    this.tailSprite.setRotation(0);

    this.rebuildStatics(w, h);
  }

  private rebuildStatics(w: number, h: number): void {
    // Remove old static bodies.
    for (const b of this.staticBodies) this.matter.world.remove(b);
    this.staticBodies = [];

    // Ground plank — slightly below the visible bottom so dropped objects
    // settle just inside the canvas.
    const ground = this.matter.add.rectangle(w / 2, h - 4, w, 24, {
      isStatic: true,
      friction: 0.6,
      label: "ground",
    });
    this.staticBodies.push(ground);

    // Side walls — keep falling objects inside the play area.
    const wallH = h + 200;
    const leftWall = this.matter.add.rectangle(-12, h / 2, 24, wallH, {
      isStatic: true,
    });
    const rightWall = this.matter.add.rectangle(w + 12, h / 2, 24, wallH, {
      isStatic: true,
    });
    this.staticBodies.push(leftWall, rightWall);

    // Back + tail planks tracing the silhouette top edge.
    const pts = DINO_SILHOUETTE.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const ax = this.dinoOriginX + a.x * this.dinoScale;
      const ay = this.dinoOriginY + a.y * this.dinoScale;
      const bx = this.dinoOriginX + b.x * this.dinoScale;
      const by = this.dinoOriginY + b.y * this.dinoScale;
      const midX = (ax + bx) / 2;
      const midY = (ay + by) / 2;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const plank = this.matter.add.rectangle(
        midX,
        midY,
        len,
        PLANK_THICKNESS,
        {
          isStatic: true,
          angle,
          friction: 0.18,
          frictionStatic: 0.2,
          restitution: 0.15,
          label: i >= DINO_SILHOUETTE.tailStart - 1 ? "dino-tail" : "dino-back",
        }
      );
      this.staticBodies.push(plank);
    }
  }

  // ---- spawning ---------------------------------------------------------

  private flushPendingSpawn(): void {
    if (!this.pendingSpawn) return;
    const { id, clientX, clientY } = this.pendingSpawn;
    this.pendingSpawn = null;
    this.spawnObjectAtClient(id, clientX, clientY);
  }

  private spawnObjectAtClient(id: string, clientX: number, clientY: number): void {
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (y < 0 || y > rect.height) return;

    const tex = `obj-${id}`;
    const body = this.matter.add.image(x, y, tex, undefined, {
      shape: { type: "circle", radius: 30 },
      restitution: 0.4,
      friction: 0.18,
      frictionAir: 0.005,
      density: 0.0015,
    }) as DroppedBody;
    // Scale the visual to ~64px from the 96px native, matches the drawer thumbs.
    body.setScale(0.7);
    body.__dropId = id;
    this.dynamicBodies.add(body);
  }

  // ---- slap -------------------------------------------------------------

  private slap(): void {
    if (this.slapInProgress) return;
    this.slapInProgress = true;
    this.bodySprite.disableInteractive();

    // Tail tween: rotate up sharply (tail tip swings up and over), then back.
    // The tail sprite faces left in art-space so a NEGATIVE rotation lifts
    // the tip upward when viewed in screen-space.
    this.tweens.add({
      targets: this.tailSprite,
      rotation: -1.05,
      duration: 100,
      ease: "Quad.easeOut",
      yoyo: true,
      hold: 0,
      onComplete: () => this.tailSprite.setRotation(0),
    });

    // Slight body tilt — looks tired during recovery.
    this.tweens.add({
      targets: this.bodySprite,
      angle: -2,
      duration: 100,
      ease: "Quad.easeOut",
      yoyo: true,
      hold: 400,
    });

    // Launch every dynamic object on the scene.
    for (const b of this.dynamicBodies) {
      if (b.__returning) continue;
      const px = b.x;
      const horizontal = (Math.random() - 0.3) * 6; // mostly to the right
      const upward = -10 - Math.random() * 4;
      // Body type — Phaser exposes Matter body via `.body`.
      const body = (b.body as MatterJS.BodyType) ?? null;
      if (body) {
        this.matter.body.setVelocity(body, { x: horizontal, y: upward });
        this.matter.body.setAngularVelocity(body, (Math.random() - 0.5) * 0.4);
      }
      b.__returning = true;
      // Schedule a return-to-drawer tween. The return runs whether the body
      // has flown off-screen or is still mid-air after 600ms.
      this.time.delayedCall(600, () => this.returnToDrawer(b));
      // Also clean up early if it leaves the canvas before 600ms.
      b.setData("offscreenChecker", true);
    }

    // After the slap, re-enable the body once all returns are done.
    this.time.delayedCall(900, () => {
      // If nothing was launched (no dynamic objects), restore immediately.
      if (this.dynamicBodies.size === 0) {
        this.slapInProgress = false;
        this.bodySprite.setInteractive();
      }
    });
  }

  override update(): void {
    // Off-screen cleanup: any returning body that has fully exited the
    // canvas gets returned-to-drawer immediately, so the slot fills back
    // up faster than waiting for the 600ms timer.
    const cam = this.cameras.main;
    for (const b of this.dynamicBodies) {
      if (!b.__returning) continue;
      if (
        b.x < -120 ||
        b.x > cam.width + 120 ||
        b.y < -200 ||
        b.y > cam.height + 200
      ) {
        this.returnToDrawer(b);
      }
    }
  }

  private returnToDrawer(b: DroppedBody): void {
    if (!this.dynamicBodies.has(b)) return;
    this.dynamicBodies.delete(b);

    const id = b.__dropId ?? "";
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    // Convert body's last canvas position into client (page) coordinates so
    // the drawer's flier element starts where the body disappears.
    const startX = Math.max(0, Math.min(rect.width, b.x)) + rect.left;
    const startY = Math.max(0, Math.min(rect.height, b.y)) + rect.top;

    b.destroy();

    const drawer = this.drawer;
    if (!drawer || !id) {
      this.maybeRestoreDino();
      return;
    }
    drawer.animateReturn(id, startX, startY).then(() => this.maybeRestoreDino());
  }

  private maybeRestoreDino(): void {
    if (!this.slapInProgress) return;
    if (this.dynamicBodies.size > 0) return;
    this.slapInProgress = false;
    this.bodySprite.setInteractive();
  }
}
