// PhaserAnimPlayer
//
// Plays back an animation.json produced by the Unity exporter. One layer per
// node, one Phaser.Image per layer, transform tracks evaluated each frame and
// applied to the image. See unity/SPEC.md for the JSON schema.

import Phaser from "phaser";

export interface AnimationLayer {
  name: string;
  defaultFrame: string;
  depth: number;
}

type FloatKey = [number, number];
type FrameKey = [number, string];

export interface LayerTracks {
  x?: FloatKey[];
  y?: FloatKey[];
  rotation?: FloatKey[];
  scaleX?: FloatKey[];
  scaleY?: FloatKey[];
  spriteFrame?: FrameKey[];
}

export interface AnimationData {
  name: string;
  duration: number;
  frameRate: number;
  atlas: string;
  layers: AnimationLayer[];
  tracks: Record<string, LayerTracks>;
}

export class PhaserAnimPlayer {
  private readonly scene: Phaser.Scene;
  private readonly data: AnimationData;
  private readonly atlasKey: string;
  private readonly container: Phaser.GameObjects.Container;
  private readonly images = new Map<string, Phaser.GameObjects.Image>();

  private currentTime = 0;
  private playing = true;
  private speed = 1;
  private looping = true;

  constructor(scene: Phaser.Scene, data: AnimationData, atlasKey: string) {
    this.scene = scene;
    this.data = data;
    this.atlasKey = atlasKey;
    this.container = scene.add.container(0, 0);

    // Lower depth = drawn first (behind). Sort once at construction.
    const sorted = [...data.layers].sort((a, b) => a.depth - b.depth);
    for (const layer of sorted) {
      const img = this.makeLayerImage(layer);
      this.images.set(layer.name, img);
      this.container.add(img);
    }

    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    this.applyTracks();
  }

  private makeLayerImage(layer: AnimationLayer): Phaser.GameObjects.Image {
    const frame = this.atlasHasFrame(layer.defaultFrame)
      ? layer.defaultFrame
      : undefined;
    const img = frame
      ? this.scene.add.image(0, 0, this.atlasKey, frame)
      : this.scene.add.image(0, 0, this.atlasKey);
    return img;
  }

  private atlasHasFrame(frame: string): boolean {
    const tex = this.scene.textures.get(this.atlasKey);
    return tex && tex.has(frame);
  }

  // ---- public API ----

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  setTime(t: number): void {
    this.currentTime = clamp(t, 0, this.data.duration);
    this.applyTracks();
  }

  setSpeed(n: number): void {
    this.speed = n;
  }

  setLoop(loop: boolean): void {
    this.looping = loop;
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    this.container.destroy(true);
    this.images.clear();
  }

  get root(): Phaser.GameObjects.Container {
    return this.container;
  }

  get time(): number {
    return this.currentTime;
  }

  get duration(): number {
    return this.data.duration;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  // ---- frame loop ----

  private onUpdate(_time: number, delta: number): void {
    if (!this.playing) return;
    if (this.data.duration <= 0) return;

    this.currentTime += (delta / 1000) * this.speed;
    if (this.currentTime > this.data.duration) {
      if (this.looping) {
        this.currentTime %= this.data.duration;
      } else {
        this.currentTime = this.data.duration;
        this.playing = false;
      }
    } else if (this.currentTime < 0) {
      // Negative speed scrubbing — wrap or clamp like the forward case.
      if (this.looping) {
        this.currentTime =
          ((this.currentTime % this.data.duration) + this.data.duration) %
          this.data.duration;
      } else {
        this.currentTime = 0;
        this.playing = false;
      }
    }

    this.applyTracks();
  }

  private applyTracks(): void {
    const t = this.currentTime;

    for (const [layerName, tracks] of Object.entries(this.data.tracks)) {
      const img = this.images.get(layerName);
      if (!img) continue;

      // Y and rotation are flipped: Unity is Y-up + CCW-positive,
      // Phaser is Y-down + CW-positive. See unity/SPEC.md.
      if (tracks.x) img.x = lerpKeys(tracks.x, t);
      if (tracks.y) img.y = -lerpKeys(tracks.y, t);
      if (tracks.rotation) img.angle = -lerpKeys(tracks.rotation, t);
      if (tracks.scaleX) img.scaleX = lerpKeys(tracks.scaleX, t);
      if (tracks.scaleY) img.scaleY = lerpKeys(tracks.scaleY, t);

      if (tracks.spriteFrame) {
        const frame = stepKeys(tracks.spriteFrame, t);
        if (frame && this.atlasHasFrame(frame) && img.frame.name !== frame) {
          img.setFrame(frame);
        }
      }
    }
  }
}

// ---- interpolation helpers ----

// Linear interpolation between adjacent keyframes; clamp at the ends.
// Keyframes must be in non-decreasing time order.
function lerpKeys(keys: FloatKey[], t: number): number {
  if (keys.length === 0) return 0;
  const first = keys[0]!;
  if (t <= first[0]) return first[1];
  const last = keys[keys.length - 1]!;
  if (t >= last[0]) return last[1];

  // Linear scan is fine — typical clip has 5-50 keys per track.
  // If clips ever get long enough that this matters, sort once and bsearch.
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t >= a[0] && t <= b[0]) {
      const span = b[0] - a[0];
      if (span <= 0) return b[1];
      const u = (t - a[0]) / span;
      return a[1] + (b[1] - a[1]) * u;
    }
  }
  return last[1];
}

// Step interpolation: held value of the most-recent key whose time <= t.
function stepKeys(keys: FrameKey[], t: number): string | undefined {
  if (keys.length === 0) return undefined;
  let result: string | undefined;
  for (const [kt, kv] of keys) {
    if (kt <= t) result = kv;
    else break;
  }
  return result ?? keys[0]![1];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
