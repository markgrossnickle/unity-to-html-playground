import Phaser from "phaser";
import { DINO_SILHOUETTE } from "./dinoBody";

import dinoBodyUrl from "../assets/brontosaurus-body.png?url";
import dinoTailUrl from "../assets/brontosaurus-tail.png?url";
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
const VISUAL_SCALE = 0.7;

// ---- per-object collider + physics defs ---------------------------------
//
// Shapes are authored in the sprite's native 96×96 art-space and then
// uniformly scaled by VISUAL_SCALE alongside the sprite (Phaser's
// MatterImage.setScale scales both visual and body). The numbers below
// describe roughly the visible silhouette of each thumbnail — not the
// full 96×96 frame — so the collider hugs the art tightly rather than
// approximating everything as a circle (which made the box roll like a
// ball).

interface SpawnDef {
  shape: Phaser.Types.Physics.Matter.MatterSetBodyConfig;
  density: number;
  restitution: number;
  friction: number;
}

function ellipseVerts(rx: number, ry: number, n: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({ x: Math.cos(t) * rx, y: Math.sin(t) * ry });
  }
  return out;
}

function starVerts(outer: number, inner: number, points: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const t = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2; // top point up
    out.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
  }
  return out;
}

// Ice-cream outline: scoop arc on top, cone tip below. The shape is
// authored convex so Matter doesn't have to invoke poly-decomp.
const ICE_CREAM_VERTS: Array<{ x: number; y: number }> = [
  { x: -20, y: -8 },
  { x: -16, y: -22 },
  { x: 0, y: -28 },
  { x: 16, y: -22 },
  { x: 20, y: -8 },
  { x: 0, y: 32 },
];

const SPAWN_DEFS: Record<string, SpawnDef> = {
  ball: {
    shape: { type: "circle", radius: 30 },
    density: 0.0012,
    restitution: 0.55,
    friction: 0.04,
  },
  block: {
    // Axis-aligned rectangle so the block doesn't roll.
    shape: { type: "rectangle", width: 60, height: 60 },
    density: 0.0045,
    restitution: 0.05,
    friction: 0.5,
  },
  triangle: {
    shape: {
      type: "fromVerts",
      verts: [{ x: 0, y: -28 }, { x: 30, y: 22 }, { x: -30, y: 22 }],
      flagInternal: false,
    },
    density: 0.0022,
    restitution: 0.15,
    friction: 0.1,
  },
  banana: {
    // Elongated horizontal ellipse — capsule-like approximation.
    shape: {
      type: "fromVerts",
      verts: ellipseVerts(34, 14, 10),
      flagInternal: false,
    },
    density: 0.0014,
    restitution: 0.3,
    friction: 0.06,
  },
  star: {
    // 5-point star, 10 alternating verts. Concave; Matter decomposes
    // via the bundled poly-decomp.
    shape: {
      type: "fromVerts",
      verts: starVerts(32, 14, 5),
      flagInternal: false,
    },
    density: 0.002,
    restitution: 0.3,
    friction: 0.12,
  },
  donut: {
    // Hole isn't relevant for collisions — players won't notice.
    shape: { type: "circle", radius: 30 },
    density: 0.004,
    restitution: 0.1,
    friction: 0.4,
  },
  apple: {
    // Slightly squished vertically.
    shape: {
      type: "fromVerts",
      verts: ellipseVerts(30, 27, 12),
      flagInternal: false,
    },
    density: 0.0022,
    restitution: 0.25,
    friction: 0.15,
  },
  "ice-cream": {
    shape: {
      type: "fromVerts",
      verts: ICE_CREAM_VERTS,
      flagInternal: false,
    },
    density: 0.002,
    restitution: 0.2,
    friction: 0.15,
  },
};

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

    // The brontosaurus is sized for a back-hump-and-tail-slide view: head
    // and neck disappear off the LEFT edge, tail tip lands on the ground
    // at the right. The silhouette is authored so its visible left edge is
    // at art-x=0 and the tail tip is near (artW, artH); fit-by-width
    // therefore positions everything correctly across all common viewport
    // widths without needing per-axis hacks.
    this.dinoScale = w / DINO_SILHOUETTE.width;
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
          // Low friction so dropped objects roll/slide down the back hump
          // and along the tail-slide rather than catching at each plank
          // junction.
          friction: 0.02,
          frictionStatic: 0.02,
          restitution: 0.1,
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
    const def = SPAWN_DEFS[id];
    if (!def) return;
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (y < 0 || y > rect.height) return;

    const tex = `obj-${id}`;
    const body = this.matter.add.image(x, y, tex, undefined, {
      shape: def.shape,
      restitution: def.restitution,
      friction: def.friction,
      frictionAir: 0.005,
      density: def.density,
    }) as DroppedBody;
    // Match drawer thumb size; setScale also scales the body, so the
    // collider stays proportional to the rendered art.
    body.setScale(VISUAL_SCALE);
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
