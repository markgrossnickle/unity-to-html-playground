// Chain visualization between the arm-tip and the wrecking ball.
//
// Implementation choice: a single straight line drawn between the two points
// with chain-link "beads" painted along it. We did NOT model the chain as a
// sequence of linked Matter circles — that approach looks rope-like but adds
// 12+ extra physics bodies and a stack of constraints to tune. The single
// constraint + drawn chain reads as a stiff steel cable, which is honestly
// closer to how a real wrecking-crane chain behaves anyway.

import Phaser from "phaser";

export function drawChain(
  graphics: Phaser.GameObjects.Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  graphics.clear();

  // Backing cable — thick dark stroke so the chain reads against the sky.
  graphics.lineStyle(6, 0x2c2418, 1);
  graphics.lineBetween(ax, ay, bx, by);

  // Inner highlight stroke.
  graphics.lineStyle(2, 0x9a9a9a, 0.9);
  graphics.lineBetween(ax, ay, bx, by);

  // Chain-link beads along the cable.
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const linkSpacing = 14;
  const count = Math.max(2, Math.floor(len / linkSpacing));
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const x = ax + dx * t;
    const y = ay + dy * t;
    graphics.fillStyle(0x5a5f63, 1);
    graphics.fillCircle(x, y, 3.5);
    graphics.lineStyle(1.5, 0x2c2418, 1);
    graphics.strokeCircle(x, y, 3.5);
  }
}
