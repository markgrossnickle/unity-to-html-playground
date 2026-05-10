import Phaser from "phaser";

import { NUMBER_DEFS, ART_BOX, type Pt } from "./numberPaths";
import { LETTER_DEFS, type Glyph } from "./letterPaths";
import { playDing, playTaDa } from "./audio";

export type TraceMode = "numbers" | "letters";

const NUMBER_GLYPHS: ReadonlyArray<Glyph> = NUMBER_DEFS.map((d) => ({
  label: String(d.digit),
  strokes: d.strokes,
}));

// Tunables (all in screen pixels).
const START_TOLERANCE = 44; // touch must land this close to an endpoint
const TRACE_TOLERANCE = 32; // pointer must stay this close to advance
const FINISH_TOLERANCE = 28; // pointerup near the far endpoint also finishes
const LOOK_AHEAD = 8; // path indices searched ahead per move

const COLOR_GHOST = 0xc7d2de;
const COLOR_TRACE = 0x1a72d6;
const COLOR_ENDPOINT = 0xff8a1a;
const COLOR_GRID = 0xeaeef5;
const COLOR_FLASH = [0x16c47a, 0xf2c641, 0xe85ca0, 0x1a72d6];

export class TraceScene extends Phaser.Scene {
  private mode: TraceMode = "numbers";
  private glyphIdx = 0;
  private strokeIdx = 0;
  private dir: 1 | -1 = 1;
  private head = 0; // furthest path-index the user has dragged to
  private tracing = false;
  private tracingPointerId: number | null = null;
  private celebrating = false;
  private flashColor: number = COLOR_TRACE;

  private pxScale = 1;
  private offsetX = 0;
  private offsetY = 0;

  private gBg!: Phaser.GameObjects.Graphics;
  private gGhost!: Phaser.GameObjects.Graphics;
  private gTrace!: Phaser.GameObjects.Graphics;
  private gEnds!: Phaser.GameObjects.Graphics;
  private labelText!: Phaser.GameObjects.Text;
  private yayText!: Phaser.GameObjects.Text;

  private cycleEvent: Phaser.Time.TimerEvent | null = null;
  private advanceTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super("TraceScene");
  }

  create(): void {
    this.gBg = this.add.graphics();
    this.gGhost = this.add.graphics();
    this.gTrace = this.add.graphics();
    this.gEnds = this.add.graphics();

    const family =
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    this.labelText = this.add
      .text(0, 0, "", { fontFamily: family, fontSize: "20px", color: "#57606a" })
      .setOrigin(0.5, 1);

    this.yayText = this.add
      .text(0, 0, "Yay!", {
        fontFamily: family,
        fontSize: "96px",
        fontStyle: "bold",
        color: "#16c47a",
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.handleResize();

    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointerupoutside", this.onPointerUp, this);
  }

  // ── public API for toolbar buttons ────────────────────────────────────

  gotoPrev(): void {
    const set = this.currentSet();
    this.glyphIdx = (this.glyphIdx - 1 + set.length) % set.length;
    this.resetForNewGlyph();
  }

  gotoNext(): void {
    const set = this.currentSet();
    this.glyphIdx = (this.glyphIdx + 1) % set.length;
    this.resetForNewGlyph();
  }

  restart(): void {
    this.resetForNewGlyph();
  }

  setMode(mode: TraceMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.glyphIdx = 0;
    this.resetForNewGlyph();
  }

  getMode(): TraceMode {
    return this.mode;
  }

  // ── layout & coords ───────────────────────────────────────────────────

  private handleResize(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const sx = (w - 80) / ART_BOX.width;
    const sy = (h - 140) / ART_BOX.height;
    this.pxScale = Math.max(0.35, Math.min(sx, sy, 1.4));
    this.offsetX = (w - ART_BOX.width * this.pxScale) / 2;
    this.offsetY = (h - ART_BOX.height * this.pxScale) / 2 + 24;
    this.labelText.setPosition(w / 2, this.offsetY - 8);
    this.yayText.setPosition(w / 2, h / 2);
    this.drawGrid();
    this.redraw();
  }

  private toScreen(p: Pt): Pt {
    return {
      x: p.x * this.pxScale + this.offsetX,
      y: p.y * this.pxScale + this.offsetY,
    };
  }

  private currentSet(): ReadonlyArray<Glyph> {
    return this.mode === "numbers" ? NUMBER_GLYPHS : LETTER_DEFS;
  }

  private currentGlyph(): Glyph {
    return this.currentSet()[this.glyphIdx]!;
  }

  private currentStroke(): Pt[] {
    return this.currentGlyph().strokes[this.strokeIdx]!;
  }

  // ── state transitions ─────────────────────────────────────────────────

  private resetForNewGlyph(): void {
    this.strokeIdx = 0;
    this.head = 0;
    this.dir = 1;
    this.tracing = false;
    this.tracingPointerId = null;
    this.celebrating = false;
    this.flashColor = COLOR_TRACE;
    this.tweens.killTweensOf(this.yayText);
    this.yayText.setAlpha(0);
    this.cycleEvent?.remove(false);
    this.cycleEvent = null;
    this.advanceTimer?.remove(false);
    this.advanceTimer = null;
    this.redraw();
  }

  private finishStroke(): void {
    this.tracing = false;
    this.tracingPointerId = null;
    playDing();
    const g = this.currentGlyph();
    this.strokeIdx++;
    if (this.strokeIdx >= g.strokes.length) {
      this.celebrate();
    } else {
      this.head = 0;
      this.dir = 1;
      this.redraw();
    }
  }

  private celebrate(): void {
    this.celebrating = true;
    playTaDa();
    this.tweens.add({
      targets: this.yayText,
      alpha: 1,
      duration: 220,
      yoyo: true,
      hold: 900,
    });

    let i = 0;
    this.cycleEvent = this.time.addEvent({
      delay: 130,
      repeat: COLOR_FLASH.length * 2 - 1,
      callback: () => {
        this.flashColor = COLOR_FLASH[i % COLOR_FLASH.length]!;
        i++;
        this.redraw();
      },
    });

    this.advanceTimer = this.time.delayedCall(1500, () => {
      const set = this.currentSet();
      this.glyphIdx = (this.glyphIdx + 1) % set.length;
      this.resetForNewGlyph();
    });
    this.redraw();
  }

  // ── pointer handlers ──────────────────────────────────────────────────

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.celebrating || this.tracing) return;
    const stroke = this.currentStroke();
    const first = this.toScreen(stroke[0]!);
    const last = this.toScreen(stroke[stroke.length - 1]!);
    const dFirst = Math.hypot(p.x - first.x, p.y - first.y);
    const dLast = Math.hypot(p.x - last.x, p.y - last.y);
    if (Math.min(dFirst, dLast) > START_TOLERANCE) return;

    if (dFirst <= dLast) {
      this.dir = 1;
      this.head = 0;
    } else {
      this.dir = -1;
      this.head = stroke.length - 1;
    }
    this.tracing = true;
    this.tracingPointerId = p.id;
    this.redraw();
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (!this.tracing || p.id !== this.tracingPointerId) return;
    const stroke = this.currentStroke();
    const lastIdx = stroke.length - 1;

    let best = this.head;
    let bestDist = Infinity;
    if (this.dir === 1) {
      const hi = Math.min(lastIdx, this.head + LOOK_AHEAD);
      for (let i = this.head; i <= hi; i++) {
        const sp = this.toScreen(stroke[i]!);
        const d = Math.hypot(p.x - sp.x, p.y - sp.y);
        if (d <= TRACE_TOLERANCE && d < bestDist) {
          best = i;
          bestDist = d;
        }
      }
    } else {
      const lo = Math.max(0, this.head - LOOK_AHEAD);
      for (let i = this.head; i >= lo; i--) {
        const sp = this.toScreen(stroke[i]!);
        const d = Math.hypot(p.x - sp.x, p.y - sp.y);
        if (d <= TRACE_TOLERANCE && d < bestDist) {
          best = i;
          bestDist = d;
        }
      }
    }

    if (best !== this.head) {
      this.head = best;
      this.redraw();
      const farIdx = this.dir === 1 ? lastIdx : 0;
      if (this.head === farIdx) this.finishStroke();
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (!this.tracing || p.id !== this.tracingPointerId) return;
    const stroke = this.currentStroke();
    const lastIdx = stroke.length - 1;
    const farIdx = this.dir === 1 ? lastIdx : 0;
    const far = this.toScreen(stroke[farIdx]!);
    const dFar = Math.hypot(p.x - far.x, p.y - far.y);
    if (this.head === farIdx || dFar <= FINISH_TOLERANCE) {
      this.head = farIdx;
      this.finishStroke();
      return;
    }
    // Incomplete lift: keep stroke, but reset progress so user restarts cleanly.
    this.tracing = false;
    this.tracingPointerId = null;
    this.head = this.dir === 1 ? 0 : lastIdx;
    this.redraw();
  }

  // ── rendering ─────────────────────────────────────────────────────────

  private drawGrid(): void {
    this.gBg.clear();
    const w = this.scale.width;
    const h = this.scale.height;
    const step = 32;
    this.gBg.fillStyle(COLOR_GRID, 1);
    for (let x = (w % step) / 2; x < w; x += step) {
      for (let y = (h % step) / 2; y < h; y += step) {
        this.gBg.fillCircle(x, y, 1.4);
      }
    }
  }

  private redraw(): void {
    const g = this.currentGlyph();
    const isDone = this.strokeIdx >= g.strokes.length;
    const kind = this.mode === "numbers" ? "number" : "letter";
    this.labelText.setText(`Trace the ${kind} ${g.label}`);

    // Dotted ghost over every stroke of the glyph.
    this.gGhost.clear();
    this.gGhost.fillStyle(COLOR_GHOST, 1);
    const dotR = Math.max(3, 4 * this.pxScale * 0.9);
    for (const stroke of g.strokes) {
      for (const p of stroke) {
        const sp = this.toScreen(p);
        this.gGhost.fillCircle(sp.x, sp.y, dotR);
      }
    }

    // Solid trace.
    this.gTrace.clear();
    const thickness = Math.max(10, 14 * this.pxScale);
    const traceColor = isDone ? this.flashColor : COLOR_TRACE;
    this.gTrace.lineStyle(thickness, traceColor, 1);
    const upTo = Math.min(this.strokeIdx, g.strokes.length);
    for (let s = 0; s < upTo; s++) {
      const stroke = g.strokes[s]!;
      this.drawSolidPath(stroke, 0, stroke.length - 1);
    }
    if (!isDone && this.tracing) {
      const stroke = g.strokes[this.strokeIdx]!;
      if (this.dir === 1 && this.head > 0) {
        this.drawSolidPath(stroke, 0, this.head);
      } else if (this.dir === -1 && this.head < stroke.length - 1) {
        this.drawSolidPath(stroke, this.head, stroke.length - 1);
      }
    }

    // Endpoint markers for the current stroke (only when waiting for a start).
    this.gEnds.clear();
    if (!isDone && !this.celebrating && !this.tracing) {
      const stroke = g.strokes[this.strokeIdx]!;
      const endR = Math.max(12, 16 * this.pxScale);
      const first = stroke[0]!;
      const last = stroke[stroke.length - 1]!;
      const sameEnds = first.x === last.x && first.y === last.y;
      const drawEnd = (p: Pt) => {
        const sp = this.toScreen(p);
        this.gEnds.fillStyle(COLOR_ENDPOINT, 1);
        this.gEnds.fillCircle(sp.x, sp.y, endR);
        this.gEnds.lineStyle(3, 0xffffff, 1);
        this.gEnds.strokeCircle(sp.x, sp.y, endR);
      };
      drawEnd(first);
      if (!sameEnds) drawEnd(last);
    }
  }

  private drawSolidPath(stroke: Pt[], from: number, to: number): void {
    if (to <= from) return;
    const a = this.toScreen(stroke[from]!);
    this.gTrace.beginPath();
    this.gTrace.moveTo(a.x, a.y);
    for (let i = from + 1; i <= to; i++) {
      const p = this.toScreen(stroke[i]!);
      this.gTrace.lineTo(p.x, p.y);
    }
    this.gTrace.strokePath();
  }
}
