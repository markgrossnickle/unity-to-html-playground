import Phaser from "phaser";

import { HOUSE_PIECES, type HousePiece } from "./house";
import { drawChain } from "./chain";

import skyUrl from "../assets/sky.png?url";
import craneBaseUrl from "../assets/crane-base.png?url";
import craneArmUrl from "../assets/crane-arm.png?url";
import wreckingBallUrl from "../assets/wrecking-ball.png?url";
import wallAUrl from "../assets/house-wall-a.png?url";
import wallBUrl from "../assets/house-wall-b.png?url";
import wallCUrl from "../assets/house-wall-c.png?url";
import wallDUrl from "../assets/house-wall-d.png?url";
import roofPeakUrl from "../assets/house-roof-peak.png?url";
import doorUrl from "../assets/house-door.png?url";
import windowUrl from "../assets/house-window.png?url";
import chimneyUrl from "../assets/house-chimney.png?url";

// World reference resolution. The Phaser game is launched with Scale.FIT so
// physics tuning, layout constants, and asset sizes are all in this space.
export const REF_W = 1600;
export const REF_H = 900;

const GROUND_Y = 820;
// TOWER_X moved closer to the house at HX=1320 so the ball can actually
// reach. With ARM_LEN=420 the tip reaches ~1120 horizontal, and with the
// CHAIN_LEN=380 ball swing the ball can sweep into the house at HX=1320.
const TOWER_X = 700;
const PIVOT_Y = 240;
const ARM_LEN = 420; // distance from pivot to the tip-anchor in world units
const CHAIN_LEN = 380;
const BALL_RADIUS = 36;

// Arm swing range, in radians from horizontal-right (+x axis, Phaser
// convention: y is down → negative angle = up). The arm can swing from up-
// and-over-the-tower all the way down to slightly below horizontal.
const ARM_MIN_ANGLE = -2.2; // ≈ -126° (up and over to the left)
const ARM_MAX_ANGLE = 0.5; // ≈ +29° (slightly below horizontal)
const ARM_REST_ANGLE = 0; // horizontal-right

// Pick-up zone around the arm line (in world units).
const DRAG_HIT_DIST = 60;

// Minimum impact speed to flip a static house piece to dynamic.
const SHATTER_VELOCITY = 3.0;

interface HouseBody extends Phaser.Physics.Matter.Image {
  __pieceId: string;
}

export class CraneScene extends Phaser.Scene {
  private bg!: Phaser.GameObjects.Image;
  private towerSprite!: Phaser.GameObjects.Image;
  private armSprite!: Phaser.GameObjects.Image;
  private ball!: Phaser.Physics.Matter.Image;
  private armAnchor!: MatterJS.BodyType;
  private constraint!: MatterJS.ConstraintType;
  private chainGraphics!: Phaser.GameObjects.Graphics;

  // Arm orientation — controlled directly (not by physics).
  private armAngle = ARM_REST_ANGLE;
  private dragging = false;
  // Direct-grab on the ball — when true, the ball follows the pointer and
  // the arm angle re-derives from the ball position so the chain doesn't
  // visually disconnect.
  private draggingBall = false;
  private prevBallPos = { x: 0, y: 0 };
  // For computing flick velocity at release.
  private prevArmAngle = ARM_REST_ANGLE;
  private armAngularVelocity = 0;

  private housePieces: HouseBody[] = [];

  constructor() {
    super("CraneScene");
  }

  preload(): void {
    this.load.image("crane-sky", skyUrl);
    this.load.image("crane-tower", craneBaseUrl);
    this.load.image("crane-arm", craneArmUrl);
    this.load.image("crane-ball", wreckingBallUrl);
    this.load.image("wall-a", wallAUrl);
    this.load.image("wall-b", wallBUrl);
    this.load.image("wall-c", wallCUrl);
    this.load.image("wall-d", wallDUrl);
    this.load.image("roof", roofPeakUrl);
    this.load.image("door", doorUrl);
    this.load.image("window", windowUrl);
    this.load.image("chimney", chimneyUrl);
  }

  create(): void {
    // Background — fills the reference canvas.
    this.bg = this.add
      .image(REF_W / 2, REF_H / 2, "crane-sky")
      .setDisplaySize(REF_W, REF_H);

    // Ground static body — slightly thicker than the visible grass band.
    this.matter.add.rectangle(REF_W / 2, GROUND_Y + 60, REF_W * 1.2, 120, {
      isStatic: true,
      friction: 0.8,
      label: "ground",
    });
    // Side walls so flying debris doesn't fly off forever.
    this.matter.add.rectangle(-50, REF_H / 2, 100, REF_H * 2, {
      isStatic: true,
      label: "wall-left",
    });
    this.matter.add.rectangle(REF_W + 50, REF_H / 2, 100, REF_H * 2, {
      isStatic: true,
      label: "wall-right",
    });

    // Crane tower — drawn behind the arm.
    this.towerSprite = this.add
      .image(TOWER_X, GROUND_Y, "crane-tower")
      .setOrigin(0.5, 1);

    // Crane arm — origin at the pivot disc (drawn at sprite-x=20, sprite-y=36
    // in a 500×80 sprite ⇒ origin (0.04, 0.45)).
    this.armSprite = this.add
      .image(TOWER_X, PIVOT_Y, "crane-arm")
      .setOrigin(0.04, 0.45)
      .setRotation(ARM_REST_ANGLE);

    // Wrecking ball — dynamic Matter circle hanging below the arm tip.
    const tip = this.armTip(ARM_REST_ANGLE);
    this.ball = this.matter.add.image(tip.x, tip.y + CHAIN_LEN, "crane-ball", undefined, {
      shape: { type: "circle", radius: BALL_RADIUS },
      density: 0.05,
      friction: 0.4,
      frictionAir: 0.005,
      restitution: 0.15,
      label: "ball",
    });

    // Anchor body — invisible, static, follows the arm tip. The constraint
    // connects it to the ball, so the ball pendulum-swings beneath the arm.
    this.armAnchor = this.matter.add.circle(tip.x, tip.y, 2, {
      isStatic: true,
      isSensor: true,
      label: "arm-anchor",
    });
    this.constraint = this.matter.add.constraint(
      this.armAnchor as unknown as MatterJS.BodyType,
      this.ball.body as MatterJS.BodyType,
      CHAIN_LEN,
      0.85,
      { damping: 0.04 },
    );

    // Chain visualization — drawn each frame between anchor and ball.
    this.chainGraphics = this.add.graphics();
    // Tower needs to sit in front of the chain at the pivot. Reorder so
    // chain is behind the tower but in front of the sky.
    this.children.sendToBack(this.chainGraphics);
    this.children.sendToBack(this.bg);

    // House pieces — built static, flipped to dynamic on impact.
    this.buildHouse();

    // Collision handler — promotes static pieces on impact, applies impulse.
    this.matter.world.on("collisionstart", this.onCollisionStart, this);

    // Drag input on the arm.
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointerupoutside", this.onPointerUp, this);

    // Toolbar buttons (DOM, listens to global events).
    window.addEventListener("crane:reset", this.resetAll);
  }

  override update(_time: number, delta: number): void {
    // Sync arm sprite + anchor to current armAngle, and compute angular
    // velocity for flick-on-release.
    const dt = Math.max(1, delta) / 1000;
    this.armAngularVelocity = (this.armAngle - this.prevArmAngle) / dt;
    this.prevArmAngle = this.armAngle;
    this.armSprite.setRotation(this.armAngle);
    const tip = this.armTip(this.armAngle);
    this.matter.body.setPosition(this.armAnchor, { x: tip.x, y: tip.y });

    // Chain visualization.
    if (this.ball.body) {
      const b = this.ball.body as MatterJS.BodyType;
      drawChain(this.chainGraphics, tip.x, tip.y, b.position.x, b.position.y);
    }
  }

  // ---- arm geometry & input ---------------------------------------------

  private armTip(angle: number): { x: number; y: number } {
    return {
      x: TOWER_X + Math.cos(angle) * ARM_LEN,
      y: PIVOT_Y + Math.sin(angle) * ARM_LEN,
    };
  }

  private pointerNearArm(wx: number, wy: number): boolean {
    // Distance from point to the arm line segment (pivot → tip).
    const tip = this.armTip(this.armAngle);
    const px = TOWER_X, py = PIVOT_Y;
    const vx = tip.x - px, vy = tip.y - py;
    const wx2 = wx - px, wy2 = wy - py;
    const lenSq = vx * vx + vy * vy;
    if (lenSq < 1) return false;
    let t = (wx2 * vx + wy2 * vy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = px + vx * t, cy = py + vy * t;
    const d = Math.hypot(wx - cx, wy - cy);
    return d < DRAG_HIT_DIST;
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    // Ball grab takes priority — if the finger lands near the wrecking ball,
    // the user is grabbing the ball directly, not the arm.
    const b = this.ball.body as MatterJS.BodyType;
    const distBall = Math.hypot(p.worldX - b.position.x, p.worldY - b.position.y);
    if (distBall < BALL_RADIUS + 24) {
      this.draggingBall = true;
      this.prevBallPos = { x: b.position.x, y: b.position.y };
      return;
    }
    if (this.pointerNearArm(p.worldX, p.worldY)) {
      this.dragging = true;
    }
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.draggingBall) {
      const b = this.ball.body as MatterJS.BodyType;
      this.prevBallPos = { x: b.position.x, y: b.position.y };
      // Teleport the ball to the pointer; zero the velocity each frame so
      // gravity doesn't fight the drag. The constraint between the arm
      // anchor and the ball still applies — but with the ball pinned to the
      // pointer, the constraint instead pulls the arm toward the ball,
      // which we re-derive in the update tick.
      this.matter.body.setPosition(b, { x: p.worldX, y: p.worldY }, false);
      this.matter.body.setVelocity(b, { x: 0, y: 0 });
      return;
    }
    if (!this.dragging) return;
    const dx = p.worldX - TOWER_X;
    const dy = p.worldY - PIVOT_Y;
    let angle = Math.atan2(dy, dx);
    // Wrap so we can clamp through the upper half — if the user drags way
    // past straight up, atan2 jumps from -PI to +PI. Normalize anything in
    // the "left half-plane and above" (angle > PI/2) into the negative range.
    if (angle > Math.PI / 2) angle = angle - 2 * Math.PI;
    angle = Phaser.Math.Clamp(angle, ARM_MIN_ANGLE, ARM_MAX_ANGLE);
    this.armAngle = angle;
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (this.draggingBall) {
      this.draggingBall = false;
      // Impart the drag's instantaneous velocity to the ball on release so
      // a flick-throw flings naturally. delta seconds ≈ 1/60.
      const b = this.ball.body as MatterJS.BodyType;
      const vx = (p.worldX - this.prevBallPos.x) * 30;
      const vy = (p.worldY - this.prevBallPos.y) * 30;
      this.matter.body.setVelocity(b, { x: vx, y: vy });
      return;
    }
    this.dragging = false;
    // On release, apply the arm's angular velocity to the ball as a tangential
    // impulse so flick-release feels satisfying.
    if (this.ball.body && Math.abs(this.armAngularVelocity) > 0.5) {
      const tip = this.armTip(this.armAngle);
      const b = this.ball.body as MatterJS.BodyType;
      // Tangent vector to the arm rotation at the tip.
      const tangent = { x: -Math.sin(this.armAngle), y: Math.cos(this.armAngle) };
      const speed = this.armAngularVelocity * ARM_LEN * 0.4;
      const vx = b.velocity.x + tangent.x * speed * 0.04;
      const vy = b.velocity.y + tangent.y * speed * 0.04;
      this.matter.body.setVelocity(b, { x: vx, y: vy });
      void tip;
    }
    this.armAngularVelocity = 0;
  }

  // ---- house ------------------------------------------------------------

  private buildHouse(): void {
    for (const piece of HOUSE_PIECES) {
      this.addPiece(piece);
    }
  }

  private addPiece(piece: HousePiece): void {
    const body = this.matter.add.image(piece.x, piece.y, piece.tex, undefined, {
      shape: { type: "rectangle", width: piece.w, height: piece.h },
      isStatic: true,
      friction: 0.6,
      frictionStatic: 0.9,
      restitution: 0.05,
      density: 0.004,
      label: "house-piece",
    }) as HouseBody;
    body.__pieceId = piece.id;
    body.setDisplaySize(piece.w, piece.h);
    this.housePieces.push(body);
  }

  private onCollisionStart = (
    event: Phaser.Physics.Matter.Events.CollisionStartEvent,
  ): void => {
    for (const pair of event.pairs) {
      const a = pair.bodyA as MatterJS.BodyType;
      const b = pair.bodyB as MatterJS.BodyType;
      const ballBody =
        a.label === "ball" ? a : b.label === "ball" ? b : null;
      if (!ballBody) continue;
      const other = ballBody === a ? b : a;
      if (other.label !== "house-piece") continue;
      if (!other.isStatic) continue;

      const speed = Math.hypot(ballBody.velocity.x, ballBody.velocity.y);
      if (speed < SHATTER_VELOCITY) continue;

      // Flip to dynamic and impart an impulse from the ball.
      this.matter.body.setStatic(other, false);
      const dir = {
        x: other.position.x - ballBody.position.x,
        y: other.position.y - ballBody.position.y,
      };
      const len = Math.hypot(dir.x, dir.y) || 1;
      const mag = speed * 0.012;
      this.matter.body.applyForce(other, other.position, {
        x: (dir.x / len) * mag,
        y: (dir.y / len) * mag - 0.005,
      });
    }
  };

  // ---- reset ------------------------------------------------------------

  private resetAll = (): void => {
    // Destroy and rebuild every house piece.
    for (const p of this.housePieces) p.destroy();
    this.housePieces = [];
    this.buildHouse();

    // Reset the ball to hang at rest under the arm tip.
    this.armAngle = ARM_REST_ANGLE;
    this.armSprite.setRotation(ARM_REST_ANGLE);
    const tip = this.armTip(ARM_REST_ANGLE);
    this.matter.body.setPosition(this.armAnchor, { x: tip.x, y: tip.y });
    if (this.ball.body) {
      const b = this.ball.body as MatterJS.BodyType;
      this.matter.body.setPosition(b, { x: tip.x, y: tip.y + CHAIN_LEN });
      this.matter.body.setVelocity(b, { x: 0, y: 0 });
      this.matter.body.setAngularVelocity(b, 0);
    }
  };
}
